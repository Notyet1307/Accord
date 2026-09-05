import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { deriveSourceId, generateR003ResearcherAnalystHandoff, type PreparedAttempt, type PreparedProfileInvocation } from "../../src/index.js";
import { commitProviderResult, reconstructPreparedProfileInvocation } from "../../src/researcher-analyst.js";
import type { GenericEntryType, InvocationBoundOutputContract } from "../../src/profile-runtime.js";
import { readFixedProfileContext } from "../../src/profile-context.js";
import { MagicChatProtocolAdapter } from "../../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { magicChatAckSuccessResponse, magicChatMessageCreatedEnvelope, magicChatMessageSendSuccessResponse, temporaryDatabase } from "../fixture.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const digest = (value: string): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });

function researcherResult(invocation: PreparedProfileInvocation): string {
  const observation = invocation.entries.find((entry) => entry.type === "Observation");
  assert.ok(observation);
  return JSON.stringify({ providerMetadata: metadata("r003-o02-researcher"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}

function analystResult(invocation: PreparedProfileInvocation): string {
  const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef");
  assert.ok(evidence);
  return JSON.stringify({ providerMetadata: metadata("r003-o02-analyst"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
}

function genericWire(text: string, requestId: string): string {
  return JSON.stringify({ providerMetadata: metadata(requestId), output: { text }, receivedAt: "2026-08-26T00:01:07.000Z", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } });
}

function genericContract(invocation: PreparedProfileInvocation, entryType: GenericEntryType = "Critique", invalid = false, assertFrozen = false): InvocationBoundOutputContract {
  if (invocation.profile !== "REVIEWER" && invocation.profile !== "WRITER") throw new Error("generic contract requires a generic Invocation");
  return Object.freeze({
    invocationId: invocation.invocationId,
    contextDigest: invocation.contextDigest,
    profile: invocation.profile,
    profileVersion: invocation.profileVersion,
    outputSchema: invocation.outputSchema,
    materialize(context: Readonly<PreparedProfileInvocation>, output: unknown) {
      if (assertFrozen) {
        assert.equal(Object.isFrozen(context), true);
        assert.equal(Object.isFrozen(context.entries), true);
        assert.equal(Object.isFrozen(output), true);
        assert.throws(() => { Object.defineProperty(context, "objective", { value: "mutated" }); });
        assert.throws(() => { Object.defineProperty(output, "text", { value: "mutated" }); });
      }
      if (invalid) return { boardEntries: [] };
      const reference = context.entries[0];
      if (reference === undefined) throw new Error("generic Context must contain a Board entry");
      const textValue = output !== null && typeof output === "object" && !Array.isArray(output) && "text" in output ? output.text : undefined;
      const text = typeof textValue === "string" ? textValue : "missing";
      return { boardEntries: [{ basedOn: [reference.id], entryType, payload: { text }, sourceRefs: [] }], handoff: { kind: `${context.profile.toLowerCase()}-handoff`, payload: { text }, version: "v1" } };
    },
  });
}

function reviewerFixture() {
  const temporary = temporaryDatabase("r003-c1-o02");
  const authority = openAuthorityDatabase(temporary.path);
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
  assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z");
  assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: "event-o02-reply", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "message-o02-reply", messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
  const caseId = resumed.snapshot.caseId;
  const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  const researcherWinner = authority.commitProviderResult(researcher, authority.beginPreparedAttempt(researcher.invocationId, "2026-08-26T00:01:02.000Z"), researcherResult(researcher));
  assert.equal(researcherWinner.outcome, "WINNER");
  const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
  const analystWinner = authority.commitProviderResult(analyst, authority.beginPreparedAttempt(analyst.invocationId, "2026-08-26T00:01:04.000Z"), analystResult(analyst));
  assert.equal(analystWinner.outcome, "WINNER");
  const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
  return { analyst, analystWinner, authority, caseId, researcher, researcherWinner, reviewer, temporary };
}

function rawCommit(path: string, invocation: PreparedProfileInvocation, attempt: PreparedAttempt, value: string, contract: InvocationBoundOutputContract, at: string) {
  const database = new DatabaseSync(path);
  try { return commitProviderResult(database, invocation, attempt, value, at, contract); }
  finally { database.close(); }
}
function assertPhysicalProvenance(path: string, invocation: PreparedProfileInvocation): void {
  const database = new DatabaseSync(path);
  try {
    const expected = database.prepare("SELECT count(*) AS count FROM runtime_result_arrivals WHERE invocation_id = ? AND outcome <> 'UNKNOWN'").get(invocation.invocationId) as Record<string, unknown>;
    const rows = database.prepare(`SELECT arrival.arrival_id, arrival.response_id, arrival.result_id, delivery.delivery_id,
      count(DISTINCT link.delivery_id) AS deliveries, count(DISTINCT response.response_id) AS responses, count(DISTINCT result.result_id) AS results
      FROM runtime_result_arrivals arrival
      LEFT JOIN runtime_delivery_arrivals link ON link.arrival_id = arrival.arrival_id
      LEFT JOIN runtime_provider_deliveries delivery ON delivery.delivery_id = link.delivery_id AND delivery.response_id = arrival.response_id
      LEFT JOIN runtime_physical_responses response ON response.response_id = arrival.response_id AND response.invocation_id = arrival.invocation_id AND response.attempt_id = arrival.attempt_id
      LEFT JOIN runtime_results result ON result.result_id = arrival.result_id AND result.invocation_id = arrival.invocation_id AND result.attempt_id = arrival.attempt_id
      WHERE arrival.invocation_id = ? AND arrival.outcome <> 'UNKNOWN' GROUP BY arrival.arrival_id`).all(invocation.invocationId) as readonly Record<string, unknown>[];
    assert.equal(rows.length, expected["count"]); assert.equal(new Set(rows.map((row) => row["delivery_id"])).size, rows.length);
    for (const row of rows) { assert.equal(typeof row["response_id"], "string"); assert.equal(typeof row["result_id"], "string"); assert.deepEqual([row["deliveries"], row["responses"], row["results"]], [1, 1, 1]); }
  } finally { database.close(); }
}

test("O02 four-fixed-profiles binds one exact Context per sequential Profile", async () => {
  const fixture = reviewerFixture();
  try {
    openAuthorityDatabase(fixture.temporary.path).close(); // generic READY reconstructs without mutation
    let calls = 0;
    const reviewerOutcome = await fixture.authority.executePreparedAttempt(fixture.reviewer, { outputContract: genericContract(fixture.reviewer, "Critique", false, true), complete(request) { calls += 1; assert.equal(request.retry, "DISABLED"); return genericWire("Reviewer critique", "o02-reviewer"); } }, "2026-08-26T00:01:06.000Z");
    if (reviewerOutcome.outcome !== "WINNER" || reviewerOutcome.materialization === undefined) throw new Error("Reviewer must win with a materialization");
    const writer = fixture.authority.prepareProfileInvocation({ caseId: fixture.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:08.000Z", profile: "WRITER" });
    const invocations = [fixture.researcher, fixture.analyst, fixture.reviewer, writer];
    assert.deepEqual(invocations.map((item) => item.profile), ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"]);
    assert.equal(new Set(invocations.map((item) => item.invocationId)).size, 4);
    assert.equal(new Set(invocations.map((item) => item.contextId)).size, 4);
    assert.equal(invocations.every((item) => item.caseId === fixture.caseId && item.boardId === fixture.reviewer.boardId && item.workflowRunId === fixture.reviewer.workflowRunId), true);
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      for (const invocation of invocations) assert.deepEqual(reconstructPreparedProfileInvocation(database, invocation.invocationId), invocation);
      for (const invocation of [fixture.reviewer, writer]) assert.equal(readFixedProfileContext(database, invocation.invocationId)?.contextId, invocation.contextId);
      assert.equal((database.prepare("SELECT count(*) AS count FROM board_entries WHERE case_id = ? AND author_id = 'WRITER'").get(fixture.caseId) as Record<string, unknown>)["count"], 0);
    } finally { database.close(); }
    openAuthorityDatabase(fixture.temporary.path).close(); // Reviewer WINNER plus Writer READY
    assertPhysicalProvenance(fixture.temporary.path, fixture.reviewer);
    assert.equal(calls, 1); assert.equal(reviewerOutcome.materialization.handoff?.boardEntries.length, 1);
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O02 duplicate-attempt retains one generic winner and one audit-only duplicate", () => {
  const fixture = reviewerFixture();
  try {
    const attempt = fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    const contract = genericContract(fixture.reviewer);
    const value = genericWire("same reviewer result", "o02-duplicate");
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, attempt, value, contract, "2026-08-26T00:01:07.000Z").outcome, "WINNER");
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, attempt, value, contract, "2026-08-26T00:01:08.000Z").outcome, "DUPLICATE");
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const outcomes = database.prepare("SELECT outcome FROM runtime_result_arrivals WHERE invocation_id = ? ORDER BY arrival_number").all(fixture.reviewer.invocationId) as readonly Record<string, unknown>[];
      const entries = database.prepare("SELECT count(*) AS count FROM runtime_result_entries WHERE result_id IN (SELECT result_id FROM runtime_results WHERE invocation_id = ?)").get(fixture.reviewer.invocationId) as Record<string, unknown>;
      assert.deepEqual(outcomes.map((row) => row["outcome"]), ["WINNER", "DUPLICATE"]);
      assert.equal(entries["count"], 1);
      const resolutions = database.prepare("SELECT event_kind FROM audit_events WHERE correlation_id = (SELECT correlation_id FROM audit_events WHERE event_kind LIKE 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:%' LIMIT 1) AND event_kind LIKE 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:%' ORDER BY event_kind").all() as readonly Record<string, unknown>[];
      assert.equal(resolutions.length, 2); assert.equal(new Set(resolutions.map((row) => row["event_kind"])).size, 2);
    } finally { database.close(); }
    assertPhysicalProvenance(fixture.temporary.path, fixture.reviewer); openAuthorityDatabase(fixture.temporary.path).close();
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O02 divergent-attempt retains a generic divergent arrival without Board mutation", () => {
  const fixture = reviewerFixture();
  try {
    const attempt = fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    const contract = genericContract(fixture.reviewer);
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, attempt, genericWire("first reviewer result", "o02-divergent-one"), contract, "2026-08-26T00:01:07.000Z").outcome, "WINNER");
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, attempt, genericWire("changed reviewer result", "o02-divergent-two"), contract, "2026-08-26T00:01:08.000Z").outcome, "DIVERGENT");
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const outcomes = database.prepare("SELECT outcome FROM runtime_result_arrivals WHERE invocation_id = ? ORDER BY arrival_number").all(fixture.reviewer.invocationId) as readonly Record<string, unknown>[];
      const entries = database.prepare("SELECT count(*) AS count FROM board_entries WHERE author_id = 'REVIEWER' AND case_id = ?").get(fixture.caseId) as Record<string, unknown>;
      assert.deepEqual(outcomes.map((row) => row["outcome"]), ["WINNER", "DIVERGENT"]);
      assert.equal(entries["count"], 1);
    } finally { database.close(); }
    assertPhysicalProvenance(fixture.temporary.path, fixture.reviewer);
    fixture.authority.close();
    const tampered = new DatabaseSync(fixture.temporary.path); const resolution = tampered.prepare("SELECT audit_event_id, details_json FROM audit_events WHERE event_kind LIKE 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:%' LIMIT 1").get() as Record<string, unknown>;
    const originalDetails = String(resolution["details_json"]); const rejected = JSON.parse(originalDetails) as Record<string, unknown>; rejected["accepted"] = false; delete rejected["candidate"];
    tampered.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify(rejected), String(resolution["audit_event_id"])); tampered.close();
    assert.throws(() => openAuthorityDatabase(fixture.temporary.path), /resolution does not match its Arrival disposition/);
    const orphaned = new DatabaseSync(fixture.temporary.path); orphaned.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(originalDetails, String(resolution["audit_event_id"]));
    orphaned.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at)
      SELECT ?, schema_version, correlation_id, 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:orphan:99', case_id, board_id, workflow_run_id, NULL, details_json, recorded_at FROM audit_events WHERE audit_event_id = ?`).run(`audit_${"f".repeat(64)}`, String(resolution["audit_event_id"])); orphaned.close();
    assert.throws(() => openAuthorityDatabase(fixture.temporary.path), /resolution audit is orphaned/);
  } finally { try { fixture.authority.close(); } catch {} fixture.temporary.cleanup(); }
});

test("O02 late-attempt keeps a schema-valid generic arrival audit-only", () => {
  const fixture = reviewerFixture();
  try {
    const first = fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    assert.throws(() => fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:06.500Z"), /no claimable Attempt/);
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, first, genericWire("invalid candidate", "o02-invalid"), genericContract(fixture.reviewer, "Critique", true), "2026-08-26T00:01:07.000Z").outcome, "INVALID");
    openAuthorityDatabase(fixture.temporary.path).close(); // INVALID reconstructs before Attempt 2
    const second = fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:08.000Z");
    assert.equal(second.attemptNumber, 2);
    const contract = genericContract(fixture.reviewer);
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, first, genericWire("late candidate", "o02-late"), contract, "2026-08-26T00:01:09.000Z").outcome, "LATE");
    assert.equal(rawCommit(fixture.temporary.path, fixture.reviewer, second, genericWire("fresh candidate", "o02-fresh"), contract, "2026-08-26T00:01:10.000Z").outcome, "WINNER");
    assert.throws(() => fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:11.000Z"), /terminal/);
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const outcomes = database.prepare("SELECT outcome FROM runtime_result_arrivals WHERE invocation_id = ? ORDER BY recorded_at, arrival_number").all(fixture.reviewer.invocationId) as readonly Record<string, unknown>[];
      assert.deepEqual(outcomes.map((row) => row["outcome"]), ["INVALID", "LATE", "WINNER"]);
    } finally { database.close(); }
    assertPhysicalProvenance(fixture.temporary.path, fixture.reviewer); openAuthorityDatabase(fixture.temporary.path).close();
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O02 unknown-attempt records no fictional generic physical response or retry", () => {
  const fixture = reviewerFixture();
  try {
    const attempt = fixture.authority.beginPreparedAttempt(fixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    assert.equal(attempt.attemptNumber, 1); fixture.authority.close();
    openAuthorityDatabase(fixture.temporary.path).close(); // RUNNING becomes UNKNOWN
    openAuthorityDatabase(fixture.temporary.path).close(); // UNKNOWN is idempotently reconstructible
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const arrival = database.prepare("SELECT outcome, response_id, result_id FROM runtime_result_arrivals WHERE invocation_id = ?").get(fixture.reviewer.invocationId) as Record<string, unknown>;
      const physical = database.prepare("SELECT count(*) AS count FROM runtime_physical_responses WHERE invocation_id = ?").get(fixture.reviewer.invocationId) as Record<string, unknown>;
      const attempts = database.prepare("SELECT count(*) AS count FROM runtime_attempts WHERE invocation_id = ?").get(fixture.reviewer.invocationId) as Record<string, unknown>;
      assert.deepEqual([arrival["outcome"], arrival["response_id"], arrival["result_id"]], ["UNKNOWN", null, null]); assert.equal(physical["count"], 0); assert.equal(attempts["count"], 1);
    } finally { database.close(); }
  } finally { try { fixture.authority.close(); } catch {} fixture.temporary.cleanup(); }
});

test("O02 researcher-analyst-regression preserves the accepted winner handoff", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const handoff = generateR003ResearcherAnalystHandoff(database, fixture.caseId);
      const proposal = database.prepare("SELECT content_digest FROM board_entries WHERE board_entry_id = ?").get(handoff.reviewerTarget.proposalId) as Record<string, unknown>;
      assert.equal(handoff.pipelines.researcher.winner.result_id, fixture.researcherWinner.resultId);
      assert.equal(handoff.pipelines.analyst.winner.result_id, fixture.analystWinner.resultId);
      assert.equal(handoff.reviewerTarget.proposalDigest, proposal["content_digest"]);
      assert.deepEqual(generateR003ResearcherAnalystHandoff(database, fixture.caseId), handoff);
      assertPhysicalProvenance(fixture.temporary.path, fixture.researcher); assertPhysicalProvenance(fixture.temporary.path, fixture.analyst);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});
