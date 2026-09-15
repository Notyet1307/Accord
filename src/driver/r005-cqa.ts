import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cqaCorpusDigest, cqaRequestBytes, cqaSha256, parseCqaCorpus, parseCqaRequest, parseCqaResult,
  type CqaCandidate, type CqaExpectation, type CqaRequest } from "../contracts/cqa-query.js";
import { planCqaInput, prepareCqaInput, verifyCqaInput, type CqaInputPlan } from "./r005-input.js";
import { normalizeMagicChatEnvelope, normalizeMagicChatMessageBodyForSend, parseMagicChatMessageSendPayload,
  type MagicChatMessageBody, type NormalizedMagicChatChoiceResponseCreated } from "../contracts/magicchat.js";
import type { MagicChatRequestEnvelope } from "../magicchat/adapter.js";
import { collectCqaFields, cqaChatId, cqaFieldPrompt, cqaMissingField, CQA_NARROW_SCOPE, renderCqaCandidate,
  type CqaChatConfiguration, type CqaChatState } from "./r005-chat.js";
export type { CqaChatConfiguration } from "./r005-chat.js";

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
/** Authenticated structured acceptance; private-chat collection uses the same transaction. */
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
  version: 3; binding: CqaBinding; lastNow: number;
  chat?: CqaChatState;
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

export function validateCqaChatConfiguration(binding: CqaBinding, configuration: CqaChatConfiguration): void {
  requireValue(configuration !== null && typeof configuration === "object", "CQA_CHAT_CONFIGURATION_INVALID");
  exactKeys(configuration, ["schemaVersion", "authorizationId", "authorizationRevision", "expiresAt", "magicChat"]);
  requireValue(configuration.schemaVersion === "accord.r005-chat/v1" && Number.isSafeInteger(configuration.expiresAt) &&
    configuration.expiresAt >= 0 && configuration.expiresAt < 8_640_000_000_000_000, "CQA_CHAT_CONFIGURATION_INVALID");
  identifier(configuration.authorizationId); text(configuration.authorizationRevision);
  const chat = configuration.magicChat;
  requireValue(chat !== null && typeof chat === "object", "CQA_CHAT_CONFIGURATION_INVALID");
  exactKeys(chat, ["transportVersion", "endpoint", "credentialRef", "credentialRevision"]);
  text(chat.endpoint); text(chat.credentialRef); text(chat.credentialRevision);
  const endpoint = new URL(chat.endpoint);
  requireValue(chat.transportVersion === "accord.magicchat-websocket-transport/v2" && endpoint.protocol === "wss:" &&
    !endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search &&
    chat.credentialRef !== binding.runtime.controlCredentialRef, "CQA_CHAT_CONFIGURATION_INVALID");
}

/** One bounded pilot aggregate, using the R004 transaction pattern without importing its owner or wire. */
export class R005CqaConsumer {
  readonly #db: DatabaseSync;
  readonly #binding: CqaBinding;
  readonly #bindingDigest: string;
  readonly #clock: () => number;
  #running = false;
  #flushing = false;
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
          const state: CqaSnapshot = { version: 3, binding: this.#binding, lastNow: this.#now(), operations: [], responses: [], audit: [], auditTruncated: false };
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
    requireValue(state.version === 3 && cqaBindingDigest(state.binding) === this.#bindingDigest, "CQA_STATE_OR_BINDING_DRIFT");
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
      now < frozen.deadline && now < frozen.grant.expiresAt &&
      (state.chat === undefined || (!state.chat.draft?.stopped && now < state.chat.configuration.expiresAt));
  }
  #suppress(state: CqaSnapshot, operationId?: string): void {
    for (const response of state.responses) if (operationId === undefined || response.operationId === operationId) response.state = "suppressed";
    if (state.chat) {
      for (const send of state.chat.sends) if (send.state === "ready" &&
        (operationId === undefined || send.operationId === operationId)) send.state = "suppressed";
      for (const artifact of state.chat.artifacts) if (artifact.state === "pending" &&
        (operationId === undefined || artifact.operationId === operationId)) artifact.state = "invalidated";
    }
  }

  configureChat(configuration: CqaChatConfiguration): void {
    validateCqaChatConfiguration(this.#binding, configuration);
    this.#change((state, now) => {
      if (state.chat) {
        requireValue(canonical(state.chat.configuration) === canonical(configuration), "CQA_CHAT_CONFIGURATION_DRIFT");
        return;
      }
      requireValue(configuration.expiresAt > now, "CQA_CHAT_AUTHORIZATION_EXPIRED");
      requireValue(!state.activeCase && state.operations.length === 0, "CQA_CHAT_REQUIRES_NEW_AGGREGATE");
      state.chat = { configuration: structuredClone(configuration), cursor: 0, acknowledgedCursor: 0, ackRequests: [],
        receipts: [], messages: [], sends: [], artifacts: [], decisions: [] };
    });
  }
  #queueChat(state: CqaSnapshot, key: string, content: string, kind: CqaChatState["sends"][number]["kind"] = "feedback",
    operationId?: string, artifactId?: string, body?: MagicChatMessageBody): void {
    const chat = state.chat!; const active = state.activeCase!;
    const id = cqaChatId("send", this.#binding.appId, active.id, key);
    if (chat.sends.some(send => send.id === id)) return;
    requireValue(Buffer.byteLength(content) <= 4096, "CQA_CHAT_RENDER_TOO_LARGE");
    chat.sends.push({ id, caseId: active.id, revision: active.revision, kind,
      body: normalizeMagicChatMessageBodyForSend(body ?? { type: "text", content }), state: "ready",
      ...(operationId === undefined ? {} : { operationId }), ...(artifactId === undefined ? {} : { artifactId }) });
  }
  #chatCurrent(state: CqaSnapshot, operation: CqaOperation, now: number): boolean {
    const active = state.activeCase; const chat = state.chat!;
    return active?.state === "active" && !chat.draft?.stopped && active.id === operation.frozen.request.caseId &&
      active.revision === operation.frozen.contextRevision && active.contextDigest === operation.frozen.request.contextDigest &&
      !operation.revoked && !operation.cancelRequested && now < operation.frozen.grant.expiresAt &&
      now < chat.configuration.expiresAt;
  }
  #prepareChat(state: CqaSnapshot, now: number): void {
    const chat = state.chat; const draft = chat?.draft; const active = state.activeCase;
    if (!chat || !draft || !active || active.state !== "active" || draft.stopped || !draft.pending ||
      cqaMissingField(draft) !== undefined || now >= chat.configuration.expiresAt) return;
    for (const operation of state.operations) if (operation.state === "accepted" && !this.#fresh(state, operation, now)) operation.state = "expired";
    if (state.operations.some(operation => operation.state === "unknown" || operation.state === "accepted") ||
      chat.sends.some(send => send.state === "unknown")) return;
    if (state.operations.length >= this.#binding.maxOperations) {
      draft.pending = false;
      this.#queueChat(state, `budget-${draft.messageId}`, "本次授权的总查询次数已用完；不会继续调用。已有操作记录保留，可用 /status 查看。");
      return;
    }
    const operationId = cqaChatId("operation", this.#binding.appId, this.#binding.conversationId, draft.messageId);
    const activityId = cqaChatId("activity", operationId);
    this.#accept(state, now, {
      operationId, messageId: draft.messageId, messageSequence: draft.messageSequence,
      appId: this.#binding.appId, conversationId: this.#binding.conversationId, actorId: this.#binding.actorId,
      workflowRunId: active.workflowRunId, activityId, contextRevision: active.revision,
      requestWire: JSON.stringify({ schemaVersion: "cqa.query/v1", requestId: operationId, ...draft.fields,
        caseId: active.id, invocationId: activityId, contextDigest: active.contextDigest }),
      grant: { id: cqaChatId("grant", chat.configuration.authorizationId, operationId),
        revision: chat.configuration.authorizationRevision, actorId: this.#binding.actorId,
        purpose: "synthetic-compliance-query", corpusDigest: this.#binding.corpusDigest, bindingDigest: this.#bindingDigest,
        expiresAt: chat.configuration.expiresAt, maxStarts: 1, maxModelCalls: this.#binding.generationMode === "llm" ? 1 : 0,
        outboundScope: this.#binding.mode === "managed" ? "synthetic-cqa-managed" : "offline-only", recoveryAllowed: true },
    }, true);
    draft.pending = false;
  }
  #exportChat(state: CqaSnapshot, now: number, messageId: string): void {
    const chat = state.chat!; const active = state.activeCase!;
    const operation = state.operations.find(item => item.state === "complete" && this.#chatCurrent(state, item, now));
    if (!operation?.candidate || !["REFERENCE_ONLY", "DRAFT_READY"].includes(operation.candidate.result.status)) {
      this.#queueChat(state, messageId, "当前没有可正式接受的候选。缺少证据、待复核或已过时的结果不能通过确认变成合格产物。请先补充或完成查询。");
      return;
    }
    const existing = chat.artifacts.find(item => item.operationId === operation.frozen.operationId);
    if (existing) {
      if (existing.state === "pending" && now >= existing.expiresAt) existing.state = "expired";
      this.#queueChat(state, messageId, existing.state === "accepted" ? "已记录对精确产物的接受；交付状态请用 /status 查看，不重复导出。"
        : existing.state === "pending" ? "请在已发送的确认卡上选择接受或拒绝；自由文本同意不会批准。"
          : "原确认已拒绝、过期或失效；请先明确补充或修改问题，取得新候选后再导出。");
      return;
    }
    const content = renderCqaCandidate(operation.candidate, operation.frozen.request);
    if (content === undefined) { this.#queueChat(state, messageId, CQA_NARROW_SCOPE); return; }
    const revision = chat.artifacts.length + 1;
    const digest = cqaSha256(content); const id = cqaChatId("artifact", active.id, revision, digest);
    const expiresAt = Math.min(now + 15 * 60_000, chat.configuration.expiresAt, operation.frozen.grant.expiresAt);
    const choiceContent = `【精确产物预览；尚未接受，非法律/认证结论】\nArtifact 修订 ${revision}\nSHA-256 ${digest}\n确认截止 ${new Date(expiresAt).toISOString()}\n\n${content}\n\n仅接受下方这份完整可见内容并交付原私聊；拒绝不会导出。`;
    if (Buffer.byteLength(choiceContent) > 4096) { this.#queueChat(state, messageId, CQA_NARROW_SCOPE); return; }
    const choiceBody = { type: "choice", content_type: "text", content: choiceContent, selection: "single",
      options: [{ id: "accept", label: "接受精确产物并交付本私聊" }, { id: "reject", label: "拒绝，不导出" }] } as const;
    this.#queueChat(state, id, choiceContent, "choice", operation.frozen.operationId, id, choiceBody);
    chat.artifacts.push({ id, revision, digest, text: content, operationId: operation.frozen.operationId,
      caseId: active.id, contextRevision: active.revision, contextDigest: active.contextDigest,
      actorId: this.#binding.actorId, conversationId: this.#binding.conversationId, createdAt: now, expiresAt,
      choiceSendId: cqaChatId("send", this.#binding.appId, active.id, id), choiceBody, state: "pending" });
  }
  #choiceChat(state: CqaSnapshot, now: number, event: NormalizedMagicChatChoiceResponseCreated, digest: string): "received" | "replayed" {
    const chat = state.chat!;
    const previous = chat.decisions.find(item => item.responseId === event.responseId);
    if (previous) {
      requireValue(previous.digest === digest, "CQA_CHAT_CHOICE_IDENTITY_CONFLICT");
      return "replayed";
    }
    requireValue(chat.decisions.length < 256, "CQA_CHAT_PILOT_LIMIT");
    const send = chat.sends.find(item => item.kind === "choice" && item.messageId === event.messageId);
    const artifact = chat.artifacts.find(item => item.id === send?.artifactId);
    const operation = state.operations.find(item => item.frozen.operationId === artifact?.operationId);
    const responseAt = Date.parse(event.responseCreatedAt);
    const active = state.activeCase;
    let outcome: CqaChatState["decisions"][number]["outcome"] = "invalid";
    if (artifact?.state === "pending" && now >= artifact.expiresAt) { artifact.state = "expired"; outcome = "expired"; }
    if (artifact?.state === "pending" && operation && send?.state === "sent" && this.#chatCurrent(state, operation, now) &&
      artifact.actorId === event.actorId && artifact.conversationId === event.conversationId &&
      active !== undefined && artifact.caseId === active.id && artifact.contextRevision === active.revision &&
      artifact.contextDigest === active.contextDigest && cqaSha256(artifact.text) === artifact.digest &&
      send.messageSequence === event.messageSequence && send.messageCreatedAt === event.messageCreatedAt &&
      canonical(event.choiceBody) === canonical(artifact.choiceBody) &&
      responseAt >= artifact.createdAt && responseAt <= now && responseAt < artifact.expiresAt) {
      outcome = event.optionIds[0] === "accept" ? "accepted" : "rejected";
      artifact.state = outcome;
      if (outcome === "accepted") this.#queueChat(state, `formal-${artifact.id}`, artifact.text, "formal", artifact.operationId, artifact.id);
      else this.#queueChat(state, `reject-${artifact.id}`, "已记录拒绝；不会导出。您可以补充或修改问题后重新查询。");
    }
    chat.decisions.push({ responseId: event.responseId, digest, actorId: event.actorId, conversationId: event.conversationId,
      messageId: event.messageId, optionId: event.optionIds[0]!, at: now, outcome,
      ...(artifact === undefined ? {} : { artifactId: artifact.id }) });
    return "received";
  }
  receive(wire: unknown): "received" | "replayed" | "confirmed" {
    const event = normalizeMagicChatEnvelope(wire, "r005");
    const outcome = this.#change((state, now) => {
      const chat = state.chat; requireValue(chat, "CQA_CHAT_NOT_CONFIGURED");
      if (event.kind === "RESPONSE") {
        requireValue(event.ok, "CQA_CHAT_SERVER_REJECTED");
        const cursor = chat.ackRequests.find(item => event.requestEnvelopeId === cqaChatId("ack", this.#binding.appId, item));
        if (cursor !== undefined) {
          requireValue(Object.keys(event.payload).join() === "cursor" && event.payload["cursor"] === cursor, "CQA_CHAT_ACK_MISMATCH");
          chat.acknowledgedCursor = Math.max(chat.acknowledgedCursor, cursor); return "confirmed";
        }
        const send = chat.sends.find(item => item.id === event.requestEnvelopeId);
        requireValue(send && (send.state === "unknown" || send.state === "sent"), "CQA_CHAT_UNEXPECTED_RESPONSE");
        const payload = parseMagicChatMessageSendPayload(event.payload);
        requireValue(payload.conversation.id === this.#binding.conversationId && payload.conversation.type === "app" &&
          payload.message.sender.type === "app" && payload.message.sender.id === this.#binding.appId &&
          canonical(payload.message.body) === canonical(send.body) &&
          (send.messageId === undefined || (send.messageId === payload.message.id && send.messageSequence === payload.message.seq &&
            send.messageCreatedAt === payload.message.created_at)) &&
          !chat.sends.some(other => other.id !== send.id && other.messageId === payload.message.id), "CQA_CHAT_SEND_MISMATCH");
        send.state = "sent"; send.messageId = payload.message.id;
        send.messageSequence = payload.message.seq; send.messageCreatedAt = payload.message.created_at;
        return "confirmed";
      }
      const raw = wire as { payload: { conversation: { type: string; created_by_app_id?: string } } };
      requireValue(raw.payload.conversation.type === "app" &&
        (raw.payload.conversation.created_by_app_id === undefined || raw.payload.conversation.created_by_app_id === this.#binding.appId),
      "CQA_CHAT_SCOPE_MISMATCH");
      if (event.kind === "MESSAGE_CREATED") requireValue(event.actorId === this.#binding.actorId &&
        event.conversationId === this.#binding.conversationId, "CQA_CHAT_SCOPE_MISMATCH");
      const { cursor: _cursor, envelopeEventId: _eventId, ...identity } = event;
      const digest = cqaSha256(canonical(identity));
      const receipt = chat.receipts.find(item => item.cursor === event.cursor);
      requireValue(!receipt || (receipt.digest === digest && receipt.eventId === event.envelopeEventId), "CQA_CHAT_CURSOR_CONFLICT");
      const priorEvent = chat.receipts.find(item => item.eventId === event.envelopeEventId);
      requireValue(!priorEvent || priorEvent.digest === digest, "CQA_CHAT_EVENT_CONFLICT");
      requireValue(receipt || event.cursor > chat.cursor, "CQA_CHAT_CURSOR_OUT_OF_ORDER");
      requireValue(receipt || chat.receipts.length < 512, "CQA_CHAT_PILOT_LIMIT");
      if (!receipt) chat.receipts.push({ cursor: event.cursor, eventId: event.envelopeEventId, digest });
      chat.cursor = Math.max(chat.cursor, event.cursor);
      if (event.kind === "CHOICE_RESPONSE_CREATED") return this.#choiceChat(state, now, event, digest);
      const existing = chat.messages.find(item => item.id === event.messageId);
      if (existing) { requireValue(existing.digest === digest, "CQA_CHAT_MESSAGE_CONFLICT"); return "replayed"; }
      requireValue(chat.messages.length < 256, "CQA_CHAT_PILOT_LIMIT");
      requireValue(!chat.messages.some(item => item.sequence >= event.messageSequence), "CQA_CHAT_MESSAGE_OUT_OF_ORDER");
      if (!state.activeCase || state.activeCase.state === "closed") {
        const id = cqaChatId("case", this.#binding.appId, event.conversationId, event.messageId);
        state.activeCase = { id, workflowRunId: cqaChatId("workflow", id), revision: 0, contextDigest: cqaSha256(id),
          sequence: event.messageSequence, state: "active", outcome: "needs_input" };
        chat.draft = { caseId: id, fields: {}, messageId: event.messageId, messageSequence: event.messageSequence, pending: false, stopped: false };
      }
      const active = state.activeCase; const draft = chat.draft!;
      if (event.body === "/status") {
        const current = state.operations.filter(item => item.frozen.request.caseId === active.id).at(-1);
        const unknownSend = chat.sends.some(item => item.state === "unknown");
        const formal = chat.sends.filter(item => item.kind === "formal" && item.caseId === active.id).at(-1);
        this.#queueChat(state, event.messageId, `当前事项：${draft.stopped ? "已停止" : active.outcome}；查询：${current?.state ?? "尚未提交"}${current?.error ? `（${current.error}）` : ""}。\n${unknownSend ? "有发送确认未知，必须先核对原发送；不重发或替换。" : `正式交付：${formal?.state ?? "尚未接受/交付"}。`}\n${cqaFieldPrompt(draft) ?? "后续问题可沿用您明确提供的范围；结束后用 /new 开始新事项。"}`);
      } else if (event.body === "/export" || event.body === "导出") this.#exportChat(state, now, event.messageId);
      else if (event.body === "同意") this.#queueChat(state, event.messageId, "自由文本同意不会批准。请先 /export 查看完整精确产物，再在确认卡选择接受或拒绝。");
      else if (event.body === "/new") {
        if (state.operations.some(item => item.state === "unknown" || item.state === "accepted") || chat.sends.some(item => item.state === "unknown")) {
          this.#queueChat(state, event.messageId, "原操作或发送仍未解决，不能开始新事项；请用 /status 查看。不会替换未知操作。");
        } else {
          this.#suppress(state); draft.pending = false; active.state = "closed";
          this.#queueChat(state, event.messageId, "当前事项已结束。请发送新事项的问题；日期、行业等范围须重新明确。");
        }
      } else {
        active.revision++; active.sequence = event.messageSequence; active.contextDigest = cqaSha256(canonical([active.contextDigest, digest]));
        active.outcome = "needs_input"; this.#suppress(state);
        draft.messageId = event.messageId; draft.messageSequence = event.messageSequence; draft.pending = false;
        if (event.body === "/stop" || event.body === "停止") {
          draft.stopped = true;
          for (const operation of state.operations) if (operation.state === "accepted" || operation.state === "unknown") {
            operation.cancelRequested = true; this.#audit(state, operation.frozen.operationId, "CANCEL_REQUESTED", now);
            if (operation.state === "accepted") operation.state = "expired";
          }
          this.#queueChat(state, event.messageId, "已停止新的查询；在途 Run 及远端调用是否结束仍需核对，取消请求不代表远端已停止。");
        } else if (draft.stopped) this.#queueChat(state, event.messageId, "当前事项已停止；原操作解决后用 /new 开始新事项。");
        else {
          draft.pending = true;
          const prompt = collectCqaFields(draft, event.body);
          if (prompt) this.#queueChat(state, event.messageId, prompt);
          this.#prepareChat(state, now);
          if (draft.pending && cqaMissingField(draft) === undefined) this.#queueChat(state, event.messageId,
            "已保存新的问题与范围；原操作或发送仍未确认，暂不提交新查询。旧候选及确认卡已失效。");
        }
      }
      chat.messages.push({ id: event.messageId, sequence: event.messageSequence, body: event.body, digest,
        caseId: state.activeCase.id, contextRevision: state.activeCase.revision, contextDigest: state.activeCase.contextDigest });
      return "received";
    });
    if (outcome === "received" && event.kind === "MESSAGE_CREATED" && (event.body === "/stop" || event.body === "停止")) this.#controller?.abort();
    return outcome;
  }
  /** A socket write is not delivery. Unknown sends are never retried or recovered by body matching. */
  async flush(send: (request: MagicChatRequestEnvelope) => Promise<void>): Promise<void> {
    requireValue(!this.#flushing, "CQA_CHAT_FLUSH_BUSY"); this.#flushing = true;
    const boundedSend = async (request: MagicChatRequestEnvelope, remaining: number): Promise<void> => {
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([send(request), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("CQA_CHAT_SEND_UNKNOWN")), Math.min(10_000, remaining));
      })]); } finally { clearTimeout(timer); }
    };
    try {
      const ack = this.#change((state, now) => {
        const chat = state.chat; requireValue(chat, "CQA_CHAT_NOT_CONFIGURED");
        if (now >= chat.configuration.expiresAt || chat.cursor <= chat.acknowledgedCursor) return undefined;
        if (!chat.ackRequests.includes(chat.cursor)) chat.ackRequests.push(chat.cursor);
        return { cursor: chat.cursor, remaining: chat.configuration.expiresAt - now };
      });
      if (ack) await boundedSend({ v: 1, id: cqaChatId("ack", this.#binding.appId, ack.cursor), kind: "request",
        method: "events.ack", payload: { cursor: ack.cursor } }, ack.remaining);
      const dispatch = this.#change((state, now) => {
        const chat = state.chat!;
        if (now >= chat.configuration.expiresAt || chat.sends.some(item => item.state === "unknown")) return undefined;
        for (const item of chat.sends) {
          if (item.state !== "ready") continue;
          const operation = state.operations.find(value => value.frozen.operationId === item.operationId);
          const artifact = chat.artifacts.find(value => value.id === item.artifactId);
          const active = state.activeCase;
          if (!active || item.caseId !== active.id || item.revision !== active.revision ||
            (operation !== undefined && !this.#chatCurrent(state, operation, now)) ||
            (item.kind === "choice" && (!artifact || artifact.state !== "pending" || now >= artifact.expiresAt)) ||
            (item.kind === "formal" && (!artifact || artifact.state !== "accepted" || cqaSha256(artifact.text) !== artifact.digest ||
              canonical(item.body) !== canonical({ type: "text", content: artifact.text })))) {
            item.state = "suppressed"; continue;
          }
          item.state = "unknown";
          return { request: { v: 1, id: item.id, kind: "request", method: "message.send", payload: {
            target: { type: "conversation", conversation_id: this.#binding.conversationId }, message: item.body,
          } } satisfies MagicChatRequestEnvelope, remaining: chat.configuration.expiresAt - now };
        }
        return undefined;
      });
      if (dispatch) await boundedSend(dispatch.request, dispatch.remaining);
    } finally { this.#flushing = false; }
  }

  accept(input: CqaAcceptance): CqaOperation {
    return this.#change((state, now) => this.#accept(state, now, input));
  }
  #accept(state: CqaSnapshot, now: number, input: CqaAcceptance, chatContext = false): CqaOperation {
    const request = parseCqaRequest(input.requestWire); const requestBytes = cqaRequestBytes(request);
    for (const value of [input.operationId, input.workflowRunId, input.activityId]) identifier(value);
    if (!chatContext) identifier(input.messageId);
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
          (chatContext
            ? input.contextRevision === active.revision && input.messageSequence === active.sequence && request.contextDigest === active.contextDigest
            : input.contextRevision === active.revision + 1 && input.messageSequence > active.sequence), "CQA_CASE_CONTEXT_CONFLICT");
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
  }
  revoke(operationId: string, retainRecovery: boolean): void {
    requireValue(typeof retainRecovery === "boolean", "CQA_RECOVERY_PERMISSION_INVALID");
    this.#change((state, now) => {
      const operation = this.#operation(state, operationId); operation.revoked = true;
      operation.recoveryAllowed = operation.recoveryAllowed && retainRecovery;
      this.#suppress(state, operationId); this.#audit(state, operationId, "REVOKED", now);
      if (state.chat?.draft) state.chat.draft.pending = false;
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
      requireValue(!state.chat?.sends.some(item => item.state === "unknown"), "CQA_CASE_UNRESOLVED");
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
        if (state.chat && !operation.candidate && this.#fresh(state, operation, now)) this.#queueChat(state,
          `failure-${operationId}`, "查询执行未获完整有效确认，未产生候选或正式结论。可用 /status 查看实际状态。", "feedback", operationId);
        return operation.state;
      }
      let candidate: CqaCandidate;
      try { candidate = parseCqaResult(run.output, { ...this.#binding, request: operation.frozen.request, inputDigest: operation.frozen.inputDigest }); }
      catch {
        this.#audit(state, operationId, "RESULT_REJECTED", now);
        if (!operation.candidate) { operation.state = "failed"; operation.error = "CQA_RESULT_INVALID"; }
        if (state.chat && !operation.candidate && this.#fresh(state, operation, now)) this.#queueChat(state,
          `failure-${operationId}`, "查询结果未通过合同或来源核对，未产生候选或正式结论；不会放宽校验或猜测缺失证据。", "feedback", operationId);
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
      if (state.chat) {
        const content = renderCqaCandidate(candidate, operation.frozen.request);
        this.#queueChat(state, `candidate-${operationId}`, content ?? CQA_NARROW_SCOPE, "candidate", operationId);
      }
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
        this.#prepareChat(state, now);
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
  close(): void { requireValue(!this.#running && !this.#flushing, "CQA_CONSUMER_BUSY"); this.#db.close(); }
}
