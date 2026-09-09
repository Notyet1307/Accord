import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { MagicChatProtocolAdapter, type MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import type { PreparedProfileInvocation, ProviderPort } from "../src/researcher-analyst.js";
import { prepareBaizhiResponsesPort, BAIZHI_TIMEOUT_MS, BAIZHI_REQUEST_MAX_BYTES, BAIZHI_RESPONSE_MAX_BYTES, type BaizhiConfig, type HttpSender } from "../src/transports/baizhi-responses.js";
import { connectMagicChatTransport, MAGICCHAT_FRAME_MAX_BYTES, type SocketOptions } from "../src/transports/magicchat-websocket.js";
import { magicChatAckSuccessResponse, magicChatMessageCreatedEnvelope, magicChatMessageSendSuccessResponse, temporaryDatabase } from "./fixture.js";

const SECRET = "synthetic-secret-do-not-log-92817";
const config: BaizhiConfig = { responsesUrl: "https://ai-api-gateway.app.baizhi.cloud/test/responses", deploymentId: "synthetic-deployment", credential: SECRET, costLimitCny: null };
const wsConfig = { url: "wss://synthetic.invalid/api/app/ws", appId: "00000000-0000-4000-8000-000000000001", credential: SECRET };
const now = "2026-08-26T00:01:02.000Z";
const ack: MagicChatRequestEnvelope = { v: 1, id: "request-1", kind: "request", method: "events.ack", payload: { cursor: 1 } };

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse(now) });
  const temporary = temporaryDatabase("c5-transports");
  const authority = openAuthorityDatabase(temporary.path);
  t.after(() => { authority.close(); temporary.cleanup(); });
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
  assert.ok(created.nextRequest);
  const wait = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z");
  assert.ok(wait.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(wait.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve two weeks.", cursor: 2, envelopeEventId: "event-reply", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "reply", messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
  const prepared = authority.prepareProfileInvocation({ caseId: resumed.snapshot.caseId, profile: "RESEARCHER", modelId: "fixture-model", now });
  const attempts = (): unknown => { const db = new DatabaseSync(temporary.path, { readOnly: true }); try { return db.prepare("SELECT state FROM runtime_attempts ORDER BY attempt_number").all().map((r) => r["state"]); } finally { db.close(); } };
  return { authority, prepared, attempts };
}
function completion(prepared: PreparedProfileInvocation): Parameters<ProviderPort["complete"]>[0] {
  return { invocation: prepared, attempt: { attemptId: "attempt-c5" as Parameters<ProviderPort["complete"]>[0]["attempt"]["attemptId"], invocationId: prepared.invocationId, attemptNumber: 1, noSdkRetry: true }, retry: "DISABLED" };
}
function response(overrides: Record<string, unknown> = {}, header: string | null = "req-c5"): Response {
  return new Response(JSON.stringify({ status: "completed", id: "resp-c5", model: "fixture-model", error: null, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ observations: [] }) }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, ...overrides }), { headers: header === null ? {} : { "X-Request-Id": header } });
}
async function microtasks(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test("C5 provider preflights before an Attempt, freezes request and maps one response without secrets", async (t) => {
  const { prepared, attempts } = fixture(t);
  let calls = 0;
  const sender: HttpSender = async (url, init) => {
    calls++;
    assert.equal(url, config.responsesUrl); assert.equal(init.redirect, "error");
    assert.equal((init.headers as Record<string, string>)["Authorization"], `Bearer ${SECRET}`);
    const body = JSON.parse(String(init.body));
    assert.equal(body.store, false); assert.equal(body.stream, false); assert.deepEqual(body.tools, []); assert.equal(body.max_output_tokens, 8192);
    assert.equal(body.conversation, undefined); assert.equal(body.previous_response_id, undefined);
    return response({ output: [{ type: "reasoning", summary: [{ text: SECRET }] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"observations":[]}' }] }] });
  };
  for (const responsesUrl of ["http://ai-api-gateway.app.baizhi.cloud/x", "https://evil.invalid/responses", `${config.responsesUrl}?x=1`, `${config.responsesUrl}#x`, "https://u:p@ai-api-gateway.app.baizhi.cloud/x", "https://ai-api-gateway.app.baizhi.cloud:444/x", "https://ai-api-gateway.app.baizhi.cloud/"]) assert.throws(() => prepareBaizhiResponsesPort({ ...config, responsesUrl }, prepared, "Return JSON", sender));
  assert.throws(() => prepareBaizhiResponsesPort({ ...config, costLimitCny: 1 } as unknown as BaizhiConfig, prepared, "Return JSON", sender), /COST_LIMIT_NOT_IMPLEMENTED/);
  assert.throws(() => prepareBaizhiResponsesPort(config, prepared, "文".repeat(BAIZHI_REQUEST_MAX_BYTES), sender), /PROVIDER_REQUEST_TOO_LARGE/);
  assert.deepEqual(attempts(), ["READY"]); assert.equal(calls, 0);
  const port = prepareBaizhiResponsesPort(config, prepared, "Return JSON", sender);
  const wire = await port.complete(completion(prepared));
  const value = JSON.parse(wire);
  assert.deepEqual(value.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.equal(value.providerMetadata.requestId, "req-c5"); assert.equal(value.providerMetadata.responseId, "resp-c5");
  assert.equal(wire.includes(SECRET), false); assert.equal(calls, 1);
  await assert.rejects(async () => port.complete(completion(prepared)), /ALREADY_SENT/);
});

test("C5 rejects ambiguous, incomplete, secret-reflecting and identity-invalid provider output", async (t) => {
  const { prepared } = fixture(t);
  const variants: (() => Response)[] = [
    () => response({ status: "incomplete" }), () => response({ error: { message: SECRET } }), () => response({ model: "other" }),
    () => response({ id: "" }), () => response({}, null), () => response({}, "one,two"),
    () => response({ usage: null }), () => response({ usage: { input_tokens: 10, output_tokens: 5, total_tokens: 99 } }),
    () => response({ usage: { input_tokens: 10, output_tokens: 8193, total_tokens: 8203 } }),
    () => response({ usage: { input_tokens: -1, output_tokens: 5, total_tokens: 4 } }),
    () => new Response("not JSON"),
    () => response({ output: [] }), () => response({ output: [{ type: "function_call" }] }),
    ...["refusal", "output_text"].map((type) => () => response({ output: [{ type: "message", role: "assistant", content: [{ type, text: "```json\n{}\n```" }] }] })),
    () => response({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }, { type: "output_text", text: "{}" }] }] }),
    () => response({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ text: SECRET }) }] }] }),
    () => response({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ text: "x".repeat(65_536) }) }] }] }),
  ];
  for (const variant of variants) {
    let calls = 0;
    const port = prepareBaizhiResponsesPort(config, prepared, "Return JSON", async () => { calls++; return variant(); });
    await assert.rejects(async () => port.complete(completion(prepared)), (error: unknown) => error instanceof Error && error.message.startsWith("PROVIDER_") && !JSON.stringify(error).includes(SECRET) && !error.message.includes(SECRET) && error.cause === undefined);
    assert.equal(calls, 1);
  }
});

test("C5 no HTTP retries and core preserves UNKNOWN rather than claiming no execution", async (t) => {
  const { authority, prepared, attempts } = fixture(t);
  let calls = 0;
  const port = prepareBaizhiResponsesPort(config, prepared, "Return JSON", async () => { calls++; throw new Error(SECRET); });
  await assert.rejects(authority.executePreparedAttempt(prepared, port, now), /PROVIDER_TRANSPORT_ERROR/);
  assert.equal(calls, 1); assert.deepEqual(attempts(), ["UNKNOWN"]);
  for (const status of [401, 429, 500]) {
    const p = prepareBaizhiResponsesPort(config, prepared, "Return JSON", async () => { calls++; return new Response(SECRET, { status }); });
    await assert.rejects(async () => p.complete(completion(prepared)), /PROVIDER_TRANSPORT_ERROR/);
  }
  assert.equal(calls, 4);
});

test("C5 body reads remain bounded after headers and terminate on timeout", async (t) => {
  const { prepared } = fixture(t);
  let cancelled = false; let signal: AbortSignal | null | undefined;
  const port = prepareBaizhiResponsesPort(config, prepared, "Return JSON", async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const pending = port.complete(completion(prepared));
  const check = assert.rejects(async () => pending, /PROVIDER_TIMEOUT/);
  await microtasks(); t.mock.timers.tick(BAIZHI_TIMEOUT_MS); await check;
  assert.equal(signal?.aborted, true); assert.equal(cancelled, true);
  let finishSend: (value: Response) => void = () => undefined;
  let lateCancelled = false;
  const latePort = prepareBaizhiResponsesPort(config, prepared, "Return JSON", () => new Promise<Response>((resolve) => { finishSend = resolve; }));
  const lateCheck = assert.rejects(Promise.resolve(latePort.complete(completion(prepared))), /PROVIDER_TIMEOUT/);
  t.mock.timers.tick(BAIZHI_TIMEOUT_MS); await lateCheck;
  finishSend(new Response(new ReadableStream({ cancel() { lateCancelled = true; } })));
  await microtasks(); assert.equal(lateCancelled, true);
  const tooLarge = prepareBaizhiResponsesPort(config, prepared, "Return JSON", async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(BAIZHI_RESPONSE_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } })));
  await assert.rejects(async () => tooLarge.complete(completion(prepared)), /PROVIDER_RESPONSE_TOO_LARGE/);
});

class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  terminations = 0;
  closes = 0;
  send(data: string, callback: (error?: Error) => void): void { this.sent.push(data); callback(); }
  close(): void { this.closes++; }
  terminate(): void { this.terminations++; }
  open(): void { this.readyState = 1; this.emit("open"); }
  message(value: unknown): void { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
}
async function connection(t: TestContext, receiver: (value: unknown) => void | Promise<void> = () => undefined) {
  const socket = new FakeSocket(); let options: SocketOptions | undefined;
  const connecting = connectMagicChatTransport(wsConfig, receiver, (url, settings) => { assert.equal(url, wsConfig.url); options = settings; return socket; });
  socket.open(); const transport = await connecting;
  t.after(() => { transport.close(); socket.emit("close"); });
  return { socket, transport, options };
}

test("C5 WebSocket validates before connecting and supplies bounded authenticated options", async (t) => {
  let calls = 0;
  for (const url of ["ws://synthetic.invalid/api/app/ws", "wss://synthetic.invalid/wrong", `${wsConfig.url}?secret=x`, `${wsConfig.url}#x`, "wss://u:p@synthetic.invalid/api/app/ws"]) await assert.rejects(connectMagicChatTransport({ ...wsConfig, url }, () => undefined, () => { calls++; return new FakeSocket(); }));
  await assert.rejects(connectMagicChatTransport({ ...wsConfig, appId: "invalid" }, () => undefined, () => { calls++; return new FakeSocket(); })); assert.equal(calls, 0);
  const { options } = await connection(t);
  assert.deepEqual(options?.headers, { "X-MagicChat-App-ID": wsConfig.appId, Authorization: `Bearer ${SECRET}` });
  assert.equal(options?.handshakeTimeout, 10_000); assert.equal(options?.maxPayload, MAGICCHAT_FRAME_MAX_BYTES);
  assert.equal(options?.autoPong, true); assert.equal(options?.perMessageDeflate, false); assert.equal(options?.followRedirects, false); assert.equal(options?.rejectUnauthorized, true);
});

test("C5 WebSocket submits synchronously, correlates reply_to and leaves protocol authority in control", async (t) => {
  const received: unknown[] = [];
  const { socket, transport } = await connection(t, (value) => { received.push(value); });
  const pending = transport.send(ack);
  assert.equal(socket.sent.length, 1); assert.equal(JSON.parse(socket.sent[0]!).id, ack.id);
  assert.throws(() => transport.send(ack), /REQUEST_PENDING/);
  const result = magicChatAckSuccessResponse(ack.id, 1);
  assert.notEqual(result.id, ack.id);
  socket.message(result); await pending;
  assert.deepEqual(received, [result]); assert.equal(socket.sent.length, 1);
  socket.bufferedAmount = 1; assert.throws(() => transport.send(ack), /NOT_READY/);
  socket.bufferedAmount = 0; socket.readyState = 0; assert.throws(() => transport.send(ack), /NOT_READY/);
});

test("C5 WebSocket protocol dispatch preserves clarification/ACK identities and rejects unknown responses", async (t) => {
  const temporary = temporaryDatabase("c5-ws-protocol"); const authority = openAuthorityDatabase(temporary.path);
  t.after(() => { authority.close(); temporary.cleanup(); });
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const { socket, transport } = await connection(t, (value) => { protocol.receive(value, "2026-08-26T00:00:03.000Z"); });
  const created = protocol.receive(magicChatMessageCreatedEnvelope(), "2026-08-26T00:00:01.000Z"); assert.ok(created.nextRequest);
  const sent = protocol.dispatch(created.nextRequest.id, "2026-08-26T00:00:02.000Z", (request) => transport.send(request));
  assert.equal(socket.sent.length, 1); socket.message(magicChatMessageSendSuccessResponse(created.nextRequest.id)); await sent;
  assert.equal(protocol.inspect(1)?.ackState, "ACK_INTENT"); assert.equal(socket.sent.length, 1);
  socket.message(magicChatAckSuccessResponse("unknown-request", 1));
  assert.equal(await transport.closed, "MAGICCHAT_ENVELOPE_REJECTED");
});

test("C5 WebSocket timers stop only owned sockets without automatic retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const socket = new FakeSocket(); let calls = 0;
  const connecting = connectMagicChatTransport(wsConfig, () => undefined, () => { calls++; return socket; });
  const failed = assert.rejects(connecting, /HANDSHAKE_TIMEOUT/);
  t.mock.timers.tick(10_000); await failed; assert.equal(calls, 1);
  t.mock.timers.tick(5_000); assert.equal(socket.terminations, 1);
  const opened = await connection(t); const rpc = opened.transport.send(ack);
  const timedOut = assert.rejects(rpc, /RPC_TIMEOUT/);
  t.mock.timers.tick(30_000); await timedOut; assert.equal(opened.socket.sent.length, 1);
  t.mock.timers.tick(5_000); assert.equal(opened.socket.terminations, 1);
});

test("C5 WebSocket queue bounds include a busy receiver and never ACK dropped events", async (t) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { socket, transport } = await connection(t, () => held);
  for (let i = 0; i < 64; i++) socket.message(magicChatMessageCreatedEnvelope({ cursor: i + 1 }));
  assert.equal(socket.closes, 0);
  socket.message(magicChatMessageCreatedEnvelope({ cursor: 65 }));
  assert.equal(await transport.closed, "MAGICCHAT_ENVELOPE_REJECTED"); assert.equal(socket.sent.length, 0); release();
});

test("C5 WebSocket rejects binary, oversized, malformed, unknown and credential-reflecting frames", async (t) => {
  const bad: ((socket: FakeSocket) => void)[] = [
    (socket) => socket.emit("message", Buffer.from("{}"), true),
    (socket) => socket.emit("message", Buffer.alloc(MAGICCHAT_FRAME_MAX_BYTES + 1), false),
    (socket) => socket.emit("message", Buffer.from([255]), false),
    (socket) => socket.message({ v: 1, kind: "event", cursor: 1, id: "e", event: "unknown", payload: {} }),
    (socket) => socket.message(magicChatMessageCreatedEnvelope({ body: SECRET })),
    (socket) => socket.emit("message", Buffer.from(JSON.stringify(magicChatMessageCreatedEnvelope({ body: SECRET })).replace(SECRET, "\\u0073" + SECRET.slice(1))), false),
    (socket) => socket.emit("error", new Error(SECRET)),
  ];
  for (const emit of bad) {
    let delivered = 0;
    const { socket, transport } = await connection(t, () => { delivered++; });
    emit(socket); const reason = await transport.closed;
    assert.equal(reason.includes(SECRET), false); assert.equal(delivered, 0); assert.equal(socket.sent.length, 0);
  }
});


test("C5 explicit reconnect replays a durable request identity without advancing ACK", async (t) => {
  const temporary = temporaryDatabase("c5-reconnect"); const authority = openAuthorityDatabase(temporary.path);
  t.after(() => { authority.close(); temporary.cleanup(); });
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const event = magicChatMessageCreatedEnvelope();
  const created = protocol.receive(event, "2026-08-26T00:00:01.000Z"); assert.ok(created.nextRequest);
  const first = await connection(t);
  const initial = protocol.dispatch(created.nextRequest.id, "2026-08-26T00:00:02.000Z", (request) => first.transport.send(request));
  const rejected = assert.rejects(Promise.resolve(initial), /CONNECTION_CLOSED/);
  first.socket.emit("close"); await rejected;
  assert.equal(protocol.inspect(1)?.ackState, "NONE");
  let receiveError: unknown;
  const second = await connection(t, (value) => { try { protocol.receive(value, "2026-08-26T00:00:05.000Z"); } catch (error) { receiveError = error; throw error; } });
  second.socket.message({ ...event, id: "event-reconnected-delivery" }); await microtasks(); assert.ifError(receiveError);
  const pending = protocol.pendingRequests(); assert.equal(pending.length, 1);
  assert.equal(pending[0]?.request.id, created.nextRequest.id);
  const replay = protocol.dispatch(created.nextRequest.id, "2026-08-26T00:00:06.000Z", (request) => second.transport.send(request));
  assert.equal(second.socket.sent[0], first.socket.sent[0]);
  second.socket.message(magicChatMessageSendSuccessResponse(created.nextRequest.id)); await replay;
  assert.equal(protocol.inspect(1)?.ackState, "ACK_INTENT");
});

test("C5 cumulative WebSocket bytes are bounded below the envelope-count limit", async (t) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { socket, transport } = await connection(t, () => held);
  const frame = JSON.stringify(magicChatMessageCreatedEnvelope()) + " ".repeat(900_000);
  assert.ok(Buffer.byteLength(frame) < MAGICCHAT_FRAME_MAX_BYTES);
  for (let i = 0; i < 4; i++) socket.emit("message", Buffer.from(frame), false);
  assert.equal(socket.closes, 0);
  socket.emit("message", Buffer.from(frame), false);
  assert.equal(await transport.closed, "MAGICCHAT_ENVELOPE_REJECTED");
  assert.equal(socket.sent.length, 0); release();
});
