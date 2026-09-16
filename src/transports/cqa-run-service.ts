import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { cqaSha256 } from "../contracts/cqa-query.js";
import { cqaBindingDigest, validateCqaBinding, type CqaBinding, type CqaFrozenOperation, type CqaLookup, type CqaRun, type CqaRunPort } from "../driver/r005-cqa.js";
import { verifyCqaInput } from "../driver/r005-input.js";

export type CqaHttpSender = (url: string, init: RequestInit) => Promise<Response>;
export interface CqaControlCredential { reference: string; revision: string; value: string }
const MAX_WIRE = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const COMMAND = "/opt/cqa/compliance-agent query --config /s2/inputs/config.json --input /opt/accord-cqa-input/request.json";
const SERVICE = "/agentcompose.v2.RunService/";
const OP_LABEL = "accord.operation_id";
const FP_LABEL = "accord.fingerprint";
function check(value: unknown, code = "CQA_RUNTIME_EVIDENCE_INVALID"): asserts value { if (!value) throw new Error(code); }
function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "CQA_RPC_INVALID");
  return value as Record<string, unknown>;
}
const RUN_STATUS: Readonly<Record<string, CqaRun["status"]>> = Object.freeze({
  RUN_STATUS_PENDING: "running", RUN_STATUS_RUNNING: "running", RUN_STATUS_SUCCEEDED: "succeeded",
  RUN_STATUS_FAILED: "failed", RUN_STATUS_CANCELED: "canceled",
});
function id(value: unknown): string { check(typeof value === "string" && ID.test(value), "CQA_RUN_ID_INVALID"); return value; }
function text(value: unknown): string { check(typeof value === "string" && value.isWellFormed(), "CQA_RPC_INVALID"); return value; }
function same(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) check(actual[key] === value);
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o700);
}
function evidence(root: string, names: string[]): { value: Record<string, unknown>; digest: string } {
  check(isAbsolute(root) && resolve(root) === root && realpathSync(root) === root);
  privateDirectory(root);
  for (const name of names) check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,110}$/u.test(name));
  const path = join(root, ...names);
  if (dirname(path) !== root) privateDirectory(dirname(path));
  const before = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o400 && stat.size <= MAX_WIRE && stat.size > 0);
    check(stat.dev === before.dev && stat.ino === before.ino);
    const bytes = Buffer.allocUnsafe(stat.size);
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      check(count > 0); offset += count;
    }
    const after = fstatSync(fd); const named = lstatSync(path);
    check(bytes.byteLength === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && named.ino === stat.ino && named.dev === stat.dev);
    return { value: object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown), digest: cqaSha256(bytes) };
  } finally { closeSync(fd); }
}

// A fresh direct connection: no global proxy agent, environment lookup, redirects, retries or pooled socket replay.
const directSend: CqaHttpSender = async (url, init) => {
  const target = new URL(url);
  // Static network imports fail the operator guard before an offline sender can be injected.
  const { request: sendRequest } = target.protocol === "https:" ? await import("node:https") : await import("node:http");
  const { promise, resolve: resolveResponse, reject } = Promise.withResolvers<Response>();
  const request = sendRequest(target, {
    method: "POST", agent: false, rejectUnauthorized: true, headers: Object.fromEntries(new Headers(init.headers)),
    ...(init.signal ? { signal: init.signal } : {}),
  }, response => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      resolveResponse(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: response.statusCode ?? 500, headers }));
    } catch { response.destroy(); reject(new Error("CQA_RPC_INVALID")); }
  });
  request.on("error", () => reject(new Error("CQA_RPC_UNKNOWN")));
  request.on("upgrade", (_response, socket) => { socket.destroy(); reject(new Error("CQA_RPC_INVALID")); });
  request.end(init.body);
  return promise;
};
async function body(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  check(response.body !== null, "CQA_RPC_INVALID");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, wire = "";
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    check(response.ok && !response.redirected && /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""), "CQA_RPC_REJECTED");
    check(!response.headers.get("content-encoding") || response.headers.get("content-encoding") === "identity", "CQA_RPC_ENCODING_INVALID");
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength; check(bytes <= MAX_WIRE, "CQA_RPC_TOO_LARGE");
      wire += decoder.decode(chunk.value, { stream: true });
    }
    signal.throwIfAborted();
    return object(JSON.parse(wire + decoder.decode()) as unknown);
  } finally { signal.removeEventListener("abort", cancel); cancel(); }
}

/** Concrete Connect-JSON client. Qualification files are operator inputs, never produced by this adapter. */
export class CqaRunServiceAdapter implements CqaRunPort {
  readonly mode = "managed" as const;
  readonly bindingDigest: string;
  readonly #binding: CqaBinding;
  readonly #credential: string;
  readonly #send: CqaHttpSender;
  readonly #qualification: "operator-observed" | "protocol-fixture";
  constructor(binding: CqaBinding, credential: CqaControlCredential, send?: CqaHttpSender) {
    validateCqaBinding(binding);
    check(binding.mode === "managed" && binding.managed && binding.runtime.adapterRevision === "accord.cqa-run-service/v1", "CQA_MANAGED_BINDING_REQUIRED");
    const endpoint = new URL(binding.runtime.endpoint);
    check(endpoint.origin === binding.runtime.endpoint && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "CQA_CONTROL_ENDPOINT_INVALID");
    const octets = endpoint.hostname.split(".");
    const privateIPv4 = octets.length === 4 && octets.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255) &&
      (octets[0] === "127" || octets[0] === "10" || (octets[0] === "192" && octets[1] === "168") ||
        (octets[0] === "172" && Number(octets[1]) >= 16 && Number(octets[1]) <= 31));
    check(binding.managed.transport === "tls" ? endpoint.protocol === "https:" :
      binding.managed.transport === "isolated-http" && endpoint.protocol === "http:" &&
      privateIPv4, "CQA_CONTROL_ENDPOINT_INVALID");
    check(credential.reference === binding.runtime.controlCredentialRef && credential.revision === binding.runtime.controlCredentialRevision &&
      typeof credential.value === "string" && /^[\x21-\x7e]{16,4096}$/u.test(credential.value), "CQA_CONTROL_CREDENTIAL_INVALID");
    this.#binding = structuredClone(binding); this.bindingDigest = cqaBindingDigest(binding);
    this.#credential = credential.value; this.#send = send ?? directSend;
    // Injected protocol senders never consume records claiming actual operator qualification.
    this.#qualification = send ? "protocol-fixture" : "operator-observed";
  }
  #deployment(): Record<string, unknown> {
    const b = this.#binding, m = b.managed!;
    const record = evidence(m.evidenceRoot, ["deployment.json"]);
    check(record.digest === m.deploymentSha256);
    const d = record.value;
    same(d, { schemaVersion: "accord.cqa-deployment/v1", qualification: this.#qualification,
      endpoint: b.runtime.endpoint, transport: m.transport, projectId: b.runtime.projectId, agentName: b.runtime.agentName,
      source: b.runtime.source, daemonSha256: m.daemonSha256, platformManifestSha256: m.platformManifestSha256,
      binarySha256: b.binarySha256, guestImageSha256: b.guestImageSha256, configFileSha256: m.configFileSha256,
      configDigest: b.configDigest, corpusDigest: b.corpusDigest, daemonInputRoot: m.daemonInputRoot, engineInputRoot: m.engineInputRoot,
      configGuestPath: "/s2/inputs/config.json", receiptGuestPath: "/s2/receipts", receiptMode: "0700", receiptWritable: true,
      payloadReadOnly: true, configReadOnly: true, inputReadOnly: true, controlAuthVerified: true, guestIsolationVerified: true,
      schedulerEnabled: false, catalogPolicy: "GET /admin/v1/catalog/compliance-readonly?format=md&grpc=true:401:UNAVAILABLE_AUTH_DENIED",
      outputCollection: "complete-separated-command/v1" });
    check(typeof d["recordRef"] === "string" && ID.test(d["recordRef"]));
    check(typeof d["receiptHostPath"] === "string" && isAbsolute(d["receiptHostPath"]) && resolve(d["receiptHostPath"]) === d["receiptHostPath"]);
    check(Number.isSafeInteger(d["observedAt"]) && Number.isSafeInteger(d["validUntil"]) &&
      Number(d["observedAt"]) <= Date.now() && Date.now() < Number(d["validUntil"]), "CQA_DEPLOYMENT_EXPIRED");
    return d;
  }
  preflight(operation: CqaFrozenOperation, fingerprint: string): void {
    check(operation.bindingDigest === this.bindingDigest && HASH.test(fingerprint), "CQA_OPERATION_BINDING_INVALID");
    id(operation.operationId); this.#deployment();
    check(operation.input.root === this.#binding.inputRoot && operation.input.operationId === operation.operationId);
    check(operation.grant.outboundScope === "synthetic-cqa-managed" && operation.grant.bindingDigest === this.bindingDigest &&
      operation.grant.maxStarts === 1 && operation.grant.maxModelCalls === 1 && Date.now() < operation.deadline, "CQA_GRANT_MISMATCH");
    verifyCqaInput(operation.input, operation.requestBytes);
  }
  async #rpc(method: "StartAgentRun" | "ListRuns" | "GetRun" | "StopRun", request: object, signal: AbortSignal): Promise<Record<string, unknown>> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    bounded.throwIfAborted();
    const url = this.#binding.runtime.endpoint + SERVICE + method;
    try {
      const response = await this.#send(url, { method: "POST", redirect: "error", credentials: "omit", signal: bounded,
        headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1", Authorization: `Bearer ${this.#credential}` },
        body: JSON.stringify(request) });
      check(!response.url || response.url === url, "CQA_RPC_ENDPOINT_CHANGED");
      return await body(response, bounded);
    } catch { throw new Error("CQA_RPC_UNKNOWN"); }
  }
  #summary(value: unknown, runId?: string): Record<string, unknown> {
    const summary = object(value); id(summary["runId"]);
    same(summary, { projectId: this.#binding.runtime.projectId, agentName: this.#binding.runtime.agentName, source: this.#binding.runtime.source });
    if (runId !== undefined) check(summary["runId"] === runId, "CQA_RUN_BINDING_MISMATCH");
    return summary;
  }
  async start(operation: CqaFrozenOperation, fingerprint: string, signal: AbortSignal): Promise<{ pendingRunId: string }> {
    this.preflight(operation, fingerprint);
    const b = this.#binding, m = b.managed!;
    const response = await this.#rpc("StartAgentRun", { run: { projectId: b.runtime.projectId, agentName: b.runtime.agentName,
      source: b.runtime.source, command: COMMAND, clientRequestId: operation.operationId,
      cleanupPolicy: "RUN_SANDBOX_CLEANUP_POLICY_KEEP_RUNNING", ...(b.runtime.sandboxId ? { sandboxId: b.runtime.sandboxId } : {}),
      // Nonempty per-run volumes replace the project's complete mount set.
      volumes: [
        { type: "VOLUME_MOUNT_TYPE_BIND", source: "/s2/payload", target: "/opt/cqa", readOnly: true },
        { type: "VOLUME_MOUNT_TYPE_BIND", source: "/s2/inputs", target: "/s2/inputs", readOnly: true },
        { type: "VOLUME_MOUNT_TYPE_BIND", source: "/s2/receipts", target: "/s2/receipts", readOnly: false },
        { type: "VOLUME_MOUNT_TYPE_BIND", source: join(m.engineInputRoot, operation.operationId), target: "/opt/accord-cqa-input", readOnly: true }],
      labels: { [OP_LABEL]: operation.operationId, [FP_LABEL]: fingerprint } } }, signal);
    return { pendingRunId: id(this.#summary(response["run"])["runId"]) };
  }
  async lookup(query: CqaLookup, signal: AbortSignal): Promise<{ total: number; runs: CqaRun[]; pendingRunId?: string }> {
    const b = this.#binding;
    check(query.operationId === query.operation.operationId && query.operation.bindingDigest === this.bindingDigest && HASH.test(query.fingerprint));
    same(query as unknown as Record<string, unknown>, { projectId: b.runtime.projectId, agentName: b.runtime.agentName, source: b.runtime.source, limit: 2 });
    if (query.runId === undefined) {
      const response = await this.#rpc("ListRuns", { projectId: query.projectId, agentName: query.agentName, source: query.source, limit: 2,
        labels: { [OP_LABEL]: query.operationId, [FP_LABEL]: query.fingerprint } }, signal);
      const total = response["total"] ?? 0, runs = response["runs"] ?? [];
      check(Number.isSafeInteger(total) && Number(total) >= 0 && Number(total) <= 0xffff_ffff && Array.isArray(runs) && runs.length <= 2, "CQA_RPC_INVALID");
      if (total !== 1 || runs.length !== 1) return { total: Number(total), runs: [] };
      return { total: 1, runs: [], pendingRunId: id(this.#summary(runs[0])["runId"]) };
    }
    id(query.runId);
    const response = await this.#rpc("GetRun", { projectId: query.projectId, runId: query.runId }, signal);
    return { total: 1, runs: [this.#run(object(response["run"]), query)] };
  }
  #run(detail: Record<string, unknown>, query: CqaLookup): CqaRun {
    const summary = this.#summary(detail["summary"], query.runId), labels = object(detail["labels"]);
    same(labels, { [OP_LABEL]: query.operationId, [FP_LABEL]: query.fingerprint });
    const statusName = text(summary["status"]);
    check(Object.hasOwn(RUN_STATUS, statusName), "CQA_RUN_STATUS_INVALID");
    const status = RUN_STATUS[statusName]!;
    const run: CqaRun = { runId: id(summary["runId"]), sandboxId: id(summary["sandboxId"]), projectId: text(summary["projectId"]),
      agentName: text(summary["agentName"]), source: text(summary["source"]), operationId: query.operationId, fingerprint: query.fingerprint,
      status, completeOutput: false, exitCode: null, cleanupError: text(detail["cleanupError"] ?? "") !== "" };
    if (status !== "running") {
      const exit = summary["exitCode"] ?? 0; // proto3 int32 zero is omitted on the wire.
      check(Number.isSafeInteger(exit) && Number(exit) >= -2147483648 && Number(exit) <= 2147483647, "CQA_RPC_INVALID"); run.exitCode = Number(exit);
    }
    try {
      const b = this.#binding, m = b.managed!, d = this.#deployment();
      const record = evidence(m.evidenceRoot, [query.operationId, `${run.runId}.json`]), observed = record.value;
      same(observed, { schemaVersion: "accord.cqa-run-observation/v1", qualification: this.#qualification,
        deploymentSha256: m.deploymentSha256, operationId: query.operationId, fingerprint: query.fingerprint, runId: run.runId, sandboxId: run.sandboxId,
        binarySha256: b.binarySha256, guestImageSha256: b.guestImageSha256, configFileSha256: m.configFileSha256,
        requestFileSha256: query.operation.input.requestFileSha256, engineInputSource: join(m.engineInputRoot, query.operationId),
        guestInputTarget: "/opt/accord-cqa-input", inputReadOnly: true, receiptGuestPath: "/s2/receipts", receiptHostPath: d["receiptHostPath"],
        receiptWritable: true, receiptMode: "0700" });
      check(typeof observed["recordRef"] === "string" && ID.test(observed["recordRef"]));
      check(detail["imageRef"] === `compliance-query-agent-guest@sha256:${observed["guestImageSha256"]}`);
      if (status === "succeeded") {
        const metadata = object(JSON.parse(text(detail["resultJson"])) as unknown);
        same(metadata, { mode: "command", command: COMMAND, success: true, exitCode: 0 });
        same(observed, { outputSource: "complete-separated-command/v1", outputComplete: true, outputTruncated: false, stderr: "" });
        const stdout = text(observed["stdout"]);
        check(Buffer.byteLength(stdout) <= 512 * 1024 && stdout === detail["output"] && run.exitCode === 0 && !run.cleanupError);
        run.output = stdout; run.completeOutput = true;
      }
      Object.assign(run, { binarySha256: observed["binarySha256"], guestImageSha256: observed["guestImageSha256"],
        requestFileSha256: observed["requestFileSha256"], volume: { source: query.operation.input.directory, target: observed["guestInputTarget"], readOnly: observed["inputReadOnly"] },
        deploymentSha256: observed["deploymentSha256"], observationSha256: record.digest });
    } catch { /* Keep authenticated identity available for cancellation; absent/invalid proof never produces a candidate. */ }
    return run;
  }
  async cancel(runId: string, signal: AbortSignal): Promise<void> {
    id(runId);
    const response = await this.#rpc("StopRun", { runId, reason: "Accord operation cancellation requested" }, signal);
    const detail = object(response["run"]); this.#summary(detail["summary"], runId);
    check(response["stopRequested"] === true, "CQA_CANCEL_NOT_ACKNOWLEDGED");
  }
}
