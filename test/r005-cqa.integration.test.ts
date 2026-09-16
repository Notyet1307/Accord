import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { cqaCorpusDigest, cqaSha256, parseCqaCorpus, type CqaCorpus, type CqaResult } from "../src/contracts/cqa-query.js";
import { cqaBindingDigest, R005CqaConsumer, type CqaAcceptance, type CqaFrozenOperation, type CqaBinding,
  type CqaRun, type CqaRunPort } from "../src/driver/r005-cqa.js";
import { prepareCqaInput, verifyCqaInput } from "../src/driver/r005-input.js";

const instant = Date.parse("2026-09-11T12:00:00Z");
const sourceText = "【合成软件测试】等保备案需保存提交材料。";
const corpus: CqaCorpus = { schemaVersion: "cqa.corpus/v1", datasetId: "offline-document", synthetic: true, sources: [{
  id: "source-1", documentId: "document-1", title: "合成等保测试文档", version: "test-v1", topic: "mlps", jurisdiction: "CN", industry: "all",
  publisher: "测试资料维护者", sourceKind: "synthetic", uri: "fixture://offline/document-1", locator: "第一条",
  publishedAt: "2026-01-01", effectiveFrom: "2026-01-01", validityCheckedAt: "2026-09-11", status: "in_force",
  curatorReviewed: true, synthetic: true, keywords: ["备案"], text: sourceText, sha256: cqaSha256(sourceText),
}] };
function environment() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "accord-r005-consumer-")));
  let now = instant;
  const binding: CqaBinding = { mode: "offline", appId: "app-1", conversationId: "conversation-1", actorId: "user-1",
    profileRevision: "compliance-v1", bindingRevision: "offline-v1", policyRevision: "synthetic-only-v1", skillRevision: "query-v1",
    toolRevision: "search-only-v1", permissionRevision: "isolated-v1", agentVersion: "0.1.0-starter",
    configDigest: cqaSha256("offline-config"), corpus, corpusDigest: cqaCorpusDigest(corpus), generationMode: "extractive",
    binarySha256: cqaSha256("offline-binary"), guestImageSha256: cqaSha256("offline-image"), inputRoot: join(directory, "inputs"), maxOperations: 10,
    runtime: { adapterRevision: "counting-v1", sourceRevision: "synthetic-runtime", endpoint: "offline://counting", controlCredentialRef: "offline-ref",
      controlCredentialRevision: "not-a-secret-v1", projectId: "project-1", agentName: "cqa", source: "compliance",
      command: ["/opt/cqa/compliance-agent", "query", "--config", "/s2/inputs/config.json", "--input", "/opt/accord-cqa-input/request.json"] } };
  const path = join(directory, "r005.sqlite");
  return { directory, binding, path, clock: () => now, tick: (ms: number) => { now += ms; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function managedEnvironment() {
  const env = environment(); const binding = env.binding;
  binding.mode = "managed"; binding.generationMode = "llm"; binding.provider = "baizhi-chat"; binding.model = "grok-4.6";
  binding.corpus = parseCqaCorpus(readFileSync(new URL("../../test/fixtures/r005-s2-corpus.json", import.meta.url), "utf8"));
  binding.corpusDigest = cqaCorpusDigest(binding.corpus);
  binding.binarySha256 = "a98b6423b7b3602ff2777e52a48747fda4e3d018742a5e4ad2a760850b8a7355";
  binding.guestImageSha256 = "e202e11188012c8489fd7df87cf07fa14b3136ad16df86e84972f5be8eb4e367";
  binding.runtime.source = "RUN_SOURCE_MANUAL"; binding.runtime.sourceRevision = "043b763f05304c3a55f1bd3f4eb8504a591aa4ba";
  binding.runtime.endpoint = "https://cqa.invalid";
  binding.managed = { daemonSha256: "8cd19f27f0d6a8ba0dc6158ad50737b3e779fdd6c1e1fc11bb773a21b3ebc447",
    platformManifestSha256: "b3c2bdd28f728935c40a6a5862748bf9a2d7eab3c39f75449ac834d8d2cc26c9",
    deploymentSha256: cqaSha256("local-test-deployment"), configFileSha256: cqaSha256("local-test-config"),
    evidenceRoot: join(env.directory, "evidence"), daemonInputRoot: "/daemon/inputs", engineInputRoot: "/engine/inputs", transport: "tls" };
  return env;
}
function input(binding: CqaBinding, revision = 1, question = "等保备案需要哪些材料？"): CqaAcceptance {
  const operationId = `operation-${revision}`;
  return { operationId, messageId: `message-${revision}`, messageSequence: revision, appId: binding.appId, conversationId: binding.conversationId,
    actorId: binding.actorId, workflowRunId: "workflow-1", activityId: `activity-${revision}`, contextRevision: revision,
    requestWire: JSON.stringify({ schemaVersion: "cqa.query/v1", requestId: operationId, question, topic: "mlps", asOfDate: "2026-09-11",
      jurisdiction: "CN", industry: "software", caseId: "case-1", invocationId: `activity-${revision}`, contextDigest: cqaSha256(`context-${revision}`) }),
    grant: { id: `grant-${revision}`, revision: "v1", actorId: binding.actorId, purpose: "synthetic-compliance-query", corpusDigest: binding.corpusDigest,
      bindingDigest: cqaBindingDigest(binding), expiresAt: instant + 600_000, maxStarts: 1, maxModelCalls: binding.generationMode === "llm" ? 1 : 0,
      outboundScope: binding.mode === "managed" ? "synthetic-cqa-managed" : "offline-only", recoveryAllowed: true } };
}
function result(operation: CqaFrozenOperation, binding: CqaBinding): CqaResult {
  const source = binding.corpus.sources[0]!;
  return { schemaVersion: "cqa.result/v1", agentVersion: binding.agentVersion, requestId: operation.request.requestId,
    caseId: operation.request.caseId, invocationId: operation.request.invocationId, contextDigest: operation.request.contextDigest,
    inputDigest: operation.inputDigest, configDigest: binding.configDigest, corpusDigest: binding.corpusDigest,
    status: binding.generationMode === "llm" ? "DRAFT_READY" : "REFERENCE_ONLY", dataMode: "synthetic_demo", generationMode: binding.generationMode, asOfDate: operation.request.asOfDate,
    datasetId: binding.corpus.datasetId, claims: [{ text: source.text, evidenceIds: [source.id] }], citations: [{
      id: source.id, documentId: source.documentId, title: source.title, version: source.version, publisher: source.publisher,
      sourceKind: source.sourceKind, uri: source.uri, locator: source.locator, quote: source.text, sha256: source.sha256,
      publishedAt: source.publishedAt, effectiveFrom: source.effectiveFrom, validityCheckedAt: source.validityCheckedAt, synthetic: true,
    }], reasonCodes: [], warnings: ["SYNTHETIC_DATA"], humanReviewRequired: true, entailmentVerified: false, generatedAt: "2026-09-11T12:00:00Z" };
}
function observation(operation: CqaFrozenOperation, fingerprint: string, binding: CqaBinding, output = JSON.stringify(result(operation, binding))): CqaRun {
  return { runId: `run-${operation.operationId}`, sandboxId: `sandbox-${operation.operationId}`, projectId: binding.runtime.projectId,
    agentName: binding.runtime.agentName, source: binding.runtime.source, operationId: operation.operationId, fingerprint,
    binarySha256: binding.binarySha256, guestImageSha256: binding.guestImageSha256, requestFileSha256: operation.input.requestFileSha256,
    volume: operation.input.volume, status: "succeeded", completeOutput: true, exitCode: 0, cleanupError: false, output };
}
function counting(binding: CqaBinding) {
  const runs: CqaRun[] = [];
  let starts = 0, lookups = 0, cancels = 0;
  const port = { mode: binding.mode, bindingDigest: cqaBindingDigest(binding),
    preflight: (operation: CqaFrozenOperation) => verifyCqaInput(operation.input, operation.requestBytes),
    start: async (operation, fingerprint, _signal) => { starts++; const run = observation(operation, fingerprint, binding); runs.push(run); return run; },
    lookup: async (query, _signal) => { lookups++; const matches = runs.filter(run => run.operationId === query.operationId && run.fingerprint === query.fingerprint &&
      (query.runId === undefined || query.runId === run.runId)); return { total: matches.length, runs: matches }; },
    cancel: async (_runId, _signal) => { cancels++; },
  } satisfies CqaRunPort;
  return { port, runs, counts: () => ({ starts, lookups, cancels }) };
}

test("committed acceptance precedes input/start; restart preserves one candidate, source entries and message replay", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding);
  try {
    const accepted = consumer.accept(input(env.binding));
    assert.equal(existsSync(accepted.frozen.input.file), false);
    const start = runtime.port.start;
    runtime.port.start = async (operation, fingerprint, signal) => {
      const reader = new R005CqaConsumer(env.path, env.binding, env.clock);
      try { assert.equal(reader.snapshot().operations[0]!.state, "unknown"); } finally { reader.close(); }
      assert.equal(readFileSync(operation.input.file, "utf8"), operation.requestBytes);
      return start(operation, fingerprint, signal);
    };
    assert.equal(await consumer.advance(runtime.port), "complete");
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(consumer.accept(input(env.binding)).state, "complete");
    assert.equal(await consumer.advance(runtime.port), "idle");
    const state = consumer.snapshot();
    assert.equal(state.activeCase?.outcome, "candidate");
    assert.equal(state.operations[0]!.candidate?.result.citations[0]!.quote, sourceText);
    assert.deepEqual(state.responses[0]!.claims[0]!.evidenceEntryIds, state.responses[0]!.entryIds);
    assert.notEqual(state.responses[0]!.entryIds[0], "source-1");
    assert.equal(state.responses[0]!.state, "ready", "intent is not a delivered or approved Artifact");
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 0, cancels: 0 });
  } finally { consumer.close(); env.cleanup(); }
});

test("acceptance rollback and identity conflicts never create input or a second start", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  const blocker = new DatabaseSync(env.path);
  try {
    blocker.exec("CREATE TRIGGER fail_accept BEFORE UPDATE ON r005_cqa BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
    assert.throws(() => consumer.accept(input(env.binding)), /synthetic disk failure/);
    assert.equal(consumer.snapshot().operations.length, 0); assert.equal(existsSync(env.binding.inputRoot), false);
    blocker.exec("DROP TRIGGER fail_accept");
    consumer.accept(input(env.binding));
    assert.throws(() => consumer.accept(input(env.binding, 1, "不同问题")), /IDENTITY_CONFLICT/);
    const changedGrant = input(env.binding); changedGrant.grant.revision = "changed";
    assert.throws(() => consumer.accept(changedGrant), /IDENTITY_CONFLICT/);
    assert.equal(await consumer.advance(runtime.port), "complete");
    assert.equal(runtime.counts().starts, 1);
  } finally { blocker.close(); consumer.close(); env.cleanup(); }
});

test("accepted checkpoint restarts with original deadline; neighboring same-text messages have separate immutable inputs", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    const first = consumer.accept(input(env.binding)); consumer.close(); env.tick(10_000);
    consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(consumer.accept(input(env.binding)).frozen.deadline, first.frozen.deadline);
    assert.equal(await consumer.advance(runtime.port), "complete");
    const second = consumer.accept(input(env.binding, 2));
    assert.equal(await consumer.advance(runtime.port), "complete");
    assert.notEqual(first.frozen.input.file, second.frozen.input.file);
    assert.equal(readFileSync(first.frozen.input.file, "utf8"), first.frozen.requestBytes);
    assert.equal(readFileSync(second.frozen.input.file, "utf8"), second.frozen.requestBytes);
    assert.deepEqual(consumer.snapshot().responses.map(item => item.state), ["suppressed", "ready"]);
    assert.equal(runtime.counts().starts, 2);
  } finally { consumer.close(); env.cleanup(); }
});

test("lost first response recovers uniquely by original identity, with no replacement Run", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { await start(...args); throw new Error("receipt lost"); };
    assert.equal(await consumer.advance(runtime.port), "unknown");
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(await consumer.advance(runtime.port), "complete");
    assert.equal(consumer.snapshot().operations[0]!.runId, runtime.runs[0]!.runId);
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 1, cancels: 0 });
  } finally { consumer.close(); env.cleanup(); }
});

test("zero/multiple lookup matches remain unknown; spacing, six-query budget and restart preserve limits", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { await start(...args); throw new Error("lost"); };
    await consumer.advance(runtime.port); const original = runtime.runs.pop()!;
    assert.equal(await consumer.advance(runtime.port), "unknown");
    await consumer.advance(runtime.port); assert.equal(runtime.counts().lookups, 1);
    runtime.runs.push(original, { ...original, runId: "other-run" }); env.tick(5000);
    assert.equal(await consumer.advance(runtime.port), "unknown");
    runtime.runs.length = 0;
    for (let i = 0; i < 4; i++) { env.tick(5000); await consumer.advance(runtime.port); }
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    env.tick(5000); runtime.runs.push(original); await consumer.advance(runtime.port);
    assert.equal(consumer.snapshot().operations[0]!.state, "unknown");
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 6, cancels: 0 });
    assert.throws(() => consumer.closeCase(), /UNRESOLVED/);
  } finally { consumer.close(); env.cleanup(); }
});

test("absolute recovery window and operation deadline dominate unused query budget", async () => {
  for (const delay of [30_000, 120_000]) {
    const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => { await start(...args); throw new Error("lost"); };
      await consumer.advance(runtime.port); runtime.runs.length = 0;
      await consumer.advance(runtime.port); env.tick(delay); await consumer.advance(runtime.port);
      assert.deepEqual(runtime.counts(), { starts: 1, lookups: 1, cancels: 0 });
      assert.equal(consumer.snapshot().operations[0]!.state, "unknown");
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("new context, cancellation, expiry and revoked authorization cannot commit an in-flight answer", async () => {
  for (const change of ["context", "cancel", "expiry", "revoke"] as const) {
    const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => {
        const run = await start(...args);
        if (change === "context") consumer.accept(input(env.binding, 2));
        if (change === "cancel") consumer.requestCancel("operation-1");
        if (change === "expiry") env.tick(120_000);
        if (change === "revoke") consumer.revoke("operation-1", false);
        return run;
      };
      await consumer.advance(runtime.port);
      consumer.collect("operation-1", runtime.runs[0]!);
      assert.equal(consumer.snapshot().responses.length, 0);
      assert.equal(consumer.snapshot().operations[0]!.candidate, undefined);
      assert.equal(runtime.counts().starts, 1);
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("canceling a known Run is durable, does not depend on lookup, and ACK is not terminal completion", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { const run = await start(...args); run.status = "running"; return run; };
    const lookup = runtime.port.lookup;
    runtime.port.lookup = async (...args) => { await lookup(...args); throw new Error("lookup unavailable"); };
    assert.equal(await consumer.advance(runtime.port), "unknown"); consumer.requestCancel("operation-1");
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(await consumer.advance(runtime.port), "unknown");
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 0, cancels: 1 });
    assert.equal(consumer.snapshot().operations[0]!.cancelAcknowledged, true);
    assert.equal(consumer.snapshot().operations[0]!.terminal, undefined);
    await consumer.advance(runtime.port);
    assert.equal(runtime.counts().lookups, 1);
    assert.equal(runtime.counts().cancels, 1);
    assert.equal(consumer.snapshot().operations[0]!.state, "unknown");
  } finally { consumer.close(); env.cleanup(); }
});

test("cancel before start and revocation without recovery permission cause no new port calls", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); consumer.requestCancel("operation-1");
    assert.equal(await consumer.advance(runtime.port), "idle");
    assert.equal(existsSync(env.binding.inputRoot), false);
    consumer.accept(input(env.binding, 2)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { await start(...args); throw new Error("lost"); };
    await consumer.advance(runtime.port); consumer.revoke("operation-2", false); await consumer.advance(runtime.port);
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 0, cancels: 0 });
  } finally { consumer.close(); env.cleanup(); }
});

test("a valid winner survives divergent, malformed and wrong-image late observations", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    const accepted = consumer.accept(input(env.binding)); await consumer.advance(runtime.port);
    const winner = consumer.snapshot().operations[0]!.candidate!; const run = runtime.runs[0]!;
    consumer.collect("operation-1", run);
    consumer.collect("operation-1", { ...run, output: `${String(run.output)}\n` });
    consumer.collect("operation-1", { ...run, output: "not-json" });
    consumer.collect("operation-1", { ...run, guestImageSha256: cqaSha256("drift") });
    const state = consumer.snapshot();
    assert.deepEqual(state.operations[0]!.candidate, winner); assert.equal(state.responses.length, 1);
    assert.equal(state.operations[0]!.fingerprint, accepted.fingerprint);
    assert.equal(state.audit.some(item => item.code === "RESULT_DIVERGENCE"), true);
    assert.equal(state.audit.some(item => item.code === "RESULT_REJECTED"), true);
    assert.equal(state.audit.some(item => item.code === "RUN_BINDING_REJECTED"), true);
  } finally { consumer.close(); env.cleanup(); }
});

test("bad output, forged citation, mixed logs and truncated shells do not produce candidate intents", async () => {
  for (const fault of ["schema", "citation", "logs", "truncated", "binding"] as const) {
    const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => {
        const run = await start(...args); const value = result(args[0], env.binding);
        if (fault === "schema") run.output = JSON.stringify({ ...value, extra: true });
        if (fault === "citation") { value.citations[0]!.quote = "伪造来源"; run.output = JSON.stringify(value); }
        if (fault === "logs") run.output = `log line\n${String(run.output)}`;
        if (fault === "truncated") run.completeOutput = false;
        if (fault === "binding") run.requestFileSha256 = cqaSha256("another request");
        return run;
      };
      await consumer.advance(runtime.port);
      assert.equal(consumer.snapshot().responses.length, 0);
      assert.equal(consumer.snapshot().operations[0]!.candidate, undefined);
      assert.equal(runtime.counts().starts, 1, "post-Start validation cannot claim zero physical calls");
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("corrupted input and drifted control binding fail before Start without replacing the file", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    const accepted = consumer.accept(input(env.binding));
    await assert.rejects(consumer.advance({ ...runtime.port, bindingDigest: cqaSha256("wrong-control") }), /PORT_BINDING_MISMATCH/);
    assert.equal(existsSync(env.binding.inputRoot), false);
    prepareCqaInput(accepted.frozen.input, accepted.frozen.requestBytes);
    chmodSync(accepted.frozen.input.file, 0o600); writeFileSync(accepted.frozen.input.file, "conflict"); chmodSync(accepted.frozen.input.file, 0o400);
    assert.equal(await consumer.advance(runtime.port), "accepted");
    assert.equal(readFileSync(accepted.frozen.input.file, "utf8"), "conflict");
    assert.equal(runtime.counts().starts, 0);
  } finally { consumer.close(); env.cleanup(); }
});

test("foreign R003/R004 schemas, symlinks, corrupt state and changed binding are refused without migration", () => {
  const env = environment();
  try {
    for (const name of ["r003_authority", "r004_dialogue"]) {
      const path = join(env.directory, `${name}.sqlite`); const database = new DatabaseSync(path);
      database.exec(`CREATE TABLE ${name} (id INTEGER PRIMARY KEY)`); database.close(); chmodSync(path, 0o600);
      const before = readFileSync(path);
      assert.throws(() => new R005CqaConsumer(path, env.binding), /FOREIGN_SCHEMA/);
      assert.deepEqual(readFileSync(path), before); assert.equal(existsSync(`${path}-wal`), false);
    }
    const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); consumer.accept(input(env.binding)); consumer.close();
    const alias = join(env.directory, "alias.sqlite"); symlinkSync(env.path, alias);
    assert.throws(() => new R005CqaConsumer(alias, env.binding), /FILE_UNSAFE/);
    assert.throws(() => new R005CqaConsumer(env.path, { ...env.binding, binarySha256: cqaSha256("new-same-version") }), /BINDING_DRIFT/);
    const database = new DatabaseSync(env.path); database.exec("UPDATE r005_cqa SET digest='corrupt'"); database.close();
    assert.throws(() => new R005CqaConsumer(env.path, env.binding), /STATE_INVALID/);
  } finally { env.cleanup(); }
});

test("int64 usage is persisted losslessly once; malformed optional usage retains content, model mismatch does not", async () => {
  for (const usage of ["large", "invalid", "mismatch"] as const) {
    const env = environment(); env.binding.generationMode = "llm"; env.binding.provider = "grok"; env.binding.model = "test-model";
    const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => {
        const run = await start(...args); const value = { ...result(args[0], env.binding), status: "DRAFT_READY" };
        const tokenUsage = usage === "large" ? '{"status":"reported","provider":"grok","model":"test-model","inputTokens":9007199254740993,"outputTokens":0,"totalTokens":9223372036854775807}'
          : usage === "invalid" ? '{"status":"reported","inputTokens":-1}' : '{"status":"unknown","provider":"wrong-provider"}';
        run.output = `${JSON.stringify(value).slice(0, -1)},"tokenUsage":${tokenUsage}}`; return run;
      };
      await consumer.advance(runtime.port);
      if (usage === "mismatch") { assert.equal(consumer.snapshot().responses.length, 0); continue; }
      const candidate = consumer.snapshot().operations[0]!.candidate!;
      assert.equal(candidate.usage.status, usage === "large" ? "reported" : "unknown");
      if (usage === "large") assert.equal(candidate.usage.inputTokens, "9007199254740993");
      consumer.collect("operation-1", runtime.runs[0]!);
      assert.deepEqual(consumer.snapshot().operations[0]!.candidate?.usage, candidate.usage);
      assert.equal(consumer.snapshot().responses.length, 1);
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("insufficient evidence and review results project unresolved Case outcomes, not compliance success", async () => {
  for (const status of ["INSUFFICIENT_EVIDENCE", "NEEDS_REVIEW"] as const) {
    const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => {
        const run = await start(...args);
        run.output = JSON.stringify({ ...result(args[0], env.binding), status, claims: [], citations: [],
          reasonCodes: [status === "INSUFFICIENT_EVIDENCE" ? "NO_ELIGIBLE_EVIDENCE" : "OVERLAPPING_SOURCE_VERSIONS"] }); return run;
      };
      assert.equal(await consumer.advance(runtime.port), "complete");
      assert.equal(consumer.snapshot().activeCase?.outcome, status === "INSUFFICIENT_EVIDENCE" ? "needs_input" : "needs_review");
      assert.equal(consumer.snapshot().activeCase?.state, "active");
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("platform canceled remains UNKNOWN and cannot release the unresolved Case", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { const run = await start(...args); run.status = "canceled"; return run; };
    assert.equal(await consumer.advance(runtime.port), "unknown");
    assert.equal(consumer.snapshot().operations[0]!.terminal, "canceled");
    assert.equal(consumer.snapshot().operations[0]!.candidate, undefined);
    assert.throws(() => consumer.closeCase(), /UNRESOLVED/);
    await consumer.advance(runtime.port);
    assert.equal(runtime.counts().starts, 1);
    assert.equal(consumer.snapshot().operations[0]!.state, "unknown");
  } finally { consumer.close(); env.cleanup(); }
});

test("cancel at the durable submission checkpoint cannot enter a deferred port call", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding));
    const pending = consumer.advance(runtime.port);
    consumer.requestCancel("operation-1");
    assert.equal(await pending, "unknown");
    assert.equal(runtime.counts().starts, 0);
    assert.equal(consumer.snapshot().responses.length, 0);
  } finally { consumer.close(); env.cleanup(); }
});

test("cancel with a lost Run ID sends StopRun on the next advance after unique lookup even when collection expires the result", async () => {
  for (const status of ["running", "succeeded"] as const) {
    const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
    try {
      consumer.accept(input(env.binding)); const start = runtime.port.start;
      runtime.port.start = async (...args) => { const run = await start(...args); run.status = status; throw new Error("lost Run ID"); };
      assert.equal(await consumer.advance(runtime.port), "unknown");
      consumer.requestCancel("operation-1");
      consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
      await consumer.advance(runtime.port);
      assert.deepEqual(runtime.counts(), { starts: 1, lookups: 1, cancels: 0 });
      await consumer.advance(runtime.port);
      assert.deepEqual(runtime.counts(), { starts: 1, lookups: 1, cancels: 1 });
      const operation = consumer.snapshot().operations[0]!;
      assert.equal(operation.runId, runtime.runs[0]!.runId);
      assert.equal(operation.cancelAcknowledged, true);
      assert.equal(operation.state, status === "running" ? "unknown" : "expired");
      assert.equal(consumer.snapshot().responses.length, 0);
      await consumer.advance(runtime.port);
      assert.equal(runtime.counts().cancels, 1);
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("pending cancellation survives restart after result collection changes the operation state", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock); const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding)); const start = runtime.port.start;
    runtime.port.start = async (...args) => { await start(...args); throw new Error("lost Run ID"); };
    await consumer.advance(runtime.port);
    consumer.requestCancel("operation-1");
    assert.equal(consumer.collect("operation-1", runtime.runs[0]!), "expired");
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    await consumer.advance(runtime.port);
    assert.equal(runtime.counts().cancels, 1);
    assert.equal(runtime.counts().starts, 1);
    assert.equal(consumer.snapshot().responses.length, 0);
    await consumer.advance(runtime.port);
    assert.equal(runtime.counts().cancels, 1);
  } finally { consumer.close(); env.cleanup(); }
});

test("Start and List summaries persist only a pending identity; restart separates discovery from Get", async () => {
  for (const receipt of ["start-summary", "lost-start"] as const) {
    const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    const runtime = counting(env.binding); const calls: string[] = [];
    const port: CqaRunPort = { ...runtime.port,
      start: async (...args) => {
        const run = await runtime.port.start(...args);
        if (receipt === "lost-start") throw new Error("receipt lost");
        return { pendingRunId: run.runId };
      },
      lookup: async (query, signal) => {
        calls.push(query.runId === undefined ? "List" : "Get");
        assert.equal(query.operation.operationId, query.operationId);
        const found = await runtime.port.lookup(query, signal);
        return query.runId === undefined ? { total: 1, runs: [], pendingRunId: found.runs[0]!.runId } : found;
      },
    };
    try {
      consumer.accept(input(env.binding));
      assert.equal(await consumer.advance(port), "unknown");
      if (receipt === "lost-start") {
        assert.equal(await consumer.advance(port), "unknown");
        assert.deepEqual(calls, ["List"]);
      }
      const pending = consumer.snapshot().operations[0]!;
      assert.equal(pending.pendingRunId, runtime.runs[0]!.runId); assert.equal(pending.runId, undefined);
      consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
      if (receipt === "lost-start") {
        await consumer.advance(port); assert.deepEqual(calls, ["List"]);
        env.tick(5000);
      }
      assert.equal(await consumer.advance(port), "complete");
      assert.deepEqual(calls, receipt === "lost-start" ? ["List", "Get"] : ["Get"]);
      assert.equal(consumer.snapshot().operations[0]!.pendingRunId, undefined);
      assert.equal(consumer.snapshot().responses.length, 1);
      assert.equal(runtime.counts().starts, 1);
    } finally { consumer.close(); env.cleanup(); }
  }
});

test("failed physical queries consume durable budget and a sixth List summary cannot trigger a seventh Get", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding); let queries = 0;
  const port: CqaRunPort = { ...runtime.port,
    start: async (...args) => { await runtime.port.start(...args); throw new Error("receipt lost"); },
    lookup: async query => {
      queries++; assert.equal(query.runId, undefined);
      if (queries < 6) throw new Error("read unavailable");
      return { total: 1, runs: [], pendingRunId: runtime.runs[0]!.runId };
    },
  };
  try {
    consumer.accept(input(env.binding)); await consumer.advance(port);
    for (let i = 0; i < 6; i++) {
      if (i > 0) env.tick(5000);
      assert.equal(await consumer.advance(port), "unknown");
      assert.equal(consumer.snapshot().operations[0]!.queries, i + 1);
      if (i === 2) { consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock); }
    }
    assert.equal(consumer.snapshot().operations[0]!.pendingRunId, runtime.runs[0]!.runId);
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    await consumer.advance(port); env.tick(5000); await consumer.advance(port);
    assert.equal(queries, 6); assert.equal(runtime.counts().starts, 1);
    assert.equal(consumer.snapshot().operations[0]!.runId, undefined);
    assert.equal(consumer.snapshot().responses.length, 0);
  } finally { consumer.close(); env.cleanup(); }
});

test("a pending hint cannot authorize cancellation or replace the original identity", async () => {
  const env = environment(); const consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding); let queries = 0;
  const port: CqaRunPort = { ...runtime.port,
    start: async (...args) => ({ pendingRunId: (await runtime.port.start(...args)).runId }),
    lookup: async (query, signal) => {
      queries++;
      if (queries === 1) return { total: 1, runs: [], pendingRunId: "foreign-run" };
      return runtime.port.lookup(query, signal);
    },
  };
  try {
    consumer.accept(input(env.binding)); await consumer.advance(port); consumer.requestCancel("operation-1");
    await consumer.advance(port);
    assert.equal(consumer.snapshot().operations[0]!.pendingRunId, runtime.runs[0]!.runId);
    assert.equal(consumer.snapshot().operations[0]!.runId, undefined);
    assert.equal(runtime.counts().cancels, 0);
    env.tick(5000); await consumer.advance(port);
    assert.equal(runtime.counts().cancels, 0);
    assert.equal(consumer.snapshot().operations[0]!.runId, runtime.runs[0]!.runId);
    await consumer.advance(port); assert.equal(runtime.counts().cancels, 1);
    assert.equal(consumer.snapshot().responses.length, 0);
  } finally { consumer.close(); env.cleanup(); }
});

test("managed grants reject offline scope and missing run proof retains known identity for cancellation", async () => {
  const env = managedEnvironment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding);
  try {
    const offlineGrant = input(env.binding); offlineGrant.grant.outboundScope = "offline-only";
    assert.throws(() => consumer.accept(offlineGrant), /GRANT_MISMATCH/);
    assert.equal(consumer.snapshot().operations.length, 0);
    consumer.accept(input(env.binding));
    await assert.rejects(consumer.advance({ ...runtime.port, mode: "offline" }), /PORT_BINDING_MISMATCH/);
    const start = runtime.port.start;
    runtime.port.start = async (...args) => {
      const run = await start(...args);
      delete run.binarySha256; delete run.guestImageSha256; delete run.requestFileSha256; delete run.volume;
      run.completeOutput = false; delete run.output; return run;
    };
    assert.equal(await consumer.advance(runtime.port), "unknown");
    const operation = consumer.snapshot().operations[0]!;
    assert.equal(operation.runId, runtime.runs[0]!.runId);
    assert.equal(operation.terminal, undefined); assert.equal(operation.candidate, undefined);
    consumer.requestCancel("operation-1");
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(await consumer.advance(runtime.port), "unknown");
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 0, cancels: 1 });
    assert.equal(consumer.snapshot().responses.length, 0);
  } finally { consumer.close(); env.cleanup(); }
});

test("local preflight rejection remains safely accepted across restart with zero Start calls", async () => {
  const env = environment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding); let preflights = 0;
  const port: CqaRunPort = { ...runtime.port, preflight: operation => {
    preflights++; verifyCqaInput(operation.input, operation.requestBytes);
    assert.equal(consumer.snapshot().operations[0]!.state, "accepted");
    throw new Error("deployment evidence missing");
  } };
  try {
    const accepted = consumer.accept(input(env.binding));
    assert.equal(await consumer.advance(port), "accepted");
    assert.equal(runtime.counts().starts, 0);
    assert.equal(consumer.snapshot().audit.some(item => item.code === "MAYBE_SUBMITTED"), false);
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    assert.equal(await consumer.advance(port), "accepted");
    assert.equal(preflights, 2); assert.equal(runtime.counts().starts, 0);
    assert.equal(readFileSync(accepted.frozen.input.file, "utf8"), accepted.frozen.requestBytes);
    assert.equal(await consumer.advance(runtime.port), "complete");
    assert.equal(runtime.counts().starts, 1);
  } finally { consumer.close(); env.cleanup(); }
});

test("pre-chat version 2 state is refused read-only without migration", () => {
  const env = environment();
  try {
    const consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    const state = { ...consumer.snapshot(), version: 2 }; consumer.close();
    const database = new DatabaseSync(env.path); const body = JSON.stringify(state);
    database.prepare("UPDATE r005_cqa SET body=?,digest=?").run(body, cqaSha256(body)); database.close();
    const walPath = `${env.path}-wal`;
    assert.equal(existsSync(walPath), false, "fixture must have no pending WAL before rejection");
    const before = readFileSync(env.path);
    assert.throws(() => new R005CqaConsumer(env.path, env.binding, env.clock), /STATE_OR_BINDING_DRIFT/);
    assert.deepEqual(readFileSync(env.path), before);
    const walBytes = existsSync(walPath) ? readFileSync(walPath).byteLength : 0;
    // A WAL has a 32-byte header; rejection must not append even an uncommitted frame.
    assert.ok(walBytes <= 32, "legacy rejection must not append a WAL frame");
  } finally { env.cleanup(); }
});

test("wrong managed deployment proof cannot commit across restart and normal waiting", async () => {
  const env = managedEnvironment(); let consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
  const runtime = counting(env.binding);
  try {
    consumer.accept(input(env.binding));
    assert.equal(await consumer.advance(runtime.port), "unknown");
    const run = runtime.runs[0]!;
    run.deploymentSha256 = cqaSha256("wrong-deployment"); run.observationSha256 = cqaSha256("observed-record");
    assert.equal(await consumer.advance(runtime.port), "unknown");
    assert.equal(consumer.snapshot().operations[0]!.terminal, undefined);
    assert.equal(consumer.snapshot().responses.length, 0);
    consumer.close(); consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    env.tick(30_000);
    assert.equal(await consumer.advance(runtime.port), "unknown");
    assert.equal(consumer.snapshot().operations[0]!.runId, run.runId);
    assert.equal(consumer.snapshot().operations[0]!.candidate, undefined);
    assert.equal(consumer.snapshot().responses.length, 0);
    assert.deepEqual(runtime.counts(), { starts: 1, lookups: 2, cancels: 0 });
  } finally { consumer.close(); env.cleanup(); }
});

test("managed pins, endpoint origin and canonical roots fail closed before database creation", () => {
  const changes: ((binding: CqaBinding) => void)[] = [
    binding => { binding.binarySha256 = cqaSha256("new-binary"); },
    binding => { binding.managed!.daemonSha256 = cqaSha256("new-daemon"); },
    binding => { binding.runtime.sourceRevision = "new-platform"; },
    binding => { binding.guestImageSha256 = cqaSha256("new-image"); },
    binding => { binding.managed!.platformManifestSha256 = cqaSha256("new-manifest"); },
    binding => { binding.corpus = corpus; binding.corpusDigest = cqaCorpusDigest(corpus); },
    binding => { binding.provider = "other-provider"; },
    binding => { binding.model = "other-model"; },
    binding => { binding.runtime.source = "other-source"; },
    binding => { binding.runtime.command[0] = "/opt/cqa/other-agent"; },
    binding => { binding.runtime.endpoint = "https://user:password@cqa.invalid"; },
    binding => { binding.runtime.endpoint = "https://cqa.invalid/path"; },
    binding => { binding.runtime.endpoint = "https://cqa.invalid?redirect=elsewhere"; },
    binding => { binding.runtime.endpoint = "http://cqa.invalid"; },
    binding => { binding.managed!.evidenceRoot = "/evidence/../other"; },
    binding => { binding.managed!.daemonInputRoot = "relative"; },
    binding => { binding.managed!.engineInputRoot = "/"; },
  ];
  for (const change of changes) {
    const env = managedEnvironment();
    try {
      change(env.binding);
      assert.throws(() => new R005CqaConsumer(env.path, env.binding, env.clock));
      assert.equal(existsSync(env.path), false);
    } finally { env.cleanup(); }
  }
});

test("omitted and undefined optional binding fields preserve operation identity across restart", () => {
  const env = environment();
  try {
    Reflect.set(env.binding.runtime, "sandboxId", undefined);
    const consumer = new R005CqaConsumer(env.path, env.binding, env.clock);
    let fingerprint: string;
    try { fingerprint = consumer.accept(input(env.binding)).fingerprint; }
    finally { consumer.close(); }
    Reflect.deleteProperty(env.binding.runtime, "sandboxId");
    const reopened = new R005CqaConsumer(env.path, env.binding, env.clock);
    try {
      assert.equal(reopened.accept(input(env.binding)).fingerprint, fingerprint);
      assert.equal(reopened.snapshot().operations.length, 1);
    }
    finally { reopened.close(); }
  } finally { env.cleanup(); }
});
