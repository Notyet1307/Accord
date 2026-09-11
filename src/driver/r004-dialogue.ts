import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeMagicChatEnvelope, parseMagicChatMessageSendPayload } from "../contracts/magicchat.js";
import { boundedDialogueText, dialogueCanonical, dialogueDigest, dialogueId, dialogueIdentifier,
  parseDialogueResult, SAS_DIALOGUE_VERSION, type DialogueContext, type DialogueRequest,
  type DialogueResult } from "../contracts/sas-dialogue.js";
import type { MagicChatRequestEnvelope } from "../magicchat/adapter.js";

export interface DialogueBinding {
  readonly mode: "offline";
  readonly appId: string;
  readonly conversationId: string;
  readonly actorId: string;
  readonly agentRevision: string;
  readonly model: string;
  readonly policyRevision: string;
  readonly maxOperations: number;
  readonly timeoutMs: number;
}
/** Local conformance seam only. No live binding exists until SAS qualifies tools=none. */
export interface OfflineDialoguePort {
  submit(request: DialogueRequest, signal: AbortSignal): Promise<unknown>;
  lookup(operationId: string, inputFingerprint: string, signal: AbortSignal): Promise<unknown | undefined>;
}
interface Message {
  id: string; sequence: number; content: string; digest: string; caseId: string; revision: number;
  state: "pending" | "consumed";
}
interface Operation {
  request: DialogueRequest;
  state: "accepted" | "unknown" | "complete" | "failed" | "expired";
  result?: DialogueResult;
  error?: string;
}
interface Response {
  id: string; caseId: string; revision: number; content: string;
  state: "ready" | "unknown" | "sent" | "suppressed";
  messageId?: string;
}
interface PilotCase {
  id: string; workflowId: string; revision: number; state: "active" | "stopped" | "closed";
  history: DialogueContext[];
}
export interface DialogueSnapshot {
  version: 1;
  binding: DialogueBinding;
  cursor: number;
  acknowledgedCursor: number;
  ackRequests: number[];
  receipts: Record<string, string>;
  cases: PilotCase[];
  messages: Message[];
  operations: Operation[];
  responses: Response[];
}

function validateBinding(binding: DialogueBinding): void {
  if (Object.keys(binding).sort().join() !== ["mode", "appId", "conversationId", "actorId", "agentRevision", "model",
    "policyRevision", "maxOperations", "timeoutMs"].sort().join() || binding.mode !== "offline") throw new Error("DIALOGUE_LIVE_DISABLED");
  for (const value of [binding.appId, binding.conversationId, binding.actorId, binding.agentRevision, binding.model, binding.policyRevision]) dialogueIdentifier(value);
  if (!Number.isSafeInteger(binding.maxOperations) || binding.maxOperations < 1 || binding.maxOperations > 100 ||
    !Number.isSafeInteger(binding.timeoutMs) || binding.timeoutMs < 1 || binding.timeoutMs > 120_000) throw new Error("DIALOGUE_BUDGET_INVALID");
}
function safePath(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("DIALOGUE_DATABASE_PATH_INVALID");
  for (let current = path; ; current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error("DIALOGUE_DATABASE_SYMLINK"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (dirname(current) === current) break;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { if (!lstatSync(path + suffix).isFile()) throw new Error("DIALOGUE_DATABASE_PATH_INVALID"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
}

/** One bounded pilot aggregate in its own SQLite file; never opens an R003 schema. */
export class R004Dialogue {
  readonly #db: DatabaseSync;
  readonly #binding: DialogueBinding;
  #running = false;
  #controller: AbortController | undefined;

  constructor(path: string, binding: DialogueBinding) {
    validateBinding(binding);
    safePath(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    safePath(path);
    this.#binding = structuredClone(binding);
    this.#db = new DatabaseSync(path);
    try {
      const tables = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.some(row => row["name"] !== "r004_dialogue")) throw new Error("DIALOGUE_DATABASE_FOREIGN_SCHEMA");
      chmodSync(path, 0o600);
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.#db.exec("CREATE TABLE IF NOT EXISTS r004_dialogue (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;");
      const fresh: DialogueSnapshot = { version: 1, binding: this.#binding, cursor: 0, acknowledgedCursor: 0, ackRequests: [],
        receipts: {}, cases: [], messages: [], operations: [], responses: [] };
      const body = dialogueCanonical(fresh);
      this.#db.prepare("INSERT OR IGNORE INTO r004_dialogue VALUES (1,?,?)").run(body, dialogueDigest(fresh));
      this.snapshot();
    } catch (error) { this.#db.close(); throw error; }
  }

  snapshot(): DialogueSnapshot {
    const row = this.#db.prepare("SELECT body,digest FROM r004_dialogue WHERE id=1").get();
    if (typeof row?.["body"] !== "string") throw new Error("DIALOGUE_STATE_INVALID");
    const state = JSON.parse(row["body"]) as DialogueSnapshot;
    if (dialogueDigest(state) !== row["digest"] || state.version !== 1 ||
      dialogueCanonical(state.binding) !== dialogueCanonical(this.#binding)) throw new Error("DIALOGUE_STATE_OR_BINDING_DRIFT");
    return state;
  }
  #change<T>(fn: (state: DialogueSnapshot) => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      const result = fn(state);
      this.#db.prepare("UPDATE r004_dialogue SET body=?,digest=? WHERE id=1").run(dialogueCanonical(state), dialogueDigest(state));
      this.#db.exec("COMMIT");
      return result;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  receive(wire: unknown): "received" | "replayed" | "confirmed" {
    const event = normalizeMagicChatEnvelope(wire, "r004");
    if (event.kind === "RESPONSE") {
      if (!event.ok) throw new Error("DIALOGUE_MAGICCHAT_REJECTED");
      return this.#change(state => {
        const cursor = state.ackRequests.find(item => event.requestEnvelopeId === dialogueId("ack", this.#binding.appId, String(item)));
        if (cursor !== undefined) {
          if (event.payload["cursor"] !== cursor || Object.keys(event.payload).join() !== "cursor") throw new Error("DIALOGUE_ACK_MISMATCH");
          state.acknowledgedCursor = Math.max(state.acknowledgedCursor, cursor);
          return "confirmed";
        }
        const response = state.responses.find(item => item.id === event.requestEnvelopeId);
        if (!response || (response.state !== "unknown" && response.state !== "sent")) throw new Error("DIALOGUE_UNEXPECTED_RESPONSE");
        const payload = parseMagicChatMessageSendPayload(event.payload);
        if (payload.conversation.id !== this.#binding.conversationId || payload.conversation.type !== "app" ||
          payload.message.sender.type !== "app" || payload.message.sender.id !== this.#binding.appId ||
          payload.message.body.type !== "text" || payload.message.body.content !== response.content) throw new Error("DIALOGUE_SEND_MISMATCH");
        if (response.messageId && response.messageId !== payload.message.id) throw new Error("DIALOGUE_SEND_MISMATCH");
        if (response.state !== "sent") {
          response.state = "sent";
          response.messageId = payload.message.id;
          const active = state.cases.find(item => item.id === response.caseId)!;
          active.history.push({ message_id: payload.message.id, role: "assistant", content: response.content });
        }
        return "confirmed";
      });
    }
    if (event.kind !== "MESSAGE_CREATED") throw new Error("DIALOGUE_EVENT_UNSUPPORTED");
    // The shared R003 parser allows groups; the pilot deliberately accepts only App private chat.
    const raw = wire as { payload: { conversation: { type: string } } };
    if (raw.payload.conversation.type !== "app" || event.conversationId !== this.#binding.conversationId || event.actorId !== this.#binding.actorId) {
      throw new Error("DIALOGUE_SCOPE_MISMATCH");
    }
    const digest = dialogueDigest([event.messageId, event.messageSequence, event.body, event.actorId, event.conversationId, event.messageCreatedAt]);
    dialogueIdentifier(event.messageId);
    const outcome = this.#change(state => {
      const receipt = state.receipts[String(event.cursor)];
      if (receipt && receipt !== digest) throw new Error("DIALOGUE_CURSOR_CONFLICT");
      const existing = state.messages.find(item => item.id === event.messageId);
      if (existing && existing.digest !== digest) throw new Error("DIALOGUE_MESSAGE_CONFLICT");
      if (!receipt && event.cursor <= state.cursor) throw new Error("DIALOGUE_CURSOR_OUT_OF_ORDER");
      if (Object.keys(state.receipts).length >= 512 && !receipt) throw new Error("DIALOGUE_PILOT_LIMIT");
      state.receipts[String(event.cursor)] = digest;
      state.cursor = Math.max(state.cursor, event.cursor);
      if (existing) return "replayed" as const;
      if (state.messages.length >= 256) throw new Error("DIALOGUE_PILOT_LIMIT");
      if (state.messages.some(item => item.sequence >= event.messageSequence)) throw new Error("DIALOGUE_MESSAGE_OUT_OF_ORDER");
      let active = state.cases.find(item => item.state !== "closed");
      if (!active) {
        const id = dialogueId("case", this.#binding.appId, event.conversationId, event.messageId);
        active = { id, workflowId: dialogueId("workflow", id), revision: 0, state: "active", history: [] };
        state.cases.push(active);
      }
      active.revision++;
      const message: Message = { id: event.messageId, sequence: event.messageSequence, content: event.body,
        digest, caseId: active.id, revision: active.revision, state: "pending" };
      state.messages.push(message);
      for (const response of state.responses) if (response.caseId === active.id && response.state === "ready") response.state = "suppressed";
      if (event.body === "/stop" || event.body === "停止") {
        active.state = "stopped"; message.state = "consumed";
        this.#queueResponse(state, active, message.id, "已停止后续处理；在途操作是否结束仍需查询确认。");
      } else if (event.body === "/new") {
        const uncertain = state.operations.some(item => item.state === "unknown") || state.responses.some(item => item.state === "unknown");
        message.state = "consumed";
        if (uncertain) this.#queueResponse(state, active, message.id, "前一项操作或消息的状态尚未确认，暂时不能开始新事件。");
        else { active.state = "closed"; this.#queueResponse(state, active, message.id, "当前事件已结束。请发送新事件的材料。"); }
      } else if (active.state === "stopped") {
        message.state = "consumed";
        this.#queueResponse(state, active, message.id, "当前事件已停止；发送 /new 明确开始新事件。");
      } else if (Buffer.byteLength(event.body) > 8192) {
        message.state = "consumed";
        this.#queueResponse(state, active, message.id, "消息超过 8 KiB，请缩短后重新发送。");
      }
      return "received" as const;
    });
    if (outcome === "received" && (event.body === "/stop" || event.body === "停止")) this.#controller?.abort();
    return outcome;
  }
  #queueResponse(state: DialogueSnapshot, active: PilotCase, key: string, content: string): void {
    const id = dialogueId("response", active.id, key);
    if (!state.responses.some(item => item.id === id)) state.responses.push({ id, caseId: active.id, revision: active.revision, content, state: "ready" });
  }

  /** Sends only committed intents. The caller feeds correlated official responses back to receive(). */
  async flush(send: (request: MagicChatRequestEnvelope) => Promise<void>): Promise<void> {
    const state = this.snapshot();
    if (state.cursor > state.acknowledgedCursor) {
      this.#change(current => { if (!current.ackRequests.includes(state.cursor)) current.ackRequests.push(state.cursor); });
      await send({ v: 1, id: dialogueId("ack", this.#binding.appId, String(state.cursor)), kind: "request", method: "events.ack", payload: { cursor: state.cursor } });
    }
    for (const item of this.snapshot().responses) {
      if (item.state !== "ready" && item.state !== "unknown") continue;
      const dispatch = this.#change(current => {
        const response = current.responses.find(value => value.id === item.id)!;
        const active = current.cases.find(value => value.id === response.caseId)!;
        if (response.state === "sent" || response.state === "suppressed") return undefined;
        if (active.revision !== response.revision) {
          if (response.state === "ready") response.state = "suppressed";
          return undefined; // Unknown sends cannot be retried against newer context.
        }
        response.state = "unknown";
        return { v: 1, id: response.id, kind: "request", method: "message.send", payload: {
          target: { type: "conversation", conversation_id: this.#binding.conversationId },
          message: { type: "text", content: response.content },
        } } as const;
      });
      if (dispatch) await send(dispatch);
    }
  }

  #prepare(now: number): Operation | undefined {
    return this.#change(state => {
      const unknown = state.operations.find(item => item.state === "unknown");
      if (unknown) return structuredClone(unknown);
      const accepted = state.operations.find(item => item.state === "accepted");
      if (accepted) {
        const active = state.cases.find(item => item.id === accepted.request.case_id)!;
        if (active.state === "active" && active.revision === accepted.request.context_revision && Date.parse(accepted.request.deadline) > now) return structuredClone(accepted);
        accepted.state = "expired";
        if (active.state === "active" && active.revision === accepted.request.context_revision) this.#queueResponse(state, active, accepted.request.operation_id, "本次调用的有效时间已过，未提交执行。请重新发起咨询。");
      }
      // Preserve ordering when a prior reply may have been physically sent.
      if (state.responses.some(item => item.state === "unknown" || item.state === "ready")) return undefined;
      const active = state.cases.find(item => item.state === "active");
      if (!active) return undefined;
      const pending = state.messages.filter(item => item.caseId === active.id && item.state === "pending");
      const latest = pending.at(-1);
      if (!latest) return undefined;
      if (state.operations.length >= this.#binding.maxOperations) {
        for (const message of pending) message.state = "consumed";
        this.#queueResponse(state, active, latest.id, "本地试点的调用预算已用完，未发起新的调用。");
        return undefined;
      }
      for (const message of pending) {
        boundedDialogueText(message.content, 8192);
        active.history.push({ message_id: message.id, role: "user", content: message.content });
        message.state = "consumed";
      }
      const before = active.history.slice(0, -1);
      const context: DialogueContext[] = [];
      let bytes = 0;
      for (const message of before.toReversed()) {
        const size = Buffer.byteLength(message.content);
        if (context.length >= 12 || bytes + size > 32768) break;
        context.unshift(message); bytes += size;
      }
      const operationId = dialogueId("operation", active.id, latest.id);
      const input: Omit<DialogueRequest, "input_fingerprint"> = {
        version: SAS_DIALOGUE_VERSION, operation_id: operationId, case_id: active.id,
        workflow_run_id: active.workflowId, activity_id: dialogueId("activity", operationId),
        agent_id: "event-triage", agent_revision: this.#binding.agentRevision,
        binding_revision: dialogueDigest(this.#binding), current_message: { id: latest.id, content: latest.content },
        context, context_revision: active.revision, context_truncated: context.length < before.length,
        deadline: new Date(now + this.#binding.timeoutMs).toISOString(), max_output_bytes: 4096, tools: "none",
      };
      const operation: Operation = { request: { ...input, input_fingerprint: dialogueDigest(input) }, state: "accepted" };
      state.operations.push(operation);
      return structuredClone(operation);
    });
  }

  /** One bounded turn or lookup. UNKNOWN never causes a fresh submission. */
  async advance(port: OfflineDialoguePort, now = Date.now()): Promise<"idle" | "complete" | "unknown" | "failed"> {
    if (this.#running) throw new Error("DIALOGUE_TURN_BUSY");
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("DIALOGUE_TIME_INVALID");
    this.#running = true;
    try {
      const operation = this.#prepare(now);
      if (!operation) return "idle";
      const request = operation.request;
      const isLookup = operation.state === "unknown";
      const remainingMs = isLookup ? this.#binding.timeoutMs : Date.parse(request.deadline) - now;
      if (!isLookup && Date.parse(request.deadline) <= now) return "failed";
      // Submission may have happened after this durable checkpoint, even if the caller crashes.
      this.#change(state => { state.operations.find(item => item.request.operation_id === request.operation_id)!.state = "unknown"; });
      const controller = new AbortController(); this.#controller = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      try {
        const call = isLookup ? port.lookup(request.operation_id, request.input_fingerprint, controller.signal)
          : port.submit(structuredClone(request), controller.signal);
        const value = await Promise.race([call, new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("DIALOGUE_INTERRUPTED")), { once: true });
          timer = setTimeout(() => { controller.abort(); reject(new Error("DIALOGUE_TIMEOUT")); }, remainingMs);
        })]);
        if (value === undefined) return "unknown";
        let result: DialogueResult;
        try { result = parseDialogueResult(value, request); }
        catch {
          this.#change(state => {
            const stored = state.operations.find(item => item.request.operation_id === request.operation_id)!;
            stored.state = "failed"; stored.error = "DIALOGUE_RESULT_INVALID";
            const waitingId = dialogueId("response", request.case_id, `${request.operation_id}:unknown`);
            const waiting = state.responses.find(item => item.id === waitingId);
            if (waiting?.state === "ready") waiting.state = "suppressed";
            const active = state.cases.find(item => item.id === request.case_id)!;
            if (active.revision === request.context_revision && active.state === "active") this.#queueResponse(state, active, request.operation_id, "助手返回的结果无法校验，本次未采用。请检查本地执行记录。");
          });
          return "failed";
        }
        this.#change(state => {
          const stored = state.operations.find(item => item.request.operation_id === request.operation_id)!;
          if (stored.result && dialogueDigest(stored.result) !== dialogueDigest(result)) throw new Error("DIALOGUE_RESULT_CONFLICT");
          stored.result = result; stored.state = "complete";
          const waitingId = dialogueId("response", request.case_id, `${request.operation_id}:unknown`);
          const waiting = state.responses.find(item => item.id === waitingId);
          if (waiting?.state === "ready") waiting.state = "suppressed";
          const active = state.cases.find(item => item.id === request.case_id)!;
          if (now + Math.ceil(performance.now() - started) > Date.parse(request.deadline)) {
            stored.state = "expired";
            if (active.revision === request.context_revision && active.state === "active") this.#queueResponse(state, active, request.operation_id, "原操作的结果已超出有效时间，仅保留执行记录，未作为当前答案采用。");
            return;
          }
          if (active.revision === request.context_revision && active.state === "active") {
            const content = result.kind === "triage_proposal" ? "材料已收到；当前对话切片尚未接通正式研判执行。" : result.text;
            this.#queueResponse(state, active, request.operation_id, content);
          }
        });
        return "complete";
      } catch {
        this.#change(state => {
          const active = state.cases.find(item => item.id === request.case_id)!;
          if (active.revision === request.context_revision && active.state === "active") this.#queueResponse(state, active, `${request.operation_id}:unknown`, "本次执行状态尚未确认，正在等待原操作的结果；未重新提交。");
        });
        return "unknown";
      } finally { if (timer) clearTimeout(timer); this.#controller = undefined; }
    } finally { this.#running = false; }
  }
  close(): void {
    if (this.#running) throw new Error("DIALOGUE_TURN_BUSY");
    this.#db.close();
  }
}
