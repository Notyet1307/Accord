import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { realpathSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { normalizeMagicChatMessageBodyForSend } from "../src/contracts/magicchat.js";
import { dialogueDigest, type DialogueRequest, type DialogueResult } from "../src/contracts/sas-dialogue.js";
import { R004Dialogue, type DialogueBinding, type OfflineDialoguePort } from "../src/driver/r004-dialogue.js";
import type { MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { magicChatMessageCreatedEnvelope, temporaryDatabase as createTemporaryDatabase } from "./fixture.js";

function temporaryDatabase(label: string) {
  const temporary = createTemporaryDatabase(label);
  const directory = realpathSync(temporary.directory);
  return { ...temporary, directory, path: join(directory, basename(temporary.path)) };
}

const binding: DialogueBinding = { mode: "offline", appId: "synthetic-app", conversationId: "conversation-1", actorId: "user-1",
  agentRevision: "event-triage.v1", model: "offline-counting-executor", policyRevision: "dialogue-no-tools.v1", maxOperations: 30, timeoutMs: 2000 };
const message = (id: number, body = "帮我看下这条告警") => magicChatMessageCreatedEnvelope({
  cursor: id, messageId: `m-${id}`, messageSequence: id * 2 - 1, actorId: binding.actorId, body,
});
function answer(request: DialogueRequest, text = "请补充告警内容和时间范围。", kind: DialogueResult["kind"] = "needs_input"): DialogueResult {
  return { version: request.version, operation_id: request.operation_id, input_fingerprint: request.input_fingerprint,
    case_id: request.case_id, workflow_run_id: request.workflow_run_id, activity_id: request.activity_id,
    run_id: `sas-${request.context_revision}`, agent_id: request.agent_id, agent_revision: request.agent_revision,
    binding_revision: request.binding_revision, context_revision: request.context_revision, kind, text };
}
function confirm(pilot: R004Dialogue, request: MagicChatRequestEnvelope): void {
  if (request.method === "conversation.messages.list") throw new Error("unexpected history call");
  pilot.receive({ v: 1, id: `ok-${request.id}`, kind: "response", reply_to: request.id, ok: true,
    payload: request.method === "events.ack" ? { cursor: request.payload.cursor } : {
      conversation: { id: binding.conversationId, name: "事件研判助手", type: "app" }, created: true,
      message: { id: request.id, seq: pilot.snapshot().cursor * 2, body: normalizeMagicChatMessageBodyForSend(request.payload.message), summary: request.payload.message.content,
        sender: { id: binding.appId, type: "app", name: "事件研判助手", nickname: "事件研判助手" }, created_at: "2026-09-10T00:00:00Z" },
    } });
}
function counter(pilot: R004Dialogue) {
  const requests: DialogueRequest[] = [];
  const port: OfflineDialoguePort = {
    submit: async request => {
      assert.equal(pilot.snapshot().operations.at(-1)?.state, "unknown", "acceptance must commit before external call");
      const { input_fingerprint, ...input } = request;
      assert.equal(input_fingerprint, dialogueDigest(input));
      assert.equal(request.tools, "none");
      requests.push(request);
      return answer(request, requests.length === 1 ? "请补充材料。" : "已收到补充信息。", requests.length === 1 ? "needs_input" : "answer");
    }, lookup: async () => undefined,
  };
  return { port, requests };
}

test("two IM turns keep one SAS identity and Case, with committed acceptance and confirmed context", async () => {
  const temporary = temporaryDatabase("r004-two-turns");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    const { port, requests } = counter(pilot);
    const visible: string[] = [];
    const send = async (request: MagicChatRequestEnvelope) => {
      if (request.method === "message.send") visible.push(request.payload.message.content);
      confirm(pilot, request);
    };
    pilot.receive(message(1));
    assert.equal(await pilot.advance(port), "complete");
    await pilot.flush(send);
    pilot.receive(message(2, "这是合成告警，时间范围是今天上午。"));
    assert.equal(await pilot.advance(port), "complete");
    await pilot.flush(send);
    assert.deepEqual(visible, ["请补充材料。", "已收到补充信息。"]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.case_id, requests[1]!.case_id);
    assert.deepEqual(requests[1]!.context.map(item => item.role), ["user", "assistant"]);
    assert.equal(pilot.snapshot().acknowledgedCursor, 2);
    assert.equal(pilot.receive({ ...message(1), id: "replay-envelope" }), "replayed");
    assert.equal(await pilot.advance(port), "idle");
    pilot.receive(message(3, "这是合成告警，时间范围是今天上午。"));
    assert.equal(await pilot.advance(port), "complete", "same text with a new message ID is new input");
    assert.equal(requests.length, 3);
  } finally { pilot.close(); temporary.cleanup(); }
});

test("lost submission response survives restart and resolves by lookup without resubmission", async () => {
  const temporary = temporaryDatabase("r004-unknown");
  let pilot = new R004Dialogue(temporary.path, binding);
  let saved: DialogueRequest | undefined;
  let calls = 0;
  try {
    pilot.receive(message(1));
    assert.equal(await pilot.advance({ submit: async request => { saved = request; calls++; throw new Error("lost"); }, lookup: async () => undefined }), "unknown");
    pilot.close(); pilot = new R004Dialogue(temporary.path, binding);
    assert.equal(await pilot.advance({ submit: async () => { throw new Error("must not submit"); }, lookup: async (id, fingerprint) => {
      assert.equal(id, saved!.operation_id); assert.equal(fingerprint, saved!.input_fingerprint); return answer(saved!);
    } }), "complete");
    assert.equal(calls, 1);
    assert.equal(pilot.snapshot().operations.length, 1);
    assert.equal(pilot.snapshot().responses.filter(item => item.state === "ready").length, 1, "obsolete unknown notice is suppressed");
  } finally { pilot.close(); temporary.cleanup(); }
});

test("new input suppresses an in-flight old answer; next turn uses fresh context", async () => {
  const temporary = temporaryDatabase("r004-freshness");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    let finish!: (value: unknown) => void;
    let first!: DialogueRequest;
    pilot.receive(message(1));
    const running = pilot.advance({ submit: request => { first = request; return new Promise(resolve => { finish = resolve; }); }, lookup: async () => undefined });
    pilot.receive(message(2, "补充：只看这个合成事件。"));
    finish(answer(first, "旧上下文的答案"));
    assert.equal(await running, "complete");
    assert.equal(pilot.snapshot().responses.length, 0);
    const { port, requests } = counter(pilot);
    await pilot.advance(port);
    assert.equal(requests[0]!.current_message.id, "m-2");
    assert.equal(requests[0]!.context[0]!.message_id, "m-1");
  } finally { pilot.close(); temporary.cleanup(); }
});

test("send recovery uses one durable client ID; delayed cumulative ACK is accepted", async () => {
  const temporary = temporaryDatabase("r004-send-recovery");
  let pilot = new R004Dialogue(temporary.path, binding);
  try {
    pilot.receive(message(1));
    const { port } = counter(pilot); await pilot.advance(port);
    const sent: MagicChatRequestEnvelope[] = [];
    await assert.rejects(pilot.flush(async request => { sent.push(request); if (request.method === "message.send") throw new Error("lost ACK"); }));
    pilot.close(); pilot = new R004Dialogue(temporary.path, binding);
    const replay: MagicChatRequestEnvelope[] = [];
    await pilot.flush(async request => { replay.push(request); confirm(pilot, request); });
    assert.equal(sent.at(-1)!.id, replay.at(-1)!.id);
    assert.equal(pilot.snapshot().responses.filter(item => item.state === "sent").length, 1);
    pilot.receive(message(2));
    confirm(pilot, sent[0]!);
    assert.equal(pilot.snapshot().acknowledgedCursor, 1);
  } finally { pilot.close(); temporary.cleanup(); }
});

test("wrong identities, group messages, malformed output and live bindings fail closed", async () => {
  const temporary = temporaryDatabase("r004-refusals");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    const wire = message(1);
    assert.throws(() => pilot.receive({ ...wire, payload: { ...wire.payload, conversation: { ...wire.payload.conversation, type: "group" } } }), /SCOPE/);
    assert.throws(() => pilot.receive(magicChatMessageCreatedEnvelope({ actorId: "other", body: "hello" })), /SCOPE/);
    pilot.receive(wire);
    assert.throws(() => pilot.receive(message(1, "different")), /CONFLICT/);
    assert.equal(await pilot.advance({ submit: async request => ({ ...answer(request), agent_revision: "wrong" }), lookup: async () => undefined }), "failed");
    assert.equal(pilot.snapshot().operations[0]!.error, "DIALOGUE_RESULT_INVALID");
    assert.throws(() => new R004Dialogue(`${temporary.directory}/live.sqlite`, { ...binding, mode: "live" } as unknown as DialogueBinding), /LIVE_DISABLED/);
    assert.throws(() => new R004Dialogue(temporary.path, { ...binding, model: "changed" }), /DRIFT/);
  } finally { pilot.close(); temporary.cleanup(); }
});

test("stop aborts pending dialogue and new Case needs explicit control after resolution", async () => {
  const temporary = temporaryDatabase("r004-stop");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    let first!: DialogueRequest;
    let signal!: AbortSignal;
    pilot.receive(message(1));
    const running = pilot.advance({ submit: (request, receivedSignal) => { first = request; signal = receivedSignal; return new Promise(() => {}); }, lookup: async () => undefined });
    pilot.receive(message(2, "停止"));
    assert.equal(signal.aborted, true);
    assert.equal(await running, "unknown");
    await pilot.advance({ submit: async () => { throw new Error("not permitted"); }, lookup: async () => answer(first) });
    await pilot.flush(async request => confirm(pilot, request));
    pilot.receive(message(3, "/new"));
    await pilot.flush(async request => confirm(pilot, request));
    pilot.receive(message(4, "新合成事件"));
    assert.equal(pilot.snapshot().cases.length, 2);
    assert.equal(pilot.snapshot().cases[0]!.state, "closed");
    let finish!: (value: unknown) => void;
    let next!: DialogueRequest;
    let nextSignal!: AbortSignal;
    const subsequent = pilot.advance({ submit: (request, receivedSignal) => {
      next = request; nextSignal = receivedSignal; return new Promise(resolve => { finish = resolve; });
    }, lookup: async () => undefined });
    assert.equal(pilot.receive(message(2, "停止")), "replayed");
    assert.equal(nextSignal.aborted, false, "old stop replay must not abort the new Case");
    finish(answer(next)); await subsequent;
  } finally { pilot.close(); temporary.cleanup(); }
});

test("bounded history is explicit, budgets stop new calls, triage proposals do not execute", async () => {
  const temporary = temporaryDatabase("r004-bounds");
  const pilot = new R004Dialogue(temporary.path, { ...binding, maxOperations: 8 });
  try {
    const { port, requests } = counter(pilot);
    for (let i = 1; i <= 9; i++) {
      pilot.receive(message(i, `合成材料 ${i}`));
      await pilot.advance(port); await pilot.flush(async request => confirm(pilot, request));
    }
    assert.equal(requests.length, 8);
    assert.equal(requests[7]!.context.length, 12);
    assert.equal(requests[7]!.context_truncated, true);
    assert.match(pilot.snapshot().responses.at(-1)!.content, /预算/);
  } finally { pilot.close(); temporary.cleanup(); }
  const another = temporaryDatabase("r004-proposal");
  const next = new R004Dialogue(another.path, binding);
  try {
    next.receive(message(1));
    await next.advance({ submit: async request => answer(request, "已经执行封禁", "triage_proposal"), lookup: async () => undefined });
    assert.match(next.snapshot().responses[0]!.content, /尚未接通/);
    assert.equal(next.snapshot().operations.length, 1);
  } finally { next.close(); another.cleanup(); }
});

test("foreign database and symlink are refused; snapshot corruption is detected", () => {
  const temporary = temporaryDatabase("r004-storage");
  const database = new DatabaseSync(temporary.path);
  database.exec("CREATE TABLE r003_existing (id INTEGER)"); database.close();
  try {
    assert.throws(() => new R004Dialogue(temporary.path, binding), /FOREIGN_SCHEMA/);
    const permission = Reflect.get(process, "permission");
    const restricted = typeof permission === "object" && permission !== null;
    const link = restricted ? join(tmpdir(), "synthetic-authority-symlink") : `${temporary.directory}/link.sqlite`;
    const dangling = restricted ? join(tmpdir(), "synthetic-authority-dangling-symlink") : `${temporary.directory}/dangling.sqlite`;
    const parent = restricted ? join(tmpdir(), "synthetic-directory-symlink") : `${temporary.directory}/parent-link`;
    if (!restricted) {
      symlinkSync(temporary.path, link);
      symlinkSync(`${temporary.directory}/missing.sqlite`, dangling);
      symlinkSync(temporary.directory, parent);
    }
    for (const path of [link, dangling, parent]) assert.equal(lstatSync(path).isSymbolicLink(), true);
    assert.throws(() => new R004Dialogue(link, binding), /SYMLINK/);
    assert.throws(() => new R004Dialogue(dangling, binding), /SYMLINK/);
    assert.throws(() => new R004Dialogue(`${parent}/new.sqlite`, binding), /SYMLINK/);
    const path = `${temporary.directory}/pilot.sqlite`;
    const pilot = new R004Dialogue(path, binding); pilot.close();
    const corrupt = new DatabaseSync(path); corrupt.exec("UPDATE r004_dialogue SET digest='bad'"); corrupt.close();
    assert.throws(() => new R004Dialogue(path, binding), /DRIFT/);
  } finally { temporary.cleanup(); }
});

test("R004 preserves a 5 KiB message and durably explains an oversized message", async () => {
  const temporary = temporaryDatabase("r004-input-bytes");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    const wire = message(1, `  ${"x".repeat(5000)}  `);
    pilot.receive({ ...wire, payload: { ...wire.payload, message: { ...wire.payload.message, summary: "large message" } } });
    const { port, requests } = counter(pilot); await pilot.advance(port);
    assert.equal(requests[0]!.current_message.content, wire.payload.message.body.content);
    await pilot.flush(async request => confirm(pilot, request));
    const large = message(2, "x".repeat(9000));
    pilot.receive({ ...large, payload: { ...large.payload, message: { ...large.payload.message, summary: "oversized message" } } });
    assert.equal(await pilot.advance(port), "idle");
    assert.match(pilot.snapshot().responses.at(-1)!.content, /8 KiB/);
    assert.equal(requests.length, 1);
  } finally { pilot.close(); temporary.cleanup(); }
});

test("accepted checkpoint recovery preserves the frozen execution deadline", async () => {
  const temporary = temporaryDatabase("r004-accepted-recovery");
  let pilot = new R004Dialogue(temporary.path, binding);
  try {
    pilot.receive(message(1));
    await pilot.advance({ submit: async () => { throw new Error("crash checkpoint simulation"); }, lookup: async () => undefined });
    const state = pilot.snapshot();
    state.operations[0]!.state = "accepted"; state.responses = [];
    pilot.close();
    const db = new DatabaseSync(temporary.path);
    db.prepare("UPDATE r004_dialogue SET body=?,digest=?").run(JSON.stringify(state), dialogueDigest(state)); db.close();
    pilot = new R004Dialogue(temporary.path, binding);
    const deadline = Date.parse(state.operations[0]!.request.deadline);
    let called = 0;
    const outcome = await pilot.advance({ submit: async (_request, signal) => {
      called++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("expired")), { once: true }));
    }, lookup: async () => undefined }, deadline - 5);
    assert.equal(outcome, "unknown");
    assert.equal(called, 1);
    assert.equal(pilot.snapshot().operations.length, 1);
    assert.equal(pilot.snapshot().operations[0]!.request.deadline, state.operations[0]!.request.deadline);
    await pilot.advance({ submit: async () => { throw new Error("must not resubmit"); }, lookup: async () => answer(state.operations[0]!.request, "late answer") }, deadline + 1);
    assert.equal(pilot.snapshot().operations[0]!.state, "expired");
    assert.ok(!pilot.snapshot().responses.some(item => item.content === "late answer"));
  } finally { pilot.close(); temporary.cleanup(); }
});

test("invalid recovered result replaces the unsent waiting notice with a single failure reply", async () => {
  const temporary = temporaryDatabase("r004-invalid-recovery");
  const pilot = new R004Dialogue(temporary.path, binding);
  try {
    pilot.receive(message(1));
    let saved!: DialogueRequest;
    await pilot.advance({ submit: async request => { saved = request; throw new Error("unknown"); }, lookup: async () => undefined });
    assert.equal(await pilot.advance({ submit: async () => { throw new Error("must not resubmit"); },
      lookup: async () => ({ ...answer(saved), tool_calls: ["shell"] }) }), "failed");
    const visible: string[] = [];
    await pilot.flush(async request => { if (request.method === "message.send") visible.push(request.payload.message.content); confirm(pilot, request); });
    assert.equal(visible.length, 1);
    assert.match(visible[0]!, /无法校验/);
  } finally { pilot.close(); temporary.cleanup(); }
});


test("normalized send confirmation survives restart and supplies the confirmed history", async () => {
  const temporary = temporaryDatabase("r004-normalized-confirmation");
  let pilot = new R004Dialogue(temporary.path, binding);
  try {
    pilot.receive(message(1));
    await pilot.advance({ submit: async request => answer(request, "  回答\n"), lookup: async () => undefined });
    let pending!: MagicChatRequestEnvelope;
    await pilot.flush(async request => {
      if (request.method === "events.ack") confirm(pilot, request);
      else pending = request;
    });
    pilot.close(); pilot = new R004Dialogue(temporary.path, binding);
    confirm(pilot, pending);
    confirm(pilot, pending);
    assert.equal(pilot.snapshot().responses[0]!.state, "sent");
    assert.deepEqual(pilot.snapshot().cases[0]!.history.filter(item => item.role === "assistant").map(item => item.content), ["回答"]);
    pilot.receive(message(2, "请继续解释"));
    const { port, requests } = counter(pilot);
    assert.equal(await pilot.advance(port), "complete");
    assert.equal(requests[0]!.context.at(-1)!.content, "回答");
  } finally { pilot.close(); temporary.cleanup(); }
});
