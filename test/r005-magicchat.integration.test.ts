import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { cqaCorpusDigest, cqaSha256, type CqaCorpus, type CqaResult } from "../src/contracts/cqa-query.js";
import type { MagicChatChoiceBody, MagicChatMessageSendPayload } from "../src/contracts/magicchat.js";
import type { MagicChatRequestEnvelope, MagicChatMessageSendRequest as Send } from "../src/magicchat/adapter.js";
import { cqaBindingDigest, R005CqaConsumer, type CqaBinding, type CqaChatConfiguration,
  type CqaRun, type CqaRunPort } from "../src/driver/r005-cqa.js";
import { verifyCqaInput } from "../src/driver/r005-input.js";

const instant = Date.parse("2026-09-11T12:00:00Z");
const sourceText = "【合成软件测试】等保备案需保存提交材料。";
const fullQuery = "问题:等保备案需要哪些材料？\n主题:等保\n日期:2026-09-11\n地区:中国\n行业:software";
interface SendReceipt {
  v: 1; id: string; kind: "response"; reply_to: string; ok: true; payload: MagicChatMessageSendPayload;
}
interface ChoiceOptions {
  actorId?: string; conversationId?: string; messageId?: string; responseId?: string;
  body?: MagicChatChoiceBody; optionId?: string; createdAt?: string; messageCreatedAt?: string; messageSequence?: number;
}
function fixture(maxOperations = 10) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "accord-r005-chat-")));
  const corpus: CqaCorpus = { schemaVersion: "cqa.corpus/v1", datasetId: "chat-test", synthetic: true, sources: [{
    id: "source-1", documentId: "document-1", title: "合成等保测试资料", version: "test-v1", topic: "mlps", jurisdiction: "CN", industry: "all",
    publisher: "合成资料维护者", sourceKind: "synthetic", uri: "fixture://chat/document-1", locator: "第一条",
    publishedAt: "2026-01-01", effectiveFrom: "2026-01-01", validityCheckedAt: "2026-09-11", status: "in_force",
    curatorReviewed: true, synthetic: true, keywords: ["备案"], text: sourceText, sha256: cqaSha256(sourceText),
  }] };
  const binding: CqaBinding = { mode: "offline", appId: "app-1", conversationId: "conversation-1", actorId: "user-1",
    profileRevision: "compliance-v1", bindingRevision: "chat-offline-v1", policyRevision: "synthetic-only-v1", skillRevision: "query-v1",
    toolRevision: "search-only-v1", permissionRevision: "isolated-v1", agentVersion: "0.1.0-starter",
    configDigest: cqaSha256("offline-config"), corpus, corpusDigest: cqaCorpusDigest(corpus), generationMode: "extractive",
    binarySha256: cqaSha256("offline-binary"), guestImageSha256: cqaSha256("offline-image"), inputRoot: join(directory, "inputs"), maxOperations,
    runtime: { adapterRevision: "counting-v1", sourceRevision: "synthetic-runtime", endpoint: "offline://counting", controlCredentialRef: "runtime-ref",
      controlCredentialRevision: "v1", projectId: "project-1", agentName: "cqa", source: "compliance",
      command: ["/opt/cqa/compliance-agent", "query", "--config", "/s2/inputs/config.json", "--input", "/opt/accord-cqa-input/request.json"] } };
  const configuration: CqaChatConfiguration = { schemaVersion: "accord.r005-chat/v1", authorizationId: "chat-authorization",
    authorizationRevision: "r1", expiresAt: instant + 3_600_000,
    magicChat: { transportVersion: "accord.magicchat-websocket-transport/v2", endpoint: "wss://chat.invalid/ws/app", credentialRef: "chat-ref", credentialRevision: "v1" } };
  let now = instant, cursor = 0, sequence = 0;
  const path = join(directory, "r005.sqlite");
  let consumer = new R005CqaConsumer(path, binding, () => now);
  consumer.configureChat(configuration);
  const counts = { starts: 0, lookups: 0, cancels: 0 };
  const runs: CqaRun[] = [];
  const producer = { status: "REFERENCE_ONLY" as CqaResult["status"], warnings: ["SYNTHETIC_DATA"] };
  const port: CqaRunPort = {
    mode: "offline", bindingDigest: cqaBindingDigest(binding),
    preflight: operation => verifyCqaInput(operation.input, operation.requestBytes),
    start: async (operation, fingerprint) => {
      counts.starts++;
      const source = corpus.sources[0]!;
      const success = producer.status === "REFERENCE_ONLY";
      const result: CqaResult = { schemaVersion: "cqa.result/v1", agentVersion: binding.agentVersion, requestId: operation.request.requestId,
        caseId: operation.request.caseId, invocationId: operation.request.invocationId, contextDigest: operation.request.contextDigest,
        inputDigest: operation.inputDigest, configDigest: binding.configDigest, corpusDigest: binding.corpusDigest,
        status: producer.status, dataMode: "synthetic_demo", generationMode: "extractive", asOfDate: operation.request.asOfDate,
        datasetId: corpus.datasetId, claims: success ? [{ text: source.text, evidenceIds: [source.id] }] : [],
        citations: success ? [{ id: source.id, documentId: source.documentId, title: source.title, version: source.version, publisher: source.publisher,
          sourceKind: source.sourceKind, uri: source.uri, locator: source.locator, quote: source.text, sha256: source.sha256,
          publishedAt: source.publishedAt, effectiveFrom: source.effectiveFrom, validityCheckedAt: source.validityCheckedAt, synthetic: true }] : [],
        reasonCodes: success ? [] : producer.status === "NEEDS_REVIEW" ? ["CURRENCY_UNVERIFIED"] : ["NO_ELIGIBLE_EVIDENCE"],
        warnings: producer.warnings, humanReviewRequired: true, entailmentVerified: false, generatedAt: "2026-09-11T12:00:00Z" };
      const run: CqaRun = { runId: `run-${counts.starts}`, sandboxId: `sandbox-${counts.starts}`, projectId: binding.runtime.projectId,
        agentName: binding.runtime.agentName, source: binding.runtime.source, operationId: operation.operationId, fingerprint,
        binarySha256: binding.binarySha256, guestImageSha256: binding.guestImageSha256, requestFileSha256: operation.input.requestFileSha256,
        volume: operation.input.volume, status: "succeeded", completeOutput: true, exitCode: 0, cleanupError: false, output: JSON.stringify(result) };
      runs.push(run); return run;
    },
    lookup: async query => { counts.lookups++; const matches = runs.filter(run => run.operationId === query.operationId && run.fingerprint === query.fingerprint);
      return { total: matches.length, runs: matches }; },
    cancel: async () => { counts.cancels++; },
  };
  function message(body: string) {
    cursor++; sequence++;
    return { v: 1, id: `event-${cursor}`, kind: "event", cursor, event: "message.created", payload: {
      conversation: { id: binding.conversationId, name: "R005 test", type: "app", created_by_app_id: binding.appId },
      message: { id: `message:${sequence}`, seq: sequence, body: { type: "text", content: body }, created_at: new Date(now).toISOString(), summary: "user input" },
      sender: { id: binding.actorId, name: "User", nickname: "User", type: "user" },
    } };
  }
  const deliveries: Send[] = [];
  const receipts = new Map<string, SendReceipt>();
  const transport = { confirmMessages: true };
  function sendResponse(request: Send): SendReceipt {
    sequence++;
    return { v: 1, id: `response-${request.id}`, kind: "response", reply_to: request.id, ok: true,
      payload: { conversation: { id: binding.conversationId, name: "R005 test", type: "app" }, created: true,
        message: { id: `server-message-${sequence}`, seq: sequence, body: request.payload.message, created_at: new Date(now).toISOString(), summary: "assistant output",
          sender: { id: binding.appId, name: "R005", nickname: "R005", type: "app" } } } };
  }
  async function send(request: MagicChatRequestEnvelope) {
    if (request.method === "events.ack") {
      consumer.receive({ v: 1, id: `response-${request.id}`, kind: "response", reply_to: request.id, ok: true, payload: { cursor: request.payload.cursor } });
    } else {
      assert.equal(request.method, "message.send");
      if (request.method !== "message.send") throw new Error("unexpected history query");
      deliveries.push(request);
      const receipt = sendResponse(request); receipts.set(request.id, receipt);
      if (transport.confirmMessages) consumer.receive(receipt);
    }
  }
  function choice(options: ChoiceOptions = {}) {
    const card = consumer.snapshot().chat!.sends.filter(item => item.kind === "choice").at(-1)!;
    assert.equal(card.body.type, "choice");
    if (card.body.type !== "choice") throw new Error("choice required");
    cursor++;
    return { v: 1, id: `event-${cursor}`, kind: "event", cursor, event: "choice.response_created", payload: {
      choice_message: { id: options.messageId ?? card.messageId!, seq: options.messageSequence ?? card.messageSequence!, body: options.body ?? card.body,
        created_at: options.messageCreatedAt ?? card.messageCreatedAt!, summary: "choice preview" },
      conversation: { id: options.conversationId ?? binding.conversationId, name: "R005 test", type: "app" },
      response: { id: options.responseId ?? `choice-response-${cursor}`, option_ids: [options.optionId ?? "accept"], created_at: options.createdAt ?? new Date(now).toISOString() },
      sender: { id: options.actorId ?? binding.actorId, name: "User", nickname: "User", type: "user" },
    } };
  }
  async function candidate() {
    consumer.receive(message(fullQuery)); assert.equal(await consumer.advance(port), "complete"); await consumer.flush(send);
  }
  async function preview() { consumer.receive(message("/export")); await consumer.flush(send); }
  return { binding, configuration, path, counts, runs, port, producer, deliveries, receipts, transport, message, choice, send, candidate, preview,
    get consumer() { return consumer; }, tick(ms: number) { now += ms; },
    reopen() { consumer.close(); consumer = new R005CqaConsumer(path, binding, () => now); consumer.configureChat(configuration); },
    cleanup() { consumer.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("partial collection makes zero Start; raw question, complete query and candidate share one durable Case", async () => {
  const h = fixture();
  try {
    const question = "  等保备案需要哪些材料？\n";
    const first = h.message(question); h.consumer.receive(first);
    const caseId = h.consumer.snapshot().activeCase!.id;
    for (const field of ["等保", "2026-09-11", "中国"]) {
      assert.equal(await h.consumer.advance(h.port), "idle");
      await h.consumer.flush(h.send);
      h.consumer.receive(h.message(field));
      assert.equal(h.counts.starts, 0);
      assert.equal(h.consumer.snapshot().activeCase!.id, caseId);
    }
    const complete = h.message("software"); h.consumer.receive(complete);
    const accepted = h.consumer.snapshot().operations[0]!;
    assert.equal(accepted.frozen.request.question, question);
    assert.equal(accepted.frozen.request.caseId, caseId);
    assert.equal(accepted.frozen.messageId, complete.payload.message.id);
    assert.equal(h.consumer.receive(complete), "replayed");
    h.reopen();
    assert.equal(h.consumer.receive(first), "replayed");
    assert.equal(await h.consumer.advance(h.port), "complete"); await h.consumer.flush(h.send);
    const candidate = h.deliveries.at(-1)!.payload.message.content;
    for (const marker of ["候选", "synthetic", "非法律", "test-v1", "第一条", "humanReviewRequired=true", "entailmentVerified=false"]) assert.ok(candidate.includes(marker));
    assert.equal(candidate.split(sourceText).length - 1, 1, "the full citation quote is not appended again to extractive claims");
    assert.ok(Buffer.byteLength(candidate) <= 4096);
    assert.equal(h.consumer.snapshot().chat!.artifacts.length, 0);
    assert.equal(h.counts.starts, 1);
    h.consumer.receive(h.message(question));
    const followup = h.consumer.snapshot().operations[1]!;
    assert.equal(followup.frozen.request.caseId, caseId);
    assert.equal(followup.frozen.request.question, question);
    assert.equal(followup.frozen.request.industry, "software");
    assert.notEqual(followup.frozen.grant.id, accepted.frozen.grant.id);
    assert.equal(await h.consumer.advance(h.port), "complete");
    assert.equal(h.counts.starts, 2, "new message with identical bytes is a new query, not a text replay");
  } finally { h.cleanup(); }
});

test("invalid dates, unsupported scope, excessive input and ambiguous field edits never submit", async () => {
  for (const invalid of [fullQuery.replace("主题:等保", "主题:ciip"), fullQuery.replace("2026-09-11", "2026-02-30"),
    fullQuery.replace("地区:中国", "地区:US"), fullQuery.replace("行业:software", `行业:${"界".repeat(27)}`),
    `${fullQuery}\n行业:other`, `${fullQuery}\n未声明:ignored`, "问".repeat(2667), ""]) {
    const h = fixture();
    try {
      h.consumer.receive(h.message(invalid)); await h.consumer.advance(h.port); await h.consumer.flush(h.send);
      assert.equal(h.counts.starts, 0); assert.equal(h.consumer.snapshot().operations.length, 0);
      assert.match(h.deliveries.at(-1)!.payload.message.content, /无效|字段/);
      h.consumer.receive(h.message(fullQuery)); assert.equal(await h.consumer.advance(h.port), "complete");
      assert.equal(h.counts.starts, 1);
    } finally { h.cleanup(); }
  }
});

test("receipt, context and complete Operation roll back together before ACK or Start", async () => {
  const h = fixture(); const db = new DatabaseSync(h.path);
  try {
    const input = h.message(fullQuery);
    db.exec("CREATE TRIGGER fail_chat BEFORE UPDATE ON r005_cqa BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
    assert.throws(() => h.consumer.receive(input), /synthetic disk failure/);
    const state = h.consumer.snapshot();
    assert.equal(state.activeCase, undefined); assert.equal(state.chat!.receipts.length, 0); assert.equal(state.operations.length, 0);
    assert.equal(h.counts.starts, 0); assert.equal(h.deliveries.length, 0);
    db.exec("DROP TRIGGER fail_chat");
    h.consumer.receive(input); h.reopen(); assert.equal(await h.consumer.advance(h.port), "complete");
    assert.equal(h.counts.starts, 1);
  } finally { db.close(); h.cleanup(); }
});

test("new input is synchronous during RPC, invalidates old context immediately and never replaces unknown Run", async () => {
  const h = fixture();
  let release: (run: CqaRun) => void = () => { throw new Error("start not reached"); };
  let entered: () => void = () => { throw new Error("gate not installed"); };
  const started = new Promise<void>(resolve => { entered = resolve; });
  const start = h.port.start;
  h.port.start = async (...args) => {
    const run = await start(...args); assert.ok("runId" in run);
    entered(); return new Promise<CqaRun>(resolve => { release = resolve; });
  };
  try {
    h.consumer.receive(h.message(fullQuery));
    const pending = h.consumer.advance(h.port); await started;
    const old = h.consumer.snapshot().operations[0]!;
    h.consumer.receive(h.message("补充后的备案问题？"));
    assert.equal(h.consumer.snapshot().operations.length, 1);
    assert.equal(h.consumer.snapshot().operations[0]!.state, "unknown");
    assert.ok(h.consumer.snapshot().activeCase!.revision > old.frozen.contextRevision);
    assert.equal(h.consumer.snapshot().chat!.draft!.fields.question, "补充后的备案问题？");
    release(h.runs[0]!); assert.equal(await pending, "expired");
    assert.equal(h.consumer.snapshot().responses.length, 0);
    h.port.start = start; assert.equal(await h.consumer.advance(h.port), "complete");
    assert.equal(h.counts.starts, 2);
    assert.equal(h.consumer.snapshot().operations[1]!.frozen.request.question, "补充后的备案问题？");
  } finally { h.cleanup(); }
});

test("only the actual exact choice establishes acceptance and a single exact formal delivery", async () => {
  const h = fixture();
  try {
    await h.candidate(); await h.preview();
    const artifact = h.consumer.snapshot().chat!.artifacts[0]!;
    const card = h.deliveries.at(-1)!;
    assert.equal(card.payload.message.type, "choice");
    assert.ok(card.payload.message.content.includes(artifact.text));
    assert.ok(card.payload.message.content.includes(artifact.digest));
    assert.equal(cqaSha256(artifact.text), artifact.digest);
    assert.ok(Buffer.byteLength(card.payload.message.content) <= 4096);
    assert.ok(artifact.expiresAt - artifact.createdAt <= 15 * 60_000);
    h.consumer.receive(h.message("同意")); await h.consumer.flush(h.send);
    assert.equal(h.consumer.snapshot().chat!.artifacts[0]!.state, "pending");
    assert.equal(h.consumer.snapshot().chat!.decisions.length, 0);
    const choice = h.choice(); h.consumer.receive(choice);
    assert.equal(h.consumer.receive(choice), "replayed");
    assert.throws(() => h.consumer.receive(h.choice({ responseId: choice.payload.response.id, optionId: "reject" })), /CHOICE_IDENTITY_CONFLICT/);
    const malformed = h.choice(); malformed.payload.response.option_ids = ["accept", "reject"];
    assert.throws(() => h.consumer.receive(malformed), /exactly one/);
    await h.consumer.flush(h.send); h.reopen(); await h.consumer.flush(h.send);
    assert.equal(h.consumer.receive(choice), "replayed");
    const accepted = h.consumer.snapshot().chat!;
    assert.equal(accepted.decisions.filter(item => item.outcome === "accepted").length, 1);
    assert.equal(accepted.sends.filter(item => item.kind === "formal").length, 1);
    const formal = accepted.sends.find(item => item.kind === "formal")!;
    assert.equal(formal.state, "sent"); assert.equal(formal.body.content, artifact.text);
    assert.equal(h.deliveries.filter(item => item.id === formal.id).length, 1);
    h.consumer.receive(h.message("/export")); await h.consumer.flush(h.send);
    assert.equal(h.consumer.snapshot().chat!.artifacts.length, 1);
    assert.equal(h.counts.starts, 1);
  } finally { h.cleanup(); }
});

test("choice rejects wrong principal, message identity, body/revision/digest, timing and stale context without accepting", async () => {
  for (const attack of ["actor", "conversation", "message", "sequence", "message-time", "revision", "digest", "future", "expired", "new-input", "revoked"] as const) {
    const h = fixture();
    try {
      await h.candidate(); await h.preview();
      const artifact = h.consumer.snapshot().chat!.artifacts[0]!;
      const options: ChoiceOptions = {};
      if (attack === "actor") options.actorId = "other-user";
      if (attack === "conversation") options.conversationId = "other-conversation";
      if (attack === "message") options.messageId = "other-card";
      if (attack === "sequence") options.messageSequence = 999;
      if (attack === "message-time") options.messageCreatedAt = new Date(instant - 1).toISOString();
      if (attack === "revision") options.body = { ...artifact.choiceBody, content: artifact.choiceBody.content.replace("修订 1", "修订 2") };
      if (attack === "digest") options.body = { ...artifact.choiceBody, content: artifact.choiceBody.content.replace(artifact.digest, "0".repeat(64)) };
      if (attack === "future") options.createdAt = new Date(instant + 60_000).toISOString();
      if (attack === "expired") h.tick(15 * 60_000);
      if (attack === "new-input") {
        h.consumer.receive(h.message("日期:2026-02-30"));
        assert.equal(h.consumer.snapshot().chat!.artifacts[0]!.state, "invalidated", "field edit invalidates even without another accepted query");
      }
      if (attack === "revoked") h.consumer.revoke(artifact.operationId, true);
      h.consumer.receive(h.choice(options)); await h.consumer.flush(h.send);
      assert.equal(h.consumer.snapshot().chat!.decisions.some(item => item.outcome === "accepted"), false, attack);
      assert.equal(h.consumer.snapshot().chat!.sends.some(item => item.kind === "formal"), false, attack);
      assert.equal(h.counts.starts, 1, attack);
    } finally { h.cleanup(); }
  }
});

test("rejection is durable; later input creates a distinct revision and cannot reuse the old choice", async () => {
  const h = fixture();
  try {
    await h.candidate(); await h.preview();
    const rejected = h.choice({ optionId: "reject" }); h.consumer.receive(rejected); await h.consumer.flush(h.send);
    assert.equal(h.consumer.snapshot().chat!.artifacts[0]!.state, "rejected");
    h.consumer.receive(h.choice()); await h.consumer.flush(h.send);
    assert.equal(h.consumer.snapshot().chat!.sends.some(item => item.kind === "formal"), false);
    h.consumer.receive(h.message("请补充备案材料的保存要求？")); await h.consumer.advance(h.port); await h.consumer.flush(h.send); await h.preview();
    const artifacts = h.consumer.snapshot().chat!.artifacts;
    assert.equal(artifacts.length, 2); assert.equal(artifacts[1]!.revision, 2);
    const oldAccept = structuredClone(rejected); oldAccept.id = "late-event"; oldAccept.cursor = h.consumer.snapshot().chat!.cursor + 1;
    oldAccept.payload.response.id = "late-old-accept"; oldAccept.payload.response.option_ids = ["accept"];
    h.consumer.receive(oldAccept);
    assert.equal(h.consumer.snapshot().chat!.artifacts[1]!.state, "pending");
    h.reopen();
    assert.equal(h.consumer.snapshot().chat!.decisions[0]!.outcome, "rejected");
    assert.equal(h.consumer.snapshot().chat!.sends.some(item => item.kind === "formal"), false);
  } finally { h.cleanup(); }
});

test("NEEDS_REVIEW and insufficient evidence remain unaccepted after export requests", async () => {
  for (const status of ["NEEDS_REVIEW", "INSUFFICIENT_EVIDENCE"] as const) {
    const h = fixture(); h.producer.status = status;
    try {
      await h.candidate(); await h.preview();
      assert.equal(h.consumer.snapshot().activeCase!.outcome, status === "NEEDS_REVIEW" ? "needs_review" : "needs_input");
      assert.equal(h.consumer.snapshot().chat!.artifacts.length, 0);
      assert.equal(h.deliveries.some(item => item.payload.message.type === "choice"), false);
      h.consumer.receive(h.message("同意")); assert.equal(h.consumer.snapshot().chat!.decisions.length, 0);
      assert.equal(h.counts.starts, 1);
    } finally { h.cleanup(); }
  }
});

test("a complete rendering over 4096 bytes asks for narrow scope without truncation or Artifact", async () => {
  const h = fixture(); h.producer.warnings = ["synthetic-warning-".repeat(300)];
  try {
    await h.candidate(); await h.preview();
    assert.equal(h.consumer.snapshot().operations[0]!.state, "complete", "valid source result is retained, not silently truncated");
    assert.match(h.deliveries[0]!.payload.message.content, /范围过大/);
    assert.equal(h.consumer.snapshot().chat!.artifacts.length, 0);
    assert.equal(h.deliveries.some(item => item.payload.message.type === "choice"), false);
    assert.ok(h.deliveries.every(item => Buffer.byteLength(item.payload.message.content) <= 4096));
  } finally { h.cleanup(); }
});

test("lost formal-send acknowledgement remains unknown across restart with or without new context; no resend", async () => {
  for (const newContext of [false, true]) {
    const h = fixture();
    try {
      await h.candidate(); await h.preview(); h.consumer.receive(h.choice());
      h.transport.confirmMessages = false; await h.consumer.flush(h.send);
      const formal = h.consumer.snapshot().chat!.sends.find(item => item.kind === "formal")!;
      assert.equal(formal.state, "unknown"); const visible = h.deliveries.length;
      h.reopen();
      if (newContext) h.consumer.receive(h.message("另一个备案问题？"));
      await h.consumer.flush(h.send); await h.consumer.advance(h.port); await h.consumer.flush(h.send);
      assert.equal(h.deliveries.length, visible, "same client ID is not durable dedup proof");
      assert.equal(h.counts.starts, 1);
      assert.equal(h.consumer.snapshot().chat!.sends.find(item => item.id === formal.id)!.state, "unknown");
      const receipt = h.receipts.get(formal.id)!;
      const wrong = { ...receipt, payload: { ...receipt.payload, message: { ...receipt.payload.message,
        body: { type: "text", content: "guessed by body" } } } };
      assert.throws(() => h.consumer.receive(wrong), /SEND_MISMATCH/);
      assert.equal(h.consumer.receive(receipt), "confirmed");
      h.transport.confirmMessages = true;
      if (newContext) assert.equal(await h.consumer.advance(h.port), "complete");
      await h.consumer.flush(h.send);
      assert.equal(h.deliveries.filter(item => item.id === formal.id).length, 1);
      assert.equal(h.consumer.snapshot().chat!.artifacts[0]!.state, "accepted", "historical acceptance survives later context");
    } finally { h.cleanup(); }
  }
});

test("stop preserves unresolved Run, new Case cannot replace it, and global operation budget survives new Cases", async () => {
  const h = fixture(1);
  try {
    const start = h.port.start;
    h.port.start = async (...args) => { await start(...args); throw new Error("lost start response"); };
    h.consumer.receive(h.message(fullQuery)); assert.equal(await h.consumer.advance(h.port), "unknown");
    const originalCase = h.consumer.snapshot().activeCase!.id;
    h.consumer.receive(h.message("停止")); h.consumer.receive(h.message("/new"));
    assert.equal(h.consumer.snapshot().activeCase!.id, originalCase);
    assert.equal(h.consumer.snapshot().operations[0]!.state, "unknown");
    await h.consumer.advance(h.port);
    assert.equal(h.consumer.snapshot().operations[0]!.state, "expired");
    h.consumer.receive(h.message("/new")); h.consumer.receive(h.message(fullQuery)); await h.consumer.advance(h.port);
    assert.notEqual(h.consumer.snapshot().activeCase!.id, originalCase);
    assert.equal(h.counts.starts, 1); assert.equal(h.consumer.snapshot().operations.length, 1);
    await h.consumer.flush(h.send); assert.match(h.deliveries.at(-1)!.payload.message.content, /次数已用完/);
  } finally { h.cleanup(); }
});

test("frozen chat authority rejects reflection drift; expired reopen is inspect-only for sends and Start", async () => {
  const h = fixture();
  try {
    h.consumer.receive(h.message(fullQuery));
    assert.throws(() => h.consumer.configureChat({ ...h.configuration, authorizationRevision: "changed" }), /CONFIGURATION_DRIFT/);
    const changed = structuredClone(h.binding); changed.permissionRevision = "changed";
    assert.throws(() => new R005CqaConsumer(h.path, changed), /STATE_OR_BINDING_DRIFT/);
    h.tick(3_600_000); h.reopen(); await h.consumer.advance(h.port); await h.consumer.flush(h.send);
    assert.equal(h.counts.starts, 0); assert.equal(h.deliveries.length, 0);
    assert.equal(h.consumer.snapshot().operations[0]!.state, "expired");
  } finally { h.cleanup(); }
});

test("stable input IDs and bounded receipts reject conflicts without forgetting replay identities", () => {
  const h = fixture();
  try {
    const input = h.message("首个问题？"); h.consumer.receive(input);
    const changed = structuredClone(input); changed.payload.message.body.content = "冲突正文？";
    assert.throws(() => h.consumer.receive(changed), /CURSOR_CONFLICT/);
    changed.cursor = 2; changed.id = "changed-message-event";
    assert.throws(() => h.consumer.receive(changed), /MESSAGE_CONFLICT/);
    for (let cursor = 2; cursor <= 512; cursor++) {
      const replay = structuredClone(input); replay.cursor = cursor; replay.id = `replay-event-${cursor}`;
      assert.equal(h.consumer.receive(replay), "replayed");
    }
    const overflow = structuredClone(input); overflow.cursor = 513; overflow.id = "overflow-event";
    assert.throws(() => h.consumer.receive(overflow), /PILOT_LIMIT/);
    assert.equal(h.consumer.receive(input), "replayed");
    assert.equal(h.consumer.snapshot().chat!.messages.length, 1); assert.equal(h.consumer.snapshot().operations.length, 0);
  } finally { h.cleanup(); }
});

test("the 256-message bound stops new identities without forgetting prior receipts", () => {
  const h = fixture();
  try {
    const first = h.message("问题:需要备案吗？"); h.consumer.receive(first);
    for (let index = 1; index < 256; index++) h.consumer.receive(h.message("问题:补充备案问题？"));
    assert.throws(() => h.consumer.receive(h.message(fullQuery)), /PILOT_LIMIT/);
    assert.equal(h.consumer.receive(first), "replayed");
    assert.equal(h.consumer.snapshot().chat!.messages.length, 256);
    assert.equal(h.consumer.snapshot().operations.length, 0); assert.equal(h.counts.starts, 0);
  } finally { h.cleanup(); }
});

test("unbound actor, App, group and conversation messages cannot create a receipt or Operation", () => {
  for (const mismatch of ["actor", "app", "group", "conversation"]) {
    const h = fixture();
    try {
      const input = h.message(fullQuery);
      if (mismatch === "actor") input.payload.sender.id = "other-user";
      if (mismatch === "app") input.payload.conversation.created_by_app_id = "other-app";
      if (mismatch === "group") input.payload.conversation.type = "group";
      if (mismatch === "conversation") input.payload.conversation.id = "other-conversation";
      assert.throws(() => h.consumer.receive(input), /SCOPE_MISMATCH/);
      assert.equal(h.consumer.snapshot().chat!.receipts.length, 0);
      assert.equal(h.consumer.snapshot().operations.length, 0);
    } finally { h.cleanup(); }
  }
});
