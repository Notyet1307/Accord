import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cqaCorpusDigest, cqaRequestBytes, cqaSha256, parseCqaCorpus, parseCqaRequest, parseCqaResult,
  type CqaCandidate, type CqaExpectation, type CqaRequest } from "../contracts/cqa-query.js";
import { planCqaInput, prepareCqaInput, verifyCqaInput, type CqaInputPlan } from "./r005-input.js";

export interface CqaBinding extends Omit<CqaExpectation, "request" | "inputDigest"> {
  mode: "offline" | "managed";
  appId: string; conversationId: string; actorId: string;
  profileRevision: string; bindingRevision: string; policyRevision: string;
  skillRevision: string; toolRevision: string; permissionRevision: string;
  binarySha256: string; guestImageSha256: string;
  inputRoot: string;
  maxOperations: number;
  managed?: {
    daemonSha256: string; platformManifestSha256: string; deploymentSha256: string;
    evidenceRoot: string; daemonInputRoot: string; engineInputRoot: string;
    configFileSha256: string; transport: "tls" | "isolated-http";
  };
  runtime: {
    adapterRevision: string; sourceRevision: string; endpoint: string;
    controlCredentialRef: string; controlCredentialRevision: string;
    projectId: string; agentName: string; source: string; command: string[];
    sandboxId?: string;
  };
}
export interface CqaGrant {
  id: string; revision: string; actorId: string; purpose: "synthetic-compliance-query";
  corpusDigest: string; bindingDigest: string; expiresAt: number;
  maxStarts: 1; maxModelCalls: 0 | 1; outboundScope: "offline-only" | "synthetic-cqa-managed";
  recoveryAllowed: boolean;
}
/** Already authenticated/structured input. IM collection and authorization issuance are outside this slice. */
export interface CqaAcceptance {
  operationId: string; messageId: string; messageSequence: number;
  appId: string; conversationId: string; actorId: string;
  workflowRunId: string; activityId: string; contextRevision: number;
  requestWire: string | Uint8Array; grant: CqaGrant;
}
export interface CqaFrozenOperation {
  operationId: string; messageId: string; messageSequence: number;
  appId: string; conversationId: string; actorId: string;
  workflowRunId: string; activityId: string; contextRevision: number;
  request: CqaRequest; requestBytes: string; inputDigest: string; input: CqaInputPlan;
  bindingDigest: string; grant: CqaGrant; acceptedAt: number; deadline: number;
}
export interface CqaRun {
  runId: string; sandboxId: string; projectId: string; agentName: string; source: string;
  operationId: string; fingerprint: string; binarySha256?: string; guestImageSha256?: string;
  requestFileSha256?: string; volume?: CqaInputPlan["volume"];
  deploymentSha256?: string; observationSha256?: string;
  status: "running" | "succeeded" | "failed" | "canceled";
  completeOutput: boolean; exitCode: number | null; cleanupError: boolean;
  output?: string | Uint8Array;
}
export interface CqaLookup {
  operationId: string; fingerprint: string; projectId: string; agentName: string; source: string;
  operation: CqaFrozenOperation;
  runId?: string; limit: 2;
}
/** One physical RPC per method; preflight is local-only and must not submit work. */
export interface CqaRunPort {
  readonly mode: CqaBinding["mode"];
  readonly bindingDigest: string;
  preflight(operation: CqaFrozenOperation, fingerprint: string): void;
  start(operation: CqaFrozenOperation, fingerprint: string, signal: AbortSignal): Promise<CqaRun | { pendingRunId: string }>;
  lookup(query: CqaLookup, signal: AbortSignal): Promise<{ total: number; runs: CqaRun[]; pendingRunId?: string }>;
  cancel(runId: string, signal: AbortSignal): Promise<void>;
}
export interface CqaOperation {
  frozen: CqaFrozenOperation; fingerprint: string; acceptanceDigest: string;
  state: "accepted" | "unknown" | "complete" | "failed" | "expired";
  runId?: string; sandboxId?: string; pendingRunId?: string;
  terminal?: "succeeded" | "failed" | "canceled";
  error?: string; revoked: boolean; cancelRequested: boolean; cancelAttempted: boolean;
  cancelAcknowledged: boolean; recoveryAllowed: boolean;
  queries: number; recoveryStartedAt?: number; lastQueryAt?: number;
  candidate?: CqaCandidate;
}
export interface CqaSnapshot {
  version: 2; binding: CqaBinding; lastNow: number;
  activeCase?: { id: string; workflowRunId: string; revision: number; contextDigest: string;
    sequence: number; state: "active" | "closed"; outcome: "querying" | "candidate" | "needs_input" | "needs_review" };
  operations: CqaOperation[];
  responses: { id: string; operationId: string; caseId: string; contextRevision: number;
    state: "ready" | "suppressed"; candidateDigest: string; entryIds: string[];
    claims: { text: string; evidenceEntryIds: string[] }[] }[];
  audit: { operationId: string; code: string; at: number; digest?: string }[];
  auditTruncated: boolean;
}
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const SCHEMA = "CREATE TABLE r005_cqa (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, digest TEXT NOT NULL) STRICT";
function requireValue(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function identifier(value: unknown): void { requireValue(typeof value === "string" && ID.test(value), "CQA_ID_INVALID"); }
function text(value: unknown): void {
  requireValue(typeof value === "string" && value.isWellFormed() && value.trim().length > 0 && Buffer.byteLength(value) <= 1024, "CQA_BINDING_INVALID");
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(Reflect.get(value, key))]));
  return value;
}
function canonical(value: unknown): string { return JSON.stringify(canonicalValue(value)); }
export function cqaBindingDigest(binding: CqaBinding): string { return cqaSha256(canonical(binding)); }
function exactKeys(value: object, required: string[], optional: string[] = []): void {
  requireValue(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "CQA_FIELDS_INVALID");
}
export function validateCqaBinding(binding: CqaBinding): void {
  exactKeys(binding, ["mode", "appId", "conversationId", "actorId", "profileRevision", "bindingRevision", "policyRevision",
    "skillRevision", "toolRevision", "permissionRevision", "agentVersion", "configDigest", "corpus", "corpusDigest",
    "generationMode", "binarySha256", "guestImageSha256", "inputRoot", "maxOperations", "runtime"], ["provider", "model", "managed"]);
  exactKeys(binding.runtime, ["adapterRevision", "sourceRevision", "endpoint", "controlCredentialRef", "controlCredentialRevision",
    "projectId", "agentName", "source", "command"], ["sandboxId"]);
  requireValue(binding.mode === "offline" || binding.mode === "managed", "CQA_MODE_INVALID");
  if (binding.mode === "offline") {
    requireValue(binding.runtime.endpoint.startsWith("offline://") && binding.managed === undefined, "CQA_OFFLINE_BINDING_INVALID");
  } else {
    const managed = binding.managed;
    requireValue(managed !== undefined, "CQA_MANAGED_BINDING_REQUIRED");
    exactKeys(managed, ["daemonSha256", "platformManifestSha256", "deploymentSha256", "evidenceRoot",
      "daemonInputRoot", "engineInputRoot", "configFileSha256", "transport"]);
    requireValue(binding.generationMode === "llm" && binding.provider === "baizhi-chat" && binding.model === "grok-4.6" &&
      binding.runtime.source === "RUN_SOURCE_MANUAL" &&
      binding.binarySha256 === "a98b6423b7b3602ff2777e52a48747fda4e3d018742a5e4ad2a760850b8a7355" &&
      managed.daemonSha256 === "8cd19f27f0d6a8ba0dc6158ad50737b3e779fdd6c1e1fc11bb773a21b3ebc447" &&
      binding.runtime.sourceRevision === "043b763f05304c3a55f1bd3f4eb8504a591aa4ba" &&
      binding.guestImageSha256 === "e202e11188012c8489fd7df87cf07fa14b3136ad16df86e84972f5be8eb4e367" &&
      managed.platformManifestSha256 === "b3c2bdd28f728935c40a6a5862748bf9a2d7eab3c39f75449ac834d8d2cc26c9" &&
      binding.corpusDigest === "a9c2e7a68e69a169e75e0fd5847203e58e33507fd31ea04e3410dbb482555bba", "CQA_MANAGED_PIN_MISMATCH");
    for (const value of [managed.deploymentSha256, managed.configFileSha256]) requireValue(HASH.test(value), "CQA_BINDING_DIGEST_INVALID");
    for (const root of [managed.evidenceRoot, managed.daemonInputRoot, managed.engineInputRoot]) planCqaInput(root, "path-validation", "{}");
    const endpoint = new URL(binding.runtime.endpoint);
    requireValue(endpoint.origin === binding.runtime.endpoint && endpoint.username === "" && endpoint.password === "" &&
      endpoint.pathname === "/" && endpoint.search === "" && endpoint.hash === "" &&
      ((managed.transport === "tls" && endpoint.protocol === "https:") ||
        (managed.transport === "isolated-http" && endpoint.protocol === "http:")), "CQA_ENDPOINT_INVALID");
  }
  for (const value of [binding.appId, binding.conversationId, binding.actorId]) identifier(value);
  for (const value of [binding.profileRevision, binding.bindingRevision, binding.policyRevision, binding.skillRevision,
    binding.toolRevision, binding.permissionRevision, binding.agentVersion, binding.runtime.adapterRevision,
    binding.runtime.sourceRevision, binding.runtime.controlCredentialRef, binding.runtime.controlCredentialRevision,
    binding.runtime.projectId, binding.runtime.agentName, binding.runtime.source]) text(value);
  for (const value of [binding.binarySha256, binding.guestImageSha256, binding.configDigest, binding.corpusDigest]) requireValue(HASH.test(value), "CQA_BINDING_DIGEST_INVALID");
  requireValue(Number.isSafeInteger(binding.maxOperations) && binding.maxOperations > 0 && binding.maxOperations <= 100, "CQA_BUDGET_INVALID");
  requireValue(binding.generationMode === "extractive" || binding.generationMode === "llm", "CQA_GENERATION_INVALID");
  if (binding.generationMode === "llm") { text(binding.provider); text(binding.model); }
  else requireValue(binding.provider === undefined && binding.model === undefined, "CQA_MODEL_BINDING_INVALID");
  if (binding.runtime.sandboxId !== undefined) identifier(binding.runtime.sandboxId);
  requireValue(Array.isArray(binding.runtime.command) && canonical(binding.runtime.command) === canonical([
    "/opt/cqa/compliance-agent", "query", "--config", "/s2/inputs/config.json", "--input", "/opt/accord-cqa-input/request.json",
  ]), "CQA_COMMAND_INVALID");
  parseCqaCorpus(JSON.stringify(binding.corpus));
  requireValue(cqaCorpusDigest(binding.corpus) === binding.corpusDigest, "CQA_CORPUS_BINDING_INVALID");
  planCqaInput(binding.inputRoot, "path-validation", "{}");
}
function privateDatabase(path: string): void {
  requireValue(isAbsolute(path) && resolve(path) === path && realpathSync(dirname(path)) === dirname(path), "CQA_DATABASE_PATH_INVALID");
  const parent = lstatSync(dirname(path));
  requireValue(parent.isDirectory() && parent.uid === process.getuid?.() && (parent.mode & 0o777) === 0o700, "CQA_DATABASE_DIRECTORY_UNSAFE");
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      const stat = lstatSync(path + suffix);
      requireValue(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "CQA_DATABASE_FILE_UNSAFE");
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
}

/** One bounded pilot aggregate, using the R004 transaction pattern without importing its owner or wire. */
export class R005CqaConsumer {
  readonly #db: DatabaseSync;
  readonly #binding: CqaBinding;
  readonly #bindingDigest: string;
  readonly #clock: () => number;
  #running = false;
  #controller: AbortController | undefined;

  constructor(path: string, binding: CqaBinding, clock: () => number = Date.now) {
    validateCqaBinding(binding); privateDatabase(path);
    this.#binding = structuredClone(binding); this.#bindingDigest = cqaBindingDigest(binding); this.#clock = clock;
    // Inspect an existing database read-only before WAL, chmod, or schema creation can affect it.
    if (existsSync(path)) {
      const inspection = new DatabaseSync(path, { readOnly: true });
      try {
        const rows = inspection.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
        requireValue(rows.length === 1 && rows[0]?.["name"] === "r005_cqa" && rows[0]?.["sql"] === SCHEMA, "CQA_DATABASE_FOREIGN_SCHEMA");
        this.#readState(inspection);
      } finally { inspection.close(); }
    } else {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      closeSync(fd);
    }
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      const exists = this.#db.prepare("SELECT name FROM sqlite_master WHERE name='r005_cqa'").get();
      if (!exists) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(SCHEMA);
          const state: CqaSnapshot = { version: 2, binding: this.#binding, lastNow: this.#now(), operations: [], responses: [], audit: [], auditTruncated: false };
          const body = canonical(state);
          this.#db.prepare("INSERT INTO r005_cqa VALUES (1,?,?)").run(body, cqaSha256(body));
          this.#db.exec("COMMIT");
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      }
      chmodSync(path, 0o600); this.snapshot();
    } catch (error) { this.#db.close(); throw error; }
  }
  #now(): number {
    const now = this.#clock();
    requireValue(Number.isSafeInteger(now) && now >= 0 && now < 8_640_000_000_000_000 - 120_000, "CQA_TIME_INVALID");
    return now;
  }
  #readState(db: DatabaseSync): CqaSnapshot {
    const rows = db.prepare("SELECT id,body,digest FROM r005_cqa").all();
    const row = rows[0];
    requireValue(rows.length === 1 && row?.["id"] === 1 && typeof row["body"] === "string" && cqaSha256(row["body"]) === row["digest"], "CQA_STATE_INVALID");
    const state = JSON.parse(row["body"]) as CqaSnapshot;
    requireValue(state.version === 2 && cqaBindingDigest(state.binding) === this.#bindingDigest, "CQA_STATE_OR_BINDING_DRIFT");
    return state;
  }
  snapshot(): CqaSnapshot { return this.#readState(this.#db); }
  #change<T>(fn: (state: CqaSnapshot, now: number) => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot(); const now = Math.max(state.lastNow, this.#now()); state.lastNow = now;
      const result = fn(state, now); const body = canonical(state);
      this.#db.prepare("UPDATE r005_cqa SET body=?,digest=? WHERE id=1").run(body, cqaSha256(body));
      this.#db.exec("COMMIT"); return result;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  #audit(state: CqaSnapshot, operationId: string, code: string, now: number, digest?: string): void {
    // ponytail: last 1000 metadata-only observations; durable external audit needed beyond this bounded pilot.
    if (state.audit.length === 1000) { state.audit.shift(); state.auditTruncated = true; }
    state.audit.push({ operationId, code, at: now, ...(digest === undefined ? {} : { digest }) });
  }
  #operation(state: CqaSnapshot, id: string): CqaOperation {
    const operation = state.operations.find(item => item.frozen.operationId === id);
    requireValue(operation, "CQA_OPERATION_UNKNOWN"); return operation;
  }
  #fresh(state: CqaSnapshot, operation: CqaOperation, now: number): boolean {
    const active = state.activeCase; const frozen = operation.frozen;
    return active?.state === "active" && active.id === frozen.request.caseId && active.revision === frozen.contextRevision &&
      active.contextDigest === frozen.request.contextDigest && !operation.revoked && !operation.cancelRequested &&
      now < frozen.deadline && now < frozen.grant.expiresAt;
  }
  #suppress(state: CqaSnapshot, operationId?: string): void {
    for (const response of state.responses) if (operationId === undefined || response.operationId === operationId) response.state = "suppressed";
  }

  accept(input: CqaAcceptance): CqaOperation {
    const request = parseCqaRequest(input.requestWire); const requestBytes = cqaRequestBytes(request);
    for (const value of [input.operationId, input.messageId, input.workflowRunId, input.activityId]) identifier(value);
    requireValue(input.operationId === request.requestId && input.activityId === request.invocationId, "CQA_CORRELATION_MISMATCH");
    requireValue(input.appId === this.#binding.appId && input.conversationId === this.#binding.conversationId && input.actorId === this.#binding.actorId, "CQA_ACTOR_SCOPE_MISMATCH");
    requireValue(Number.isSafeInteger(input.messageSequence) && input.messageSequence > 0 && Number.isSafeInteger(input.contextRevision) && input.contextRevision > 0, "CQA_CONTEXT_INVALID");
    const grant = input.grant;
    exactKeys(input, ["operationId", "messageId", "messageSequence", "appId", "conversationId", "actorId",
      "workflowRunId", "activityId", "contextRevision", "requestWire", "grant"]);
    exactKeys(grant, ["id", "revision", "actorId", "purpose", "corpusDigest", "bindingDigest", "expiresAt",
      "maxStarts", "maxModelCalls", "outboundScope", "recoveryAllowed"]);
    identifier(grant.id); text(grant.revision);
    requireValue(grant.actorId === input.actorId && grant.purpose === "synthetic-compliance-query" && grant.corpusDigest === this.#binding.corpusDigest &&
      grant.bindingDigest === this.#bindingDigest && grant.maxStarts === 1 && grant.maxModelCalls === (this.#binding.generationMode === "llm" ? 1 : 0) &&
      grant.outboundScope === (this.#binding.mode === "managed" ? "synthetic-cqa-managed" : "offline-only") &&
      typeof grant.recoveryAllowed === "boolean" && Number.isSafeInteger(grant.expiresAt), "CQA_GRANT_MISMATCH");
    const { requestWire: _wire, ...identity } = input;
    const acceptanceDigest = cqaSha256(canonical({ ...identity, request, bindingDigest: this.#bindingDigest }));
    return this.#change((state, now) => {
      const existing = state.operations.find(item => item.frozen.operationId === input.operationId || item.frozen.messageId === input.messageId);
      if (existing) {
        requireValue(existing.acceptanceDigest === acceptanceDigest, "CQA_ACCEPTANCE_IDENTITY_CONFLICT");
        return structuredClone(existing);
      }
      requireValue(grant.expiresAt > now, "CQA_GRANT_EXPIRED");
      requireValue(state.operations.length < this.#binding.maxOperations, "CQA_OPERATION_BUDGET_EXHAUSTED");
      const active = state.activeCase;
      if (active && active.state !== "closed") {
        requireValue(active.state === "active" && active.id === request.caseId && active.workflowRunId === input.workflowRunId &&
          input.contextRevision === active.revision + 1 && input.messageSequence > active.sequence, "CQA_CASE_CONTEXT_CONFLICT");
      } else {
        requireValue(input.contextRevision === 1 && !state.operations.some(item => item.frozen.request.caseId === request.caseId), "CQA_CASE_REUSE");
      }
      requireValue(!state.operations.some(item => item.frozen.activityId === input.activityId || item.frozen.grant.id === grant.id), "CQA_ACTIVITY_OR_GRANT_REUSE");
      const frozen: CqaFrozenOperation = { ...identity, request, requestBytes, inputDigest: cqaSha256(requestBytes),
        input: planCqaInput(this.#binding.inputRoot, input.operationId, requestBytes), bindingDigest: this.#bindingDigest,
        acceptedAt: now, deadline: Math.min(now + 120_000, grant.expiresAt) };
      const operation: CqaOperation = { frozen, fingerprint: cqaSha256(canonical(frozen)), acceptanceDigest, state: "accepted",
        revoked: false, cancelRequested: false, cancelAttempted: false, cancelAcknowledged: false, recoveryAllowed: grant.recoveryAllowed, queries: 0 };
      state.activeCase = { id: request.caseId, workflowRunId: input.workflowRunId, revision: input.contextRevision,
        contextDigest: request.contextDigest, sequence: input.messageSequence, state: "active", outcome: "querying" };
      this.#suppress(state); state.operations.push(operation); this.#audit(state, input.operationId, "ACCEPTED", now);
      return structuredClone(operation);
    });
  }
  revoke(operationId: string, retainRecovery: boolean): void {
    requireValue(typeof retainRecovery === "boolean", "CQA_RECOVERY_PERMISSION_INVALID");
    this.#change((state, now) => {
      const operation = this.#operation(state, operationId); operation.revoked = true;
      operation.recoveryAllowed = operation.recoveryAllowed && retainRecovery;
      this.#suppress(state, operationId); this.#audit(state, operationId, "REVOKED", now);
    });
    this.#controller?.abort();
  }
  requestCancel(operationId: string): void {
    this.#change((state, now) => {
      const operation = this.#operation(state, operationId); operation.cancelRequested = true;
      this.#suppress(state, operationId); this.#audit(state, operationId, "CANCEL_REQUESTED", now);
    });
    this.#controller?.abort();
  }
  closeCase(): void {
    this.#change(state => {
      requireValue(!state.operations.some(item => item.state === "unknown" || item.state === "accepted"), "CQA_CASE_UNRESOLVED");
      if (state.activeCase) state.activeCase.state = "closed";
      this.#suppress(state);
    });
  }
  #portCheck(port: CqaRunPort): void {
    requireValue(port.mode === this.#binding.mode && port.bindingDigest === this.#bindingDigest &&
      typeof port.preflight === "function", "CQA_PORT_BINDING_MISMATCH");
  }
  #runCheck(run: CqaRun, operation: CqaOperation): void {
    identifier(run.runId); identifier(run.sandboxId);
    const runtime = this.#binding.runtime; const frozen = operation.frozen;
    requireValue(run.projectId === runtime.projectId && run.agentName === runtime.agentName && run.source === runtime.source &&
      run.operationId === frozen.operationId && run.fingerprint === operation.fingerprint &&
      (runtime.sandboxId === undefined || run.sandboxId === runtime.sandboxId) &&
      (operation.runId === undefined || run.runId === operation.runId) &&
      (operation.pendingRunId === undefined || run.runId === operation.pendingRunId) &&
      (operation.sandboxId === undefined || run.sandboxId === operation.sandboxId), "CQA_RUN_BINDING_MISMATCH");
    requireValue(["running", "succeeded", "failed", "canceled"].includes(run.status) && typeof run.completeOutput === "boolean" &&
      typeof run.cleanupError === "boolean" && (run.exitCode === null || Number.isSafeInteger(run.exitCode)), "CQA_RUN_INVALID");
  }
  #proofCheck(run: CqaRun, operation: CqaOperation): void {
    requireValue(run.binarySha256 === this.#binding.binarySha256 && run.guestImageSha256 === this.#binding.guestImageSha256 &&
      run.requestFileSha256 === operation.frozen.input.requestFileSha256 &&
      canonical(run.volume) === canonical(operation.frozen.input.volume), "CQA_RUN_PROOF_MISMATCH");
    if (this.#binding.mode === "managed") requireValue(run.deploymentSha256 === this.#binding.managed!.deploymentSha256 &&
      typeof run.observationSha256 === "string" && HASH.test(run.observationSha256), "CQA_RUN_PROOF_MISMATCH");
  }
  #pending(id: string, runId: string): CqaOperation["state"] {
    return this.#change((state, now) => {
      const operation = this.#operation(state, id);
      identifier(runId);
      requireValue((operation.runId === undefined || operation.runId === runId) &&
        (operation.pendingRunId === undefined || operation.pendingRunId === runId), "CQA_RUN_HINT_CONFLICT");
      operation.pendingRunId = runId;
      this.#audit(state, id, "RUN_ID_PENDING_VERIFICATION", now);
      return operation.state;
    });
  }
  /** Collect an original run observation from the trusted port, never from model content. */
  collect(operationId: string, run: CqaRun): CqaOperation["state"] {
    return this.#change((state, now) => {
      const operation = this.#operation(state, operationId);
      requireValue(operation.state === "unknown" || operation.runId !== undefined, "CQA_RUN_BEFORE_SUBMISSION");
      try { this.#runCheck(run, operation); if (this.#binding.mode === "offline") this.#proofCheck(run, operation); }
      catch { this.#audit(state, operationId, "RUN_BINDING_REJECTED", now); return operation.state; }
      operation.runId = run.runId; operation.sandboxId = run.sandboxId;
      delete operation.pendingRunId;
      if (this.#binding.mode === "managed") {
        try { this.#proofCheck(run, operation); }
        catch { this.#audit(state, operationId, "RUN_PROOF_REJECTED", now); return operation.state; }
        if (run.status !== "running" && !run.completeOutput) {
          this.#audit(state, operationId, "RUN_OUTPUT_UNPROVEN", now); return operation.state;
        }
      }
      if (run.status === "running") return operation.state;
      if (operation.terminal !== undefined && operation.terminal !== run.status) {
        this.#audit(state, operationId, "TERMINAL_DIVERGENCE", now); return operation.state;
      }
      operation.terminal = run.status;
      if (run.status === "canceled") {
        // Platform cancellation does not prove an upstream Search/model call stopped.
        this.#audit(state, operationId, "PLATFORM_CANCELED_REMOTE_UNKNOWN", now);
        return operation.state;
      }
      if (run.status !== "succeeded" || run.exitCode !== 0 || run.cleanupError || !run.completeOutput || run.output === undefined) {
        this.#audit(state, operationId, "RUN_NOT_CANDIDATE", now);
        if (!operation.candidate) { operation.state = "failed"; operation.error = "CQA_EXECUTION_NOT_VALIDATED"; }
        return operation.state;
      }
      let candidate: CqaCandidate;
      try { candidate = parseCqaResult(run.output, { ...this.#binding, request: operation.frozen.request, inputDigest: operation.frozen.inputDigest }); }
      catch {
        this.#audit(state, operationId, "RESULT_REJECTED", now);
        if (!operation.candidate) { operation.state = "failed"; operation.error = "CQA_RESULT_INVALID"; }
        return operation.state;
      }
      if (operation.candidate) {
        this.#audit(state, operationId, operation.candidate.digest === candidate.digest ? "RESULT_REPLAY" : "RESULT_DIVERGENCE", now, candidate.digest);
        return operation.state;
      }
      if (!this.#fresh(state, operation, now) || operation.state === "failed" || operation.state === "expired") {
        this.#audit(state, operationId, "RESULT_STALE", now, candidate.digest); operation.state = "expired"; return operation.state;
      }
      operation.candidate = candidate; operation.state = "complete";
      state.activeCase!.outcome = candidate.result.status === "INSUFFICIENT_EVIDENCE" ? "needs_input"
        : candidate.result.status === "NEEDS_REVIEW" ? "needs_review" : "candidate";
      const entries = new Map(candidate.result.citations.map(citation => [citation.id, `entry-${cqaSha256(canonical([operationId, citation.id]))}`]));
      state.responses.push({ id: `response-${operationId}`, operationId, caseId: operation.frozen.request.caseId,
        contextRevision: operation.frozen.contextRevision, state: "ready", candidateDigest: candidate.digest,
        entryIds: [...entries.values()], claims: candidate.result.claims.map(claim => ({
          text: claim.text, evidenceEntryIds: claim.evidenceIds.map(id => entries.get(id)!) })) });
      this.#audit(state, operationId, "CANDIDATE_COMMITTED", now, candidate.digest);
      return operation.state;
    });
  }
  async #rpc<T>(call: (signal: AbortSignal) => Promise<T>, remaining: number): Promise<T> {
    requireValue(remaining > 0, "CQA_DEADLINE");
    const controller = new AbortController(); this.#controller = controller;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return call(controller.signal); }), new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("CQA_RPC_UNKNOWN")), { once: true });
        timer = setTimeout(() => controller.abort(), Math.min(10_000, remaining));
      })]);
    } finally { clearTimeout(timer); this.#controller = undefined; }
  }
  async #cancelOriginal(port: CqaRunPort, id: string): Promise<boolean> {
    const cancel = this.#change((state, now) => {
      const operation = this.#operation(state, id);
      if (!operation.cancelRequested || operation.cancelAttempted || !operation.runId || !operation.recoveryAllowed) return undefined;
      operation.recoveryStartedAt ??= now;
      const remaining = Math.min(operation.frozen.deadline, operation.recoveryStartedAt + 30_000) - now;
      if (remaining <= 0) return undefined;
      operation.cancelAttempted = true; this.#audit(state, id, "CANCEL_MAYBE_SUBMITTED", now);
      return { runId: operation.runId, remaining };
    });
    if (!cancel) return false;
    try {
      await this.#rpc(signal => port.cancel(cancel.runId, signal), cancel.remaining);
      this.#change((state, now) => { this.#operation(state, id).cancelAcknowledged = true; this.#audit(state, id, "CANCEL_ACK_NOT_COMPLETION", now); });
    } catch { this.#change((state, now) => this.#audit(state, id, "CANCEL_OUTCOME_UNKNOWN", now)); }
    return true;
  }
  /** Advances at most one physical start, lookup or cancellation; never replaces an uncertain start. */
  async advance(port: CqaRunPort): Promise<"idle" | CqaOperation["state"]> {
    requireValue(!this.#running, "CQA_CONSUMER_BUSY"); this.#portCheck(port); this.#running = true;
    try {
      const selected = this.#change((state, now) => {
        for (const operation of state.operations) if (operation.state === "accepted" && !this.#fresh(state, operation, now)) operation.state = "expired";
        // Cancellation is a durable intent, independent of a collected result's state.
        const cancellation = state.operations.find(item => item.cancelRequested && !item.cancelAttempted && item.runId &&
          item.recoveryAllowed && now < item.frozen.deadline && now < (item.recoveryStartedAt ?? now) + 30_000);
        const operation = cancellation ?? state.operations.find(item => item.state === "unknown") ?? state.operations.find(item => item.state === "accepted");
        return operation === undefined ? undefined : structuredClone(operation);
      });
      if (!selected) return "idle";
      const id = selected.frozen.operationId;
      if (selected.state === "accepted") {
        try { prepareCqaInput(selected.frozen.input, selected.frozen.requestBytes); }
        catch {
          this.#change((state, now) => { const operation = this.#operation(state, id); operation.error = "CQA_INPUT_PREPARATION_FAILED"; this.#audit(state, id, "INPUT_REJECTED", now); });
          return "accepted"; // Safe to resume only the same never-submitted bytes; never overwrite a conflict.
        }
        try { port.preflight(selected.frozen, selected.fingerprint); }
        catch {
          this.#change((state, now) => { const operation = this.#operation(state, id); operation.error = "CQA_PREFLIGHT_FAILED"; this.#audit(state, id, "PREFLIGHT_REJECTED", now); });
          return "accepted";
        }
        const dispatch = this.#change((state, now) => {
          const operation = this.#operation(state, id);
          requireValue(operation.state === "accepted", "CQA_ALREADY_SUBMITTED");
          if (!this.#fresh(state, operation, now)) { operation.state = "expired"; return undefined; }
          this.#portCheck(port); verifyCqaInput(operation.frozen.input, operation.frozen.requestBytes);
          operation.state = "unknown"; delete operation.error;
          this.#audit(state, id, "MAYBE_SUBMITTED", now);
          return { operation: structuredClone(operation), remaining: operation.frozen.deadline - now };
        });
        if (!dispatch) return "expired";
        try {
          const run = await this.#rpc(signal => port.start(dispatch.operation.frozen, dispatch.operation.fingerprint, signal), dispatch.remaining);
          return "pendingRunId" in run ? this.#pending(id, run.pendingRunId) : this.collect(id, run);
        } catch {
          this.#change((state, now) => this.#audit(state, id, "START_OUTCOME_UNKNOWN", now));
          return "unknown";
        }
      }
      // A known original Run can be canceled even when its next lookup is unavailable.
      if (await this.#cancelOriginal(port, id)) return this.#operation(this.snapshot(), id).state;
      if (selected.state !== "unknown") return selected.state;
      const query = this.#change((state, now) => {
        const operation = this.#operation(state, id);
        if (!operation.recoveryAllowed || now >= operation.frozen.deadline || operation.queries >= 6 ||
          (operation.lastQueryAt !== undefined && now - operation.lastQueryAt < 5000)) return undefined;
        operation.recoveryStartedAt ??= now;
        const remaining = Math.min(operation.frozen.deadline, operation.recoveryStartedAt + 30_000) - now;
        if (remaining <= 0) return undefined;
        operation.queries++; operation.lastQueryAt = now;
        return { operation: structuredClone(operation), remaining };
      });
      if (!query) return "unknown";
      const operation = query.operation; const runtime = this.#binding.runtime;
      try {
        const found = await this.#rpc(signal => port.lookup({ operationId: id, fingerprint: operation.fingerprint,
          operation: operation.frozen, projectId: runtime.projectId, agentName: runtime.agentName, source: runtime.source,
          ...((operation.runId ?? operation.pendingRunId) === undefined ? {} : { runId: (operation.runId ?? operation.pendingRunId)! }), limit: 2 }, signal), query.remaining);
        if (found.total === 1 && Array.isArray(found.runs) && found.runs.length === 0 && found.pendingRunId !== undefined) {
          return this.#pending(id, found.pendingRunId);
        }
        if (found.total !== 1 || !Array.isArray(found.runs) || found.runs.length !== 1 || found.pendingRunId !== undefined) {
          this.#change((state, now) => this.#audit(state, id, "LOOKUP_NOT_UNIQUE", now)); return "unknown";
        }
        return this.collect(id, found.runs[0]!);
      } catch { this.#change((state, now) => this.#audit(state, id, "RECOVERY_OUTCOME_UNKNOWN", now)); return "unknown"; }
    } finally { this.#running = false; }
  }
  close(): void { requireValue(!this.#running, "CQA_CONSUMER_BUSY"); this.#db.close(); }
}
