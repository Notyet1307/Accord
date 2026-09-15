import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { cqaCorpusDigest, cqaSha256, parseCqaCorpus } from "../src/contracts/cqa-query.js";
import { normalizeMagicChatEnvelope } from "../src/contracts/magicchat.js";
import { cqaBindingDigest, R005CqaConsumer, type CqaBinding, type CqaChatConfiguration, type CqaRunPort } from "../src/driver/r005-cqa.js";
import { DeterministicMagicChatSimulator } from "../src/magicchat/simulator.js";
import type { MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { connectMagicChatTransport, type MagicChatTransport } from "../src/transports/magicchat-websocket.js";
import { magicChatMessageCreatedEnvelope } from "./fixture.js";

const corpus = parseCqaCorpus(readFileSync(new URL("../../test/fixtures/r005-s2-corpus.json", import.meta.url)));
const turn = () => { const pending = Promise.withResolvers<void>(); setImmediate(pending.resolve); return pending.promise; };
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await turn(); }
  assert.fail("R005 driver did not reach expected state");
}
async function launcher() {
  // @ts-expect-error Explicit JavaScript launcher uses dist modules and has no import-time execution.
  return import("../../scripts/run-r005.mjs");
}
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "accord-r005-live-")));
  const evidenceRoot = join(root, "evidence"); mkdirSync(evidenceRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binding: CqaBinding = { mode: "managed", appId: "00000000-0000-4000-8000-000000000005", conversationId: "test-conversation", actorId: "test-actor",
    profileRevision: "r5", bindingRevision: "r5", policyRevision: "synthetic-only", skillRevision: "query-v1", toolRevision: "search-v1", permissionRevision: "test-v1",
    agentVersion: "0.1.0-starter", configDigest: "35ce39066985949c678850487a1d435fc8faeff716e2cb1965bdedad3c9152e6",
    corpus, corpusDigest: cqaCorpusDigest(corpus), generationMode: "llm", provider: "baizhi-chat", model: "grok-4.6",
    binarySha256: "a98b6423b7b3602ff2777e52a48747fda4e3d018742a5e4ad2a760850b8a7355",
    guestImageSha256: "e202e11188012c8489fd7df87cf07fa14b3136ad16df86e84972f5be8eb4e367", inputRoot: join(root, "inputs"), maxOperations: 3,
    runtime: { adapterRevision: "accord.cqa-run-service/v1", sourceRevision: "043b763f05304c3a55f1bd3f4eb8504a591aa4ba",
      endpoint: "http://127.0.0.1:19876", controlCredentialRef: "r005-control", controlCredentialRevision: "test-v1",
      projectId: "r005-test-project", agentName: "compliance-query", source: "RUN_SOURCE_MANUAL",
      command: ["/opt/cqa/compliance-agent", "query", "--config", "/s2/inputs/config.json", "--input", "/opt/accord-cqa-input/request.json"] },
    managed: { daemonSha256: "8cd19f27f0d6a8ba0dc6158ad50737b3e779fdd6c1e1fc11bb773a21b3ebc447",
      platformManifestSha256: "b3c2bdd28f728935c40a6a5862748bf9a2d7eab3c39f75449ac834d8d2cc26c9",
      deploymentSha256: cqaSha256("synthetic-test-evidence"), evidenceRoot, daemonInputRoot: "/daemon/accord-inputs", engineInputRoot: "/engine/accord-inputs",
      configFileSha256: cqaSha256("synthetic-test-config"), transport: "isolated-http" } };
  const chat: CqaChatConfiguration = { schemaVersion: "accord.r005-chat/v1", authorizationId: "synthetic-trial", authorizationRevision: "r5", expiresAt: Date.now() + 120_000,
    magicChat: { transportVersion: "accord.magicchat-websocket-transport/v2", endpoint: "wss://synthetic.invalid/api/app/ws", credentialRef: "r005-chat", credentialRevision: "test-v1" } };
  const configuration = { schemaVersion: "accord.r005-live/v1", binding, chat };
  const credentials = { "r005-control": "synthetic-control-canary-005", "r005-chat": "synthetic-chat-canary-005" };
  const database = join(root, "r005.sqlite"), configPath = join(root, "config.json"), credentialPath = join(root, "credentials.json");
  const save = () => { writeFileSync(configPath, JSON.stringify(configuration), { mode: 0o600 }); writeFileSync(credentialPath, JSON.stringify(credentials), { mode: 0o600 }); };
  save();
  return { root, binding, configuration, credentials, database, configPath, credentialPath, save,
    args: ["--live", "--database", database, "--config", configPath, "--credentials", credentialPath] };
}

test("R005 launcher import is inert and invalid authority never reaches execution or creates a database", async t => {
  const f = fixture(t), listeners = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const { runCli } = await launcher();
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], listeners);
  assert.equal(existsSync(f.database), false);
  let executions = 0; const logs: string[] = [];
  const execute = async () => { executions++; return { state: "STOPPED", reason: "R005_STOPPED" }; };
  const run = (args = f.args) => runCli(args, execute, (value: string) => logs.push(value));
  assert.equal(await run([]), 1);
  assert.equal(await run(f.args.slice(1)), 1);
  assert.equal(await run([...f.args, "--retry-unknown", "operation-1"]), 1);
  const original = structuredClone(f.configuration);
  for (const mutate of [
    () => { f.configuration.chat.expiresAt = Date.now(); },
    () => { f.configuration.chat.magicChat.credentialRef = f.binding.runtime.controlCredentialRef; },
    () => { f.configuration.chat.magicChat.endpoint += "?token=unexpected"; },
    () => { f.binding.runtime.endpoint = "http://untrusted.invalid"; },
    () => { f.binding.appId = "not-an-app-uuid"; },
    () => { f.binding.runtime.adapterRevision = "accord.cqa-run-service/v2"; },
    () => { f.binding.configDigest = "0".repeat(63); },
    () => { f.configuration.chat.authorizationRevision = f.credentials["r005-control"]; },
  ]) {
    mutate(); f.save(); assert.equal(await run(), 1);
    Object.assign(f.configuration.chat, structuredClone(original.chat)); Object.assign(f.binding, structuredClone(original.binding));
  }
  f.save();
  writeFileSync(f.credentialPath, JSON.stringify({ ...f.credentials, extra: "synthetic-extra-credential" })); assert.equal(await run(), 1);
  writeFileSync(f.credentialPath, JSON.stringify({ ...f.credentials, "r005-control": "too-short" })); assert.equal(await run(), 1);
  f.save(); chmodSync(f.credentialPath, 0o644); assert.equal(await run(), 1); chmodSync(f.credentialPath, 0o600);
  chmodSync(f.configPath, 0o644); assert.equal(await run(), 1); chmodSync(f.configPath, 0o600);
  assert.equal(executions, 0); assert.equal(existsSync(f.database), false); assert.equal(existsSync(f.binding.inputRoot), false);
  assert.equal(await run(), 0); assert.equal(executions, 1);
  assert.equal(logs.some(line => line.includes("canary")), false);
});

test("R005 rejects credentials hidden by nested JSON escaping before execution or persistence", async t => {
  const f = fixture(t); const { runCli } = await launcher();
  const secret = 'synthetic-"control\\canary-005';
  f.credentials["r005-control"] = secret;
  const output = JSON.stringify({ warnings: [secret] }).replace(/\\(["\\])/gu,
    (_match, character: string) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  f.binding.profileRevision = JSON.stringify({ output });
  f.save();
  let executions = 0; const logs: string[] = [];
  const result = await runCli(f.args, async () => { executions++; return { state: "STOPPED", reason: "R005_STOPPED" }; },
    (value: string) => logs.push(value));
  assert.equal(result, 1);
  assert.equal(executions, 0);
  assert.equal(existsSync(f.database), false);
  assert.equal(logs.some(value => value.includes(secret) || value.includes(output)), false);
});

test("R005 launcher rejects private-file aliases and input/evidence/SQLite-sidecar collisions without writes", async t => {
  const f = fixture(t); const { runCli } = await launcher(); let executions = 0;
  const execute = async () => { executions++; return { state: "STOPPED", reason: "R005_STOPPED" }; };
  const run = (database = f.database, credentials = f.credentialPath) => runCli(["--live", "--database", database, "--config", f.configPath, "--credentials", credentials], execute, () => undefined);
  const alias = join(f.root, "alias");
  symlinkSync(f.credentialPath, alias); assert.equal(await run(f.database, alias), 1); rmSync(alias);
  linkSync(f.credentialPath, alias); assert.equal(await run(), 1); rmSync(alias);
  const parentAlias = join(f.root, "parent-alias"); symlinkSync(f.root, parentAlias);
  assert.equal(await run(join(parentAlias, "r005.sqlite")), 1);
  writeFileSync(`${f.database}-wal`, "unowned sidecar", { mode: 0o600 }); assert.equal(await run(), 1); rmSync(`${f.database}-wal`);
  for (const database of [f.configPath, f.credentialPath, join(f.binding.managed!.evidenceRoot, "database.sqlite"), join(f.binding.inputRoot, "database.sqlite")]) assert.equal(await run(database), 1);
  const originalInput = f.binding.inputRoot;
  f.binding.inputRoot = f.binding.managed!.evidenceRoot; f.save(); assert.equal(await run(), 1);
  f.binding.inputRoot = originalInput; f.save();
  const dbBase = join(f.root, "credentials");
  writeFileSync(`${dbBase}-wal`, JSON.stringify(f.credentials), { mode: 0o600 }); assert.equal(await run(dbBase, `${dbBase}-wal`), 1);
  assert.equal(executions, 0); assert.equal(existsSync(f.database), false);
});

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send(_bytes: string, callback: (error?: Error | null) => void): void { callback(); }
  close(): void { this.emit("close"); }
  terminate(): void { this.emit("close"); }
}
test("R005 transport selects raw question bytes without changing R003 or R004 text policy", async () => {
  const body = " \r\ne\u0301" + "原".repeat(5000) + "\r ";
  const input = magicChatMessageCreatedEnvelope({ body });
  const wire = { ...input, payload: { ...input.payload, message: { ...input.payload.message, summary: "Synthetic summary" } } };
  assert.throws(() => normalizeMagicChatEnvelope(wire));
  for (const mode of ["r004", "r005"] as const) {
    const normalized = normalizeMagicChatEnvelope(wire, mode);
    assert.equal(normalized.kind === "MESSAGE_CREATED" && normalized.body, body);
  }
  const blank = { ...wire, payload: { ...wire.payload, message: { ...wire.payload.message, body: { type: "text", content: " \r\n" } } } };
  assert.throws(() => normalizeMagicChatEnvelope(blank, "r004"));
  assert.equal(normalizeMagicChatEnvelope(blank, "r005").kind, "MESSAGE_CREATED");
  const socket = new Socket(), controller = new AbortController(); let received: unknown;
  const connecting = connectMagicChatTransport({ transportVersion: "accord.magicchat-websocket-transport/v2", textContract: "r005", url: "wss://synthetic.invalid/api/app/ws", appId: "00000000-0000-4000-8000-000000000005", credential: "synthetic-chat-canary-005" }, envelope => { received = envelope; }, () => socket, controller.signal);
  socket.emit("open"); const transport = await connecting;
  try { socket.emit("message", JSON.stringify(wire), false); await until(() => received !== undefined); assert.deepEqual(received, wire); }
  finally { controller.abort(); transport.close(); }
});

test("R005 loop receives correlated send confirmations without blocking the WebSocket receiver", async t => {
  const f = fixture(t); const { runR005LiveDriver } = await launcher();
  const consumer = new R005CqaConsumer(f.database, f.binding); t.after(() => consumer.close());
  const simulator = new DeterministicMagicChatSimulator({ appId: f.binding.appId, firstMessageSequence: 2 });
  const socket = new Socket(), controller = new AbortController();
  const visible: MagicChatRequestEnvelope[] = [];
  let calls = 0, connected = false;
  socket.send = (bytes, callback) => {
    const request = JSON.parse(bytes) as MagicChatRequestEnvelope;
    const response = simulator.respond(request, new Date().toISOString());
    if (request.method === "message.send") visible.push(request);
    callback();
    queueMicrotask(() => socket.emit("message", JSON.stringify(response), false));
  };
  const port: CqaRunPort = { mode: "managed", bindingDigest: cqaBindingDigest(f.binding), preflight: () => { calls++; },
    start: async () => { calls++; throw new Error("unexpected Start"); }, lookup: async () => { calls++; return { total: 0, runs: [] }; }, cancel: async () => { calls++; } };
  const done = runR005LiveDriver({ consumer, port, configuration: f.configuration, signal: controller.signal,
    report: () => { connected = true; },
    connect: (receive: (wire: unknown) => void, signal: AbortSignal) => {
      const pending = connectMagicChatTransport({ transportVersion: "accord.magicchat-websocket-transport/v2", textContract: "r005",
        url: f.configuration.chat.magicChat.endpoint, appId: f.binding.appId, credential: f.credentials["r005-chat"] }, receive, () => socket, signal);
      socket.emit("open"); return pending;
    } });
  try {
    await until(() => connected);
    const question = magicChatMessageCreatedEnvelope({ body: "等保备案需要哪些材料？", actorId: f.binding.actorId,
      conversationId: f.binding.conversationId, messageCreatedAt: new Date().toISOString() });
    simulator.observeUserMessage(question); socket.emit("message", JSON.stringify(question), false);
    await until(() => visible.length === 1);
    await until(() => consumer.snapshot().chat?.sends.some(item => item.state === "sent") === true);
    assert.equal(calls, 0); // Missing scope is explained, never submitted.
    controller.abort();
    assert.deepEqual(await done, { state: "STOPPED", reason: "R005_STOPPED" });
  } finally { controller.abort(); await done; }
});

test("R005 real owner recovers only on bounded wakes, receives during a pending RPC, and settles before shutdown", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-09-15T12:00:00Z") });
  const f = fixture(t); const { runR005LiveDriver } = await launcher();
  const consumer = new R005CqaConsumer(f.database, f.binding);
  t.after(() => consumer.close());
  consumer.configureChat(f.configuration.chat);
  const simulator = new DeterministicMagicChatSimulator({ appId: f.binding.appId, firstMessageSequence: 7 });
  for (const [index, body] of ["等保备案需要哪些材料？", "mlps", "2026-09-15", "CN", "all"].entries()) {
    const wire = magicChatMessageCreatedEnvelope({ body, conversationId: f.binding.conversationId, actorId: f.binding.actorId,
      messageId: `field-${index}`, envelopeEventId: `field-event-${index}`, messageSequence: index + 1, cursor: index + 1, messageCreatedAt: new Date().toISOString() });
    simulator.observeUserMessage(wire); consumer.receive(wire);
  }
  await consumer.flush(async request => { consumer.receive(simulator.respond(request, new Date().toISOString())); });
  let starts = 0, lookups = 0, cancellations = 0, closed = false, receive: (wire: unknown) => void = () => assert.fail("not connected");
  const pendingLookup = Promise.withResolvers<{ total: number; runs: [] }>();
  const port: CqaRunPort = { mode: "managed", bindingDigest: cqaBindingDigest(f.binding), preflight: () => undefined,
    start: async () => { starts++; throw new Error("synthetic lost response"); },
    lookup: () => { lookups++; return pendingLookup.promise; },
    cancel: async () => { cancellations++; } };
  const controller = new AbortController();
  const done = runR005LiveDriver({ consumer, port, configuration: f.configuration, signal: controller.signal,
    connect: async (handler: (wire: unknown) => void): Promise<MagicChatTransport> => {
      receive = handler;
      return { closed: Promise.withResolvers<string>().promise, close: () => { closed = true; },
        send: async (request: MagicChatRequestEnvelope) => { receive(simulator.respond(request, new Date().toISOString())); } };
    } });
  await until(() => starts === 1);
  await turn(); assert.equal(lookups, 0);
  t.mock.timers.tick(4999); await turn(); assert.equal(lookups, 0);
  t.mock.timers.tick(1); await until(() => lookups === 1);
  const status = magicChatMessageCreatedEnvelope({ body: "/status", conversationId: f.binding.conversationId, actorId: f.binding.actorId, envelopeEventId: "status-event", messageId: "status-message", messageSequence: 6, cursor: 6, messageCreatedAt: new Date().toISOString() });
  simulator.observeUserMessage(status); receive(status);
  assert.equal(consumer.receive(status), "replayed"); // Receipt committed while lookup is still pending.
  controller.abort(); await turn(); assert.equal(closed, false);
  pendingLookup.resolve({ total: 0, runs: [] });
  assert.deepEqual(await done, { state: "STOPPED", reason: "R005_STOPPED" });
  assert.equal(closed, true); assert.equal(starts, 1); assert.equal(lookups, 1); assert.equal(cancellations, 0);
  assert.equal(consumer.snapshot().operations[0]!.state, "unknown");
  t.mock.timers.tick(120_000); await turn(); assert.equal(lookups, 1);
});

test("R005 resumes acknowledged pending input after the old Run terminates without another message", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-09-15T12:00:00Z") });
  const f = fixture(t); const { runR005LiveDriver } = await launcher();
  const consumer = new R005CqaConsumer(f.database, f.binding); t.after(() => consumer.close());
  consumer.configureChat(f.configuration.chat);
  const simulator = new DeterministicMagicChatSimulator({ appId: f.binding.appId, firstMessageSequence: 3 });
  const message = (sequence: number, body: string) => magicChatMessageCreatedEnvelope({ body,
    conversationId: f.binding.conversationId, actorId: f.binding.actorId, messageId: `input-${sequence}`,
    envelopeEventId: `event-${sequence}`, messageSequence: sequence, cursor: sequence, messageCreatedAt: new Date().toISOString() });
  const initial = message(1, "问题:等保备案材料？\n主题:mlps\n日期:2026-09-15\n地区:CN\n行业:all");
  const first = { ...initial, payload: { ...initial.payload, message: { ...initial.payload.message, summary: "Synthetic query" } } };
  simulator.observeUserMessage(first); consumer.receive(first);
  await consumer.flush(async request => { consumer.receive(simulator.respond(request, new Date().toISOString())); });
  const old = consumer.snapshot().operations[0]!;
  let starts = 0, lookups = 0, receive: (wire: unknown) => void = () => assert.fail("not connected");
  const port: CqaRunPort = { mode: "managed", bindingDigest: cqaBindingDigest(f.binding), preflight: () => undefined,
    start: async () => ({ pendingRunId: `run-${++starts}` }),
    lookup: async () => ({ total: 1, runs: [{
      runId: "run-1", sandboxId: "sandbox-1", projectId: f.binding.runtime.projectId, agentName: f.binding.runtime.agentName,
      source: f.binding.runtime.source, operationId: old.frozen.operationId, fingerprint: old.fingerprint,
      binarySha256: f.binding.binarySha256, guestImageSha256: f.binding.guestImageSha256,
      requestFileSha256: old.frozen.input.requestFileSha256, volume: old.frozen.input.volume,
      deploymentSha256: f.binding.managed!.deploymentSha256, observationSha256: cqaSha256("synthetic-observation"),
      status: ++lookups === 1 ? "running" : "failed", completeOutput: true, exitCode: 1, cleanupError: false,
    }] }), cancel: async () => undefined };
  const controller = new AbortController();
  const done = runR005LiveDriver({ consumer, port, configuration: f.configuration, signal: controller.signal,
    connect: async (handler: (wire: unknown) => void): Promise<MagicChatTransport> => {
      receive = handler;
      return { closed: Promise.withResolvers<string>().promise, close: () => undefined,
        send: async request => { receive(simulator.respond(request, new Date().toISOString())); } };
    } });
  try {
    await until(() => starts === 1);
    const followup = message(2, "补充后的备案问题？"); simulator.observeUserMessage(followup); receive(followup);
    await until(() => lookups === 1 && consumer.snapshot().chat!.sends.some(item => item.state === "sent"));
    await turn();
    t.mock.timers.tick(5000); await until(() => consumer.snapshot().operations[0]!.state === "failed");
    await turn();
    t.mock.timers.tick(5000); await until(() => starts === 2);
    assert.equal(consumer.snapshot().operations[1]!.frozen.request.question, "补充后的备案问题？");
    assert.equal(consumer.snapshot().operations[1]!.frozen.request.caseId, old.frozen.request.caseId);
  } finally { controller.abort(); await done; }
});

test("R005 deadline and socket closure stop idle scheduling without reconnecting or submitting", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-09-15T12:00:00Z") });
  const f = fixture(t); const { runR005LiveDriver } = await launcher();
  const consumer = new R005CqaConsumer(f.database, f.binding); t.after(() => consumer.close());
  let connections = 0, calls = 0;
  const port: CqaRunPort = { mode: "managed", bindingDigest: cqaBindingDigest(f.binding), preflight: () => { calls++; },
    start: async () => { calls++; throw new Error("unexpected Start"); }, lookup: async () => { calls++; return { total: 0, runs: [] }; }, cancel: async () => { calls++; } };
  let disconnect: (reason: string) => void = () => assert.fail("not connected");
  const connect = async (): Promise<MagicChatTransport> => {
    connections++; const pending = Promise.withResolvers<string>(); disconnect = pending.resolve;
    return { closed: pending.promise, close: () => undefined, send: async () => assert.fail("unexpected send") };
  };
  const first = runR005LiveDriver({ consumer, port, configuration: f.configuration, connect });
  await turn(); disconnect("synthetic disconnect"); assert.deepEqual(await first, { state: "STOPPED", reason: "R005_SOCKET_CLOSED" });
  t.mock.timers.tick(5000); await turn(); assert.equal(connections, 1);
  const second = runR005LiveDriver({ consumer, port, configuration: f.configuration, connect });
  await turn(); t.mock.timers.tick(115_000);
  assert.deepEqual(await second, { state: "STOPPED", reason: "R005_AUTHORIZATION_EXPIRED" });
  assert.equal(connections, 2); assert.equal(calls, 0);
});
