import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cqaCorpusDigest, cqaSha256, parseCqaCorpus } from "../src/contracts/cqa-query.js";
import { cqaBindingDigest, R005CqaConsumer, type CqaAcceptance, type CqaBinding, type CqaChatConfiguration, type CqaFrozenOperation } from "../src/driver/r005-cqa.js";
import { CqaRunServiceAdapter, type CqaHttpSender } from "../src/transports/cqa-run-service.js";
import { DeterministicMagicChatSimulator } from "../src/magicchat/simulator.js";
import type { MagicChatTransport } from "../src/transports/magicchat-websocket.js";
import { magicChatMessageCreatedEnvelope } from "./fixture.js";

const corpus = parseCqaCorpus(readFileSync(new URL("../../test/fixtures/r005-s2-corpus.json", import.meta.url)));
const credential = { reference: "r005-control", revision: "test-v1", value: "synthetic-control-value-not-a-real-token" };
const command = ["/opt/cqa/compliance-agent", "query", "--config", "/s2/inputs/config.json", "--input", "/opt/accord-cqa-input/request.json"];
const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "accord-cqa-protocol-")));
  const evidenceRoot = join(root, "observations"); mkdirSync(evidenceRoot, { mode: 0o700 });
  let now = Date.now();
  const binding: CqaBinding = { mode: "managed", appId: "test-app", conversationId: "test-conversation", actorId: "test-actor",
    profileRevision: "r3", bindingRevision: "r3", policyRevision: "synthetic-only", skillRevision: "query-v1", toolRevision: "search-v1", permissionRevision: "test-v1",
    agentVersion: "0.1.0-starter", configDigest: "35ce39066985949c678850487a1d435fc8faeff716e2cb1965bdedad3c9152e6",
    corpus, corpusDigest: cqaCorpusDigest(corpus), generationMode: "llm", provider: "baizhi-chat", model: "grok-4.6",
    binarySha256: "a98b6423b7b3602ff2777e52a48747fda4e3d018742a5e4ad2a760850b8a7355",
    guestImageSha256: "e202e11188012c8489fd7df87cf07fa14b3136ad16df86e84972f5be8eb4e367", inputRoot: join(root, "inputs"), maxOperations: 10,
    runtime: { adapterRevision: "accord.cqa-run-service/v1", sourceRevision: "043b763f05304c3a55f1bd3f4eb8504a591aa4ba",
      endpoint: "http://127.0.0.1:19876", controlCredentialRef: credential.reference, controlCredentialRevision: credential.revision,
      projectId: "r005-test-project", agentName: "compliance-query", source: "RUN_SOURCE_MANUAL", command },
    managed: { daemonSha256: "8cd19f27f0d6a8ba0dc6158ad50737b3e779fdd6c1e1fc11bb773a21b3ebc447",
      platformManifestSha256: "b3c2bdd28f728935c40a6a5862748bf9a2d7eab3c39f75449ac834d8d2cc26c9",
      deploymentSha256: cqaSha256("not-yet-sealed"), evidenceRoot, daemonInputRoot: "/daemon/accord-inputs", engineInputRoot: "/engine/accord-inputs",
      configFileSha256: cqaSha256("synthetic-protocol-config"), transport: "isolated-http" } };
  const m = binding.managed!;
  const deployment = { schemaVersion: "accord.cqa-deployment/v1", qualification: "protocol-fixture", recordRef: "synthetic-protocol-observation",
    endpoint: binding.runtime.endpoint, transport: m.transport, projectId: binding.runtime.projectId, agentName: binding.runtime.agentName,
    source: binding.runtime.source, daemonSha256: m.daemonSha256, platformManifestSha256: m.platformManifestSha256,
    binarySha256: binding.binarySha256, guestImageSha256: binding.guestImageSha256, configFileSha256: m.configFileSha256,
    configDigest: binding.configDigest, corpusDigest: binding.corpusDigest, daemonInputRoot: m.daemonInputRoot, engineInputRoot: m.engineInputRoot,
    configGuestPath: "/s2/inputs/config.json", receiptGuestPath: "/s2/receipts", receiptHostPath: "/engine/cqa-receipts", receiptMode: "0700", receiptWritable: true,
    payloadReadOnly: true, configReadOnly: true, inputReadOnly: true, controlAuthVerified: true, guestIsolationVerified: true,
    schedulerEnabled: false, catalogPolicy: "GET /admin/v1/catalog/compliance-readonly?format=md&grpc=true:401:UNAVAILABLE_AUTH_DENIED",
    outputCollection: "complete-separated-command/v1", observedAt: now - 1000, validUntil: now + 600_000 };
  const wire = JSON.stringify(deployment); writeFileSync(join(evidenceRoot, "deployment.json"), wire, { mode: 0o400 }); m.deploymentSha256 = cqaSha256(wire);
  const path = join(root, "r005.sqlite");
  const calls: { method: string; request: Record<string, unknown> }[] = [];
  const summaries = new Map<string, Record<string, unknown>>();
  const details = new Map<string, Record<string, unknown>>();
  let intercept: ((method: string, request: Record<string, unknown>) => Response | undefined) | undefined;
  let dropStart = false;
  const send: CqaHttpSender = async (url, init) => {
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
    const headers = new Headers(init.headers); assert.equal(headers.get("Authorization"), `Bearer ${credential.value}`); assert.equal(headers.get("Connect-Protocol-Version"), "1");
    const method = url.slice((binding.runtime.endpoint + "/agentcompose.v2.RunService/").length);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method, request });
    const overridden = intercept?.(method, request); if (overridden) return overridden;
    if (method === "StartAgentRun") {
      const run = request["run"] as Record<string, unknown>;
      assert.equal(run["command"], command.join(" ")); assert.equal(run["cleanupPolicy"], "RUN_SANDBOX_CLEANUP_POLICY_KEEP_RUNNING");
      assert.equal(run["env"], undefined); assert.equal(run["payloadJson"], undefined); assert.equal(run["prompt"], undefined);
      const operationId = String(run["clientRequestId"]);
      assert.deepEqual(run["volumes"], [{ type: "VOLUME_MOUNT_TYPE_BIND", source: `/engine/accord-inputs/${operationId}`, target: "/opt/accord-cqa-input", readOnly: true }]);
      const summary = { runId: `run-${operationId}`, sandboxId: "test-sandbox", projectId: run["projectId"], agentName: run["agentName"], source: run["source"], status: "RUN_STATUS_RUNNING" };
      summaries.set(String(summary.runId), summary);
      details.set(String(summary.runId), { summary, labels: run["labels"], imageRef: `compliance-query-agent-guest@sha256:${binding.guestImageSha256}` });
      if (dropStart) throw new Error("synthetic accepted response lost");
      return jsonResponse({ run: summary, started: true });
    }
    if (method === "ListRuns") { assert.equal(request["limit"], 2); assert.deepEqual(request["labels"], details.values().next().value?.["labels"]); return jsonResponse({ total: summaries.size, runs: [...summaries.values()] }); }
    if (method === "GetRun") return jsonResponse({ run: details.get(String(request["runId"])) });
    if (method === "StopRun") return jsonResponse({ run: details.get(String(request["runId"])), stopRequested: true });
    throw new Error("unexpected protocol method");
  };
  const input = (revision = 1, question = "等保备案需要哪些材料？"): CqaAcceptance => {
    const op = `query-${revision}`;
    return { operationId: op, messageId: `message-${revision}`, messageSequence: revision, appId: binding.appId, conversationId: binding.conversationId,
      actorId: binding.actorId, workflowRunId: "test-workflow", activityId: `activity-${revision}`, contextRevision: revision,
      requestWire: JSON.stringify({ schemaVersion: "cqa.query/v1", requestId: op, question, topic: "mlps", asOfDate: "2026-09-11", jurisdiction: "CN", industry: "all",
        caseId: "test-case", invocationId: `activity-${revision}`, contextDigest: cqaSha256(`context-${revision}`) }),
      grant: { id: `grant-${revision}`, revision: "r3", actorId: binding.actorId, purpose: "synthetic-compliance-query", corpusDigest: binding.corpusDigest,
        bindingDigest: cqaBindingDigest(binding), expiresAt: now + 120_000, maxStarts: 1, maxModelCalls: 1, outboundScope: "synthetic-cqa-managed", recoveryAllowed: true } };
  };
  const output = (operation: CqaFrozenOperation, insufficient = false) => {
    const source = corpus.sources[0]!;
    return { schemaVersion: "cqa.result/v1", agentVersion: binding.agentVersion, requestId: operation.operationId,
      caseId: operation.request.caseId, invocationId: operation.request.invocationId, contextDigest: operation.request.contextDigest,
      inputDigest: operation.inputDigest, configDigest: binding.configDigest, corpusDigest: binding.corpusDigest,
      status: insufficient ? "INSUFFICIENT_EVIDENCE" : "DRAFT_READY", dataMode: "synthetic_demo", generationMode: "llm", asOfDate: operation.request.asOfDate,
      datasetId: corpus.datasetId, claims: insufficient ? [] : [{ text: "给定测试材料记载，已运营二级以上系统在定级后30日内办理备案。", evidenceIds: [source.id] }],
      citations: insufficient ? [] : [{ id: source.id, documentId: source.documentId, title: source.title, version: source.version, publisher: source.publisher,
        sourceKind: source.sourceKind, uri: source.uri, locator: source.locator, quote: source.text, sha256: source.sha256, publishedAt: source.publishedAt,
        effectiveFrom: source.effectiveFrom, validityCheckedAt: source.validityCheckedAt, synthetic: true }],
      reasonCodes: insufficient ? ["NO_ELIGIBLE_EVIDENCE"] : [], warnings: ["synthetic software test"], humanReviewRequired: true, entailmentVerified: false,
      generatedAt: "2026-09-14T12:00:00Z", tokenUsage: insufficient ? { status: "not_called" } : { status: "reported", provider: "baizhi-chat", model: "grok-4.6",
        inputTokens: 1197, outputTokens: 297, totalTokens: 3607, cachedInputTokens: 512, reasoningTokens: 2113 } };
  };
  const complete = (operation: CqaFrozenOperation, fingerprint: string, overrides: Record<string, unknown> = {}, insufficient = false) => {
    const runId = `run-${operation.operationId}`, detail = details.get(runId)!;
    const result = output(operation, insufficient);
    const resultWire = JSON.stringify(result);
    detail["summary"] = { ...summaries.get(runId), status: "RUN_STATUS_SUCCEEDED" };
    detail["output"] = resultWire;
    detail["resultJson"] = JSON.stringify({ mode: "command", command: command.join(" "), success: true, exitCode: 0 });
    const record = { schemaVersion: "accord.cqa-run-observation/v1", qualification: "protocol-fixture", recordRef: "synthetic-stream-observation",
      deploymentSha256: m.deploymentSha256, operationId: operation.operationId, fingerprint, runId, sandboxId: "test-sandbox", binarySha256: binding.binarySha256,
      guestImageSha256: binding.guestImageSha256, configFileSha256: m.configFileSha256, requestFileSha256: operation.input.requestFileSha256,
      engineInputSource: `/engine/accord-inputs/${operation.operationId}`, guestInputTarget: "/opt/accord-cqa-input", inputReadOnly: true,
      receiptGuestPath: "/s2/receipts", receiptHostPath: deployment.receiptHostPath, receiptWritable: true, receiptMode: "0700",
      outputSource: "complete-separated-command/v1", outputComplete: true, outputTruncated: false, stdout: resultWire, stderr: "", ...overrides };
    const directory = join(evidenceRoot, operation.operationId); mkdirSync(directory, { mode: 0o700, recursive: true });
    const file = join(directory, `${runId}.json`); rmSync(file, { force: true }); writeFileSync(file, JSON.stringify(record), { mode: 0o400 });
    return { file, detail, resultWire };
  };
  return { root, binding, path, calls, details, input, output, complete, send, clock: () => now, tick: (ms = 5000) => { now += ms; },
    adapter: () => new CqaRunServiceAdapter(binding, credential, send), drop: () => { dropStart = true; },
    intercept: (fn: NonNullable<typeof intercept>) => { intercept = fn; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("real consumer and Connect adapter bind immutable input, one model candidate and no-evidence without duplicate publication", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); const adapter = f.adapter();
  try {
    const request = f.input(), accepted = consumer.accept(request);
    assert.equal(await consumer.advance(adapter), "unknown");
    assert.equal(readFileSync(accepted.frozen.input.file, "utf8"), accepted.frozen.requestBytes);
    f.complete(accepted.frozen, accepted.fingerprint);
    assert.equal(await consumer.advance(adapter), "complete");
    assert.equal(consumer.snapshot().operations[0]!.candidate!.usage.totalTokens, "3607");
    assert.equal(consumer.snapshot().responses.length, 1);
    consumer.accept(request); await consumer.advance(adapter); assert.equal(f.calls.filter(c => c.method === "StartAgentRun").length, 1);
    const next = consumer.accept(f.input(2, "测试资料是否覆盖税收申报？")); await consumer.advance(adapter);
    f.complete(next.frozen, next.fingerprint, {}, true);
    assert.equal(await consumer.advance(adapter), "complete");
    const state = consumer.snapshot(); assert.equal(state.activeCase!.outcome, "needs_input");
    assert.equal(state.operations[1]!.candidate!.usage.status, "not_called"); assert.deepEqual(state.responses.map(r => r.state), ["suppressed", "ready"]);
    assert.notEqual(next.frozen.input.file, accepted.frozen.input.file);
  } finally { consumer.close(); f.cleanup(); }
});

test("lost Start response discovers a summary, persists it, then spends a separate Get across restart", async () => {
  const f = fixture(); let consumer = new R005CqaConsumer(f.path, f.binding, f.clock); f.drop();
  try {
    const accepted = consumer.accept(f.input()); await consumer.advance(f.adapter()); f.complete(accepted.frozen, accepted.fingerprint);
    assert.equal(await consumer.advance(f.adapter()), "unknown");
    assert.deepEqual(f.calls.map(c => c.method), ["StartAgentRun", "ListRuns"]);
    consumer.close(); consumer = new R005CqaConsumer(f.path, f.binding, f.clock);
    await consumer.advance(f.adapter()); assert.equal(f.calls.length, 2);
    f.tick(); assert.equal(await consumer.advance(f.adapter()), "complete");
    assert.deepEqual(f.calls.map(c => c.method), ["StartAgentRun", "ListRuns", "GetRun"]); assert.equal(consumer.snapshot().operations[0]!.queries, 2);
  } finally { consumer.close(); f.cleanup(); }
});

test("missing observation keeps authenticated original Run cancellable without filling expected evidence", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); const adapter = f.adapter();
  try {
    const accepted = consumer.accept(f.input()); await consumer.advance(adapter);
    const completed = f.complete(accepted.frozen, accepted.fingerprint); rmSync(completed.file);
    assert.equal(await consumer.advance(adapter), "unknown");
    assert.equal(consumer.snapshot().operations[0]!.runId, "run-query-1"); assert.equal(consumer.snapshot().responses.length, 0);
    consumer.requestCancel(accepted.frozen.operationId); await consumer.advance(adapter);
    assert.equal(consumer.snapshot().operations[0]!.cancelAcknowledged, true);
    assert.equal(consumer.snapshot().operations[0]!.state, "unknown"); assert.equal(f.calls.at(-1)!.method, "StopRun");
  } finally { consumer.close(); f.cleanup(); }
});

test("late immutable observation can complete the original Run; wrong stream and mount facts cannot", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); const adapter = f.adapter();
  try {
    const accepted = consumer.accept(f.input()); await consumer.advance(adapter);
    f.complete(accepted.frozen, accepted.fingerprint, { engineInputSource: "/engine/another-operation" });
    assert.equal(await consumer.advance(adapter), "unknown"); assert.equal(consumer.snapshot().responses.length, 0);
    f.complete(accepted.frozen, accepted.fingerprint, { stderr: "warning mixed into output", outputTruncated: true });
    f.tick(); assert.equal(await consumer.advance(adapter), "unknown"); assert.equal(consumer.snapshot().responses.length, 0);
    f.complete(accepted.frozen, accepted.fingerprint); f.tick(); assert.equal(await consumer.advance(adapter), "complete");
    assert.equal(f.calls.filter(c => c.method === "StartAgentRun").length, 1);
  } finally { consumer.close(); f.cleanup(); }
});

test("GetRun with wrong labels cannot bind a discovered Run or authorize StopRun", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); const adapter = f.adapter();
  try {
    const accepted = consumer.accept(f.input()); await consumer.advance(adapter);
    const completed = f.complete(accepted.frozen, accepted.fingerprint); completed.detail["labels"] = { "accord.operation_id": "another-case", "accord.fingerprint": accepted.fingerprint };
    assert.equal(await consumer.advance(adapter), "unknown"); consumer.requestCancel(accepted.frozen.operationId); await consumer.advance(adapter);
    assert.equal(consumer.snapshot().operations[0]!.runId, undefined); assert.equal(consumer.snapshot().responses.length, 0);
    assert.equal(f.calls.some(c => c.method === "StopRun"), false);
  } finally { consumer.close(); f.cleanup(); }
});

test("private deployment preflight refuses widened files and symlinks before any Start", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); const adapter = f.adapter();
  try {
    consumer.accept(f.input()); const file = join(f.binding.managed!.evidenceRoot, "deployment.json"); chmodSync(file, 0o644);
    assert.equal(await consumer.advance(adapter), "accepted"); assert.equal(f.calls.length, 0);
    const saved = readFileSync(file); rmSync(file); const target = join(f.root, "not-the-frozen-path.json"); writeFileSync(target, saved, { mode: 0o400 }); symlinkSync(target, file);
    assert.equal(await consumer.advance(adapter), "accepted"); assert.equal(f.calls.length, 0);
  } finally { consumer.close(); f.cleanup(); }
});

test("default transport refuses protocol-fixture qualification and credentials or private-looking DNS cannot widen scope", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock);
  try {
    consumer.accept(f.input());
    assert.equal(await consumer.advance(new CqaRunServiceAdapter(f.binding, credential)), "accepted");
    assert.equal(consumer.snapshot().operations[0]!.state, "accepted");
    assert.throws(() => new CqaRunServiceAdapter(f.binding, { ...credential, revision: "wrong" }, f.send), /CREDENTIAL/);
    const other = structuredClone(f.binding); other.runtime.endpoint = "http://127.0.0.1.attacker.invalid";
    assert.throws(() => new CqaRunServiceAdapter(other, credential, f.send), /ENDPOINT|BINDING/);
  } finally { consumer.close(); f.cleanup(); }
});

test("oversized RPC response is canceled, its Start remains unknown and neither retries nor leaks raw errors", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock); let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { canceled = true; } });
  f.intercept(() => new Response(stream, { headers: { "Content-Type": "application/json" } }));
  try {
    consumer.accept(f.input()); assert.equal(await consumer.advance(f.adapter()), "unknown");
    assert.equal(canceled, true); assert.equal(f.calls.length, 1); assert.equal(consumer.snapshot().responses.length, 0);
    assert.equal(JSON.stringify(consumer.snapshot()).includes(credential.value), false);
  } finally { consumer.close(); f.cleanup(); }
});

test("redirect rejection consumes one Start and protocol errors do not trigger a direct fallback", async () => {
  const f = fixture(); const consumer = new R005CqaConsumer(f.path, f.binding, f.clock);
  f.intercept(() => new Response(credential.value, { status: 307, headers: { Location: "https://untrusted.invalid", "Content-Type": "application/json" } }));
  try {
    consumer.accept(f.input()); assert.equal(await consumer.advance(f.adapter()), "unknown"); assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(consumer.snapshot()).includes(credential.value), false);
  } finally { consumer.close(); f.cleanup(); }
});

test("real Adapter and driver resume acknowledged pending input after a stale successful Run", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-09-15T12:00:00Z") });
  // @ts-expect-error Explicit JavaScript launcher uses dist modules and has no import-time execution.
  const { runR005LiveDriver } = await import("../../scripts/run-r005.mjs");
  const f = fixture(); f.binding.appId = "00000000-0000-4000-8000-000000000005";
  const consumer = new R005CqaConsumer(f.path, f.binding, f.clock);
  const chat: CqaChatConfiguration = { schemaVersion: "accord.r005-chat/v1", authorizationId: "synthetic-chat-trial",
    authorizationRevision: "r5", expiresAt: f.clock() + 120_000,
    magicChat: { transportVersion: "accord.magicchat-websocket-transport/v2", endpoint: "wss://synthetic.invalid/api/app/ws",
      credentialRef: "r005-chat", credentialRevision: "test-v1" } };
  consumer.configureChat(chat);
  const simulator = new DeterministicMagicChatSimulator({ appId: f.binding.appId, firstMessageSequence: 3 });
  const message = (sequence: number, body: string) => {
    const wire = magicChatMessageCreatedEnvelope({ body, conversationId: f.binding.conversationId, actorId: f.binding.actorId,
      messageId: `input-${sequence}`, envelopeEventId: `event-${sequence}`, messageSequence: sequence, cursor: sequence,
      messageCreatedAt: new Date(f.clock()).toISOString() });
    return { ...wire, payload: { ...wire.payload, message: { ...wire.payload.message, summary: "Synthetic input" } } };
  };
  const until = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.fail("real Adapter did not reach expected state");
  };
  const first = message(1, "问题:等保备案需要哪些材料？\n主题:mlps\n日期:2026-09-11\n地区:CN\n行业:all");
  simulator.observeUserMessage(first); consumer.receive(first);
  await consumer.flush(async request => { consumer.receive(simulator.respond(request, new Date(f.clock()).toISOString())); });
  const old = consumer.snapshot().operations[0]!;
  let receive: (wire: unknown) => void = () => assert.fail("not connected");
  const controller = new AbortController();
  const done = runR005LiveDriver({ consumer, port: f.adapter(), configuration: { schemaVersion: "accord.r005-live/v1", binding: f.binding, chat },
    signal: controller.signal, connect: async (handler: (wire: unknown) => void): Promise<MagicChatTransport> => {
      receive = handler;
      return { closed: Promise.withResolvers<string>().promise, close: () => undefined,
        send: async request => { receive(simulator.respond(request, new Date(f.clock()).toISOString())); } };
    } });
  try {
    await until(() => f.calls.some(call => call.method === "StartAgentRun"));
    const followup = message(2, "补充后的备案问题？"); simulator.observeUserMessage(followup); receive(followup);
    await until(() => f.calls.some(call => call.method === "GetRun") && consumer.snapshot().chat!.sends.some(item => item.state === "sent"));
    await new Promise<void>(resolve => setImmediate(resolve));
    f.complete(old.frozen, old.fingerprint);
    f.tick(); t.mock.timers.tick(5000);
    await until(() => consumer.snapshot().operations[0]!.state === "expired");
    await new Promise<void>(resolve => setImmediate(resolve));
    f.tick(); t.mock.timers.tick(5000);
    await until(() => f.calls.filter(call => call.method === "StartAgentRun").length === 2);
    const next = consumer.snapshot().operations[1]!;
    assert.equal(next.frozen.request.question, "补充后的备案问题？");
    assert.equal(next.frozen.request.caseId, old.frozen.request.caseId);
    assert.equal(consumer.snapshot().operations[0]!.candidate, undefined);
  } finally { controller.abort(); await done; consumer.close(); f.cleanup(); }
});
