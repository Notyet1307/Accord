import type { AuthorityDatabase } from "../persistence/sqlite-authority.js";
import { MagicChatProtocolAdapter } from "../magicchat/adapter.js";
import { normalizeFrozenRuntimeConfiguration, assertRuntimeConfigurationWindow, type FrozenRuntimeConfiguration } from "../frozen-runtime-config.js";
import type { InvocationBoundOutputContract } from "../profile-runtime.js";
import type { PreparedProfileInvocation, ProviderPort } from "../researcher-analyst.js";
import type { MagicChatTransport } from "../transports/magicchat-websocket.js";
import type { AttemptId, CaseId } from "../core/ids.js";
import type { GeneratedR003CaseTrace } from "../case-trace.js";

export interface DriverPorts {
  connect(receive: (envelope: unknown) => void, signal: AbortSignal): Promise<MagicChatTransport>;
  provider(invocation: PreparedProfileInvocation, contract: InvocationBoundOutputContract | undefined, signal: AbortSignal): ProviderPort;
}
export interface DriverResult {
  readonly state: "COMPLETE" | "UNKNOWN" | "STOPPED" | "FAILED" | "REJECTED";
  readonly reason: string;
  readonly caseId?: CaseId;
  readonly trace?: GeneratedR003CaseTrace;
}
const SAFE_REASONS = new Set(["CONFIG_UNBOUND", "REVIEW_TARGET_MISSING", "REVIEW_TARGET_AMBIGUOUS", "TARGET_MISMATCH", "CONFIG_MISMATCH", "CONFIG_WINDOW_EXPIRED", "CONFIG_WINDOW_NOT_STARTED", "UNKNOWN_RETRY_NOT_ELIGIBLE", "DRIVER_CASE_AMBIGUOUS", "DRIVER_APP_MISMATCH", "DRIVER_INVOCATION_AMBIGUOUS", "MAGICCHAT_RPC_TIMEOUT", "MAGICCHAT_CONNECTION_CLOSED", "MAGICCHAT_ABORTED"]);

const SAFE_PROVIDER_DIAGNOSTICS = new Set(["PROVIDER_RESPONSE_TOO_LARGE", "PROVIDER_RESPONSE_INVALID", "PROVIDER_MODEL_IDENTITY_MISMATCH", "PROVIDER_IDENTITY_INVALID", "PROVIDER_USAGE_INVALID", "PROVIDER_WIRE_TOO_LARGE", "PROVIDER_TIMEOUT", "PROVIDER_ABORTED", "PROVIDER_CREDENTIAL_REFLECTION", "PROVIDER_TRANSPORT_ERROR"]);

/** One event-driven coordinator; the caller owns the database and supplies explicitly bound I/O. */
export async function runR003Driver(options: {
  authority: AuthorityDatabase; configuration: FrozenRuntimeConfiguration; ports: DriverPorts;
  signal: AbortSignal; retryUnknown?: AttemptId; report?: (state: string) => void;
}): Promise<DriverResult> {
  const { authority, ports } = options;
  const config = normalizeFrozenRuntimeConfiguration(options.configuration);
  if (config.provider.transportVersion !== "accord.baizhi-responses-transport/v2" || config.magicChat.transportVersion !== "accord.magicchat-websocket-transport/v2" || config.profiles.REVIEWER.profileVersion !== "accord.reviewer/v2" || config.profiles.WRITER.profileVersion !== "accord.writer/v2") throw new Error("DRIVER_CONFIGURATION_UNSUPPORTED");
  const now = () => new Date().toISOString();
  assertRuntimeConfigurationWindow(config, now());
  if (options.signal.aborted) return { state: "STOPPED", reason: "STOP_REQUESTED" };
  const cancellation = new AbortController();
  let transport: MagicChatTransport | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true; let resolveWake: (() => void) | undefined; let stopReason: string | undefined;
  const sentRequests = new Set<string>();
  let caseId: CaseId | undefined; let retryHandled = false;
  const wake = () => { dirty = true; resolveWake?.(); resolveWake = undefined; };
  const stop = (reason: string) => { stopReason ??= reason; cancellation.abort(); transport?.close(); wake(); };
  const abort = () => stop("STOP_REQUESTED");
  options.signal.addEventListener("abort", abort, { once: true });
  const armDeadline = () => {
    const left = Date.parse(config.executionWindow.deadline) - Date.now();
    if (left <= 0) stop("CONFIG_WINDOW_EXPIRED");
    else deadlineTimer = setTimeout(armDeadline, Math.min(left, 2_147_483_647));
  };
  const result = (state: DriverResult["state"], reason: string, trace?: GeneratedR003CaseTrace): DriverResult => ({ state, reason, ...(caseId === undefined ? {} : { caseId }), ...(trace === undefined ? {} : { trace }) });
  const report = (state: string) => options.report?.(state);
  try {
    armDeadline();
    authority.installTrustedSyntheticSourceManifest(now());
    const accepted = authority.acceptRuntimeConfiguration(config, now());
    const existing = authority.inspectDriverWork(config.magicChat.appId);
    if (existing?.hasUnboundInvocations) throw new Error("CONFIG_UNBOUND");
    if (existing?.configuration !== undefined && existing.configuration.digest !== accepted.reference.digest) throw new Error("CONFIG_MISMATCH");
    const protocol = new MagicChatProtocolAdapter(authority, config.magicChat.appId);
    transport = await ports.connect((envelope) => {
      if (stopReason !== undefined) return;
      protocol.receive(envelope, now());
      wake();
    }, cancellation.signal);
    void transport.closed.then((reason) => stop(SAFE_REASONS.has(reason) ? reason : "MAGICCHAT_STOPPED"));
    if (options.signal.aborted) stop("STOP_REQUESTED");
    while (stopReason === undefined) {
      if (!dirty) await new Promise<void>((resolve) => { resolveWake = resolve; });
      dirty = false;
      if (stopReason !== undefined) break;
      assertRuntimeConfigurationWindow(config, now());
      const work = authority.inspectDriverWork(config.magicChat.appId);
      caseId = work?.caseId;
      if (work !== undefined) {
        if (work.configuration !== undefined && work.configuration.digest !== accepted.reference.digest) throw new Error("CONFIG_MISMATCH");
        authority.bindRunRuntimeConfiguration(work.workflowRunId, work.caseId, accepted.reference, now());
      }
      if (!retryHandled && options.retryUnknown !== undefined) {
        if (work === undefined || !work.attempts.some((attempt) => attempt.attemptId === options.retryUnknown)) throw new Error("UNKNOWN_RETRY_NOT_ELIGIBLE");
        const retry = authority.authorizeUnknownRetry(options.retryUnknown, accepted.reference.digest, now());
        retryHandled = true;
        if (retry.state !== "READY") return result("STOPPED", "RETRY_ALREADY_USED");
        wake(); continue;
      }
      const pending = protocol.pendingRequests();
      if (pending.length > 64) throw new Error("DRIVER_PENDING_LIMIT");
      const next = pending[0];
      if (next !== undefined) {
        if (sentRequests.has(next.request.id)) return result("STOPPED", "RPC_NOT_CONFIRMED");
        let sent = false;
        const response = protocol.dispatch(next.request.id, now(), (request) => { sent = true; sentRequests.add(request.id); return transport!.send(request); });
        if (sent) { await response; wake(); } else report("WAIT_FOR_AUTHORITY");
        continue;
      }
      if (work === undefined) { report("WAIT_FOR_CASE"); continue; }
      if (work.state === "COMPLETE") return result("COMPLETE", "COMPLETE", authority.generateCaseTrace(work.caseId));
      if (work.caseStatus === "REJECTED") return result("REJECTED", "HUMAN_REJECTED");
      if (work.caseStatus === "FAILED") return result("FAILED", "WORKFLOW_FAILED");
      if (!["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"].includes(work.state)) { report(work.state); continue; }
      if (work.invocationStatus === "UNKNOWN") return result("UNKNOWN", "EXPLICIT_RETRY_REQUIRED");
      if (work.invocationStatus !== undefined && work.invocationStatus !== "READY") return result("STOPPED", "INVOCATION_NOT_READY");
      if (work.state === "WRITER" && work.evidenceCandidates.length > 0) {
        if (work.prepared !== undefined) throw new Error("DRIVER_EVIDENCE_AFTER_CONTEXT");
        for (const id of work.evidenceCandidates) authority.acceptSyntheticEvidence(id, now());
        wake(); continue;
      }
      const profile = work.state as PreparedProfileInvocation["profile"];
      const prepared = work.prepared ?? authority.prepareConfiguredProfileInvocation({ caseId: work.caseId, profile, configuration: accepted.reference, now: now() });
      let contract: InvocationBoundOutputContract | undefined;
      if (profile === "REVIEWER") {
        if (work.reviewerTarget === undefined) throw new Error("REVIEW_TARGET_MISSING");
        contract = authority.createReviewerDispositionContract(prepared, work.reviewerTarget);
      } else if (profile === "WRITER") {
        if (work.reviewerHandoff === undefined) throw new Error("DRIVER_REVIEWER_MISSING");
        contract = authority.createWriterArtifactContract(prepared, work.reviewerHandoff);
      }
      const port = ports.provider(prepared, contract, cancellation.signal);
      report(`RUNNING_${profile}`);
      const outcome = await authority.executeConfiguredPreparedAttempt(prepared, accepted.reference, config, port, now());
      if (stopReason !== undefined) break;
      if (outcome.outcome !== "WINNER") return result(outcome.outcome === "UNKNOWN" ? "UNKNOWN" : "FAILED", "PROVIDER_RESULT_NOT_COMMITTED");
      wake();
    }
    return result("STOPPED", stopReason ?? "STOP_REQUESTED");
  } catch (error) {
    if (error instanceof Error && SAFE_PROVIDER_DIAGNOSTICS.has(error.message)) report(error.message);
    if (stopReason !== undefined) return result("STOPPED", stopReason);
    try { if (authority.inspectDriverWork(config.magicChat.appId)?.invocationStatus === "UNKNOWN") return result("UNKNOWN", "EXPLICIT_RETRY_REQUIRED"); } catch { /* Preserve the original bounded failure if authority cannot be reconstructed. */ }
    return result("FAILED", error instanceof Error && SAFE_REASONS.has(error.message) ? error.message : "DRIVER_AUTHORITY_OR_TRANSPORT_REJECTED");
  } finally {
    options.signal.removeEventListener("abort", abort);
    clearTimeout(deadlineTimer);
    cancellation.abort(); transport?.close();
  }
}
