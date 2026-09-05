import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PROFILE_CONTEXT_REQUEST_VERSION,
  type ProfileContextDecision,
} from "../src/contracts/profile-context.js";
import {
  REVIEWER_DISPOSITION_HANDOFF_VERSION,
  type ReviewerDispositionOutput,
  type ReviewerTargetRef,
} from "../src/contracts/reviewer-disposition.js";
import { generateR003ResearcherAnalystHandoff, type ReviewerHandoffTarget } from "../src/contracts/researcher-analyst-handoff.js";
import { deriveSourceId, type CaseId } from "../src/core/ids.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { openAuthorityDatabase, type AuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import type { InvocationBoundOutputContract } from "../src/profile-runtime.js";
import { createReviewerDispositionContract, parseReviewerDispositionHandoff } from "../src/reviewer-disposition.js";
import {
  commitProviderResult,
  reconstructGenericWinnerMaterialization,
  reconstructPreparedProfileInvocation,
  type PreparedAttempt,
  type PreparedProfileInvocation,
} from "../src/researcher-analyst.js";
import { decideProfileContextAccess } from "../src/reviewer-context.js";
import {
  magicChatAckSuccessResponse,
  magicChatMessageCreatedEnvelope,
  magicChatMessageSendSuccessResponse,
  temporaryDatabase,
  type TemporaryDatabase,
} from "./fixture.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const digest = (value: string): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });
type Row = Record<string, unknown>;
type ReviewerFixture = Readonly<{
  authority: AuthorityDatabase;
  caseId: CaseId;
  decision: ProfileContextDecision;
  reviewer: PreparedProfileInvocation;
  target: ReviewerHandoffTarget;
  temporary: TemporaryDatabase;
}>;


function researcherWire(invocation: PreparedProfileInvocation): string {
  const observation = invocation.entries.find((entry) => entry.type === "Observation");
  assert.ok(observation);
  return JSON.stringify({ providerMetadata: metadata("c04-researcher"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}
function analystWire(invocation: PreparedProfileInvocation): string {
  const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef");
  assert.ok(evidence);
  return JSON.stringify({ providerMetadata: metadata("c04-analyst"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
}
function reviewerOutput(target: ReviewerHandoffTarget, rationale = "The target is unsupported."): ReviewerDispositionOutput {
  const reference: ReviewerTargetRef = { entryId: target.proposalId, type: "Proposal", digest: target.proposalDigest };
  return { critique: { target: reference, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale }, verificationResult: { target: reference, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale } };
}
function reviewerWire(output: unknown, requestId: string): string {
  return JSON.stringify({ providerMetadata: metadata(requestId), output, receivedAt: "2026-08-26T00:01:07.000Z", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } });
}


function reviewerFixture(label: string) {
  const temporary = temporaryDatabase(label);
  const authority = openAuthorityDatabase(temporary.path);
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
  assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z");
  assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: `event-${label}`, messageCreatedAt: "2026-08-26T00:01:00Z", messageId: `message-${label}`, messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
  const caseId = resumed.snapshot.caseId;
  const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  assert.equal(authority.commitProviderResult(researcher, authority.beginPreparedAttempt(researcher.invocationId, "2026-08-26T00:01:02.000Z"), researcherWire(researcher)).outcome, "WINNER");
  const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
  assert.equal(authority.commitProviderResult(analyst, authority.beginPreparedAttempt(analyst.invocationId, "2026-08-26T00:01:04.000Z"), analystWire(analyst)).outcome, "WINNER");
  const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
  const database = new DatabaseSync(temporary.path);
  try {
    const target = generateR003ResearcherAnalystHandoff(database, caseId).reviewerTarget;
    const decision = decideProfileContextAccess(database, {
      schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION,
      requestId: `c04-${label}`,
      requestTime: "2026-08-26T00:02:00.000Z",
      operation: "READ_CONTEXT",
      caseId: reviewer.caseId,
      workflowRunId: reviewer.workflowRunId,
      boardId: reviewer.boardId,
      boardRevision: reviewer.boardRevision,
      workflowRevision: reviewer.workflowRevision,
      profile: "REVIEWER",
      context: { invocationId: reviewer.invocationId, contextId: reviewer.contextId, contextDigest: reviewer.contextDigest },
      target,
      requestedEntry: null,
    });
    if (decision.outcome !== "ALLOW" || decision.reason !== "CURRENT_CONTEXT" || decision.value === null || decision.value.kind !== "REVIEWER_CONTEXT") throw new Error("C03 did not provide the exact Reviewer Context");
    return { authority, caseId, decision, reviewer, target, temporary } satisfies ReviewerFixture;
  } finally { database.close(); }
}

function targetState(database: DatabaseSync, target: ReviewerHandoffTarget): Row {
  const row = database.prepare("SELECT payload_json, content_digest, based_on_json, source_refs_json, created_revision FROM board_entries WHERE board_entry_id = ?").get(target.proposalId) as Row | undefined;
  if (row === undefined) throw new Error("Reviewer target is missing");
  return row;
}
function candidateState(database: DatabaseSync, fixtureValue: ReviewerFixture): Row {
  const row = database.prepare(`SELECT b.revision AS board_revision,
    (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id AND entry.author_id = 'REVIEWER') AS reviewer_entries,
    (SELECT count(*) FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id WHERE result.invocation_id = ?) AS reviewer_result_entries,
    (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id AND entry.entry_type = 'ArtifactRef') AS artifact_refs,
    (SELECT count(*) FROM approvals approval WHERE approval.case_id = c.case_id) AS approvals,
    (SELECT count(*) FROM response_claims claim WHERE claim.case_id = c.case_id) AS response_claims,
    (SELECT count(*) FROM pending_side_effects effect WHERE effect.case_id = c.case_id) AS pending_side_effects
    FROM cases c JOIN boards b ON b.board_id = c.board_id WHERE c.case_id = ?`).get(fixtureValue.reviewer.invocationId, fixtureValue.caseId) as Row | undefined;
  if (row === undefined) throw new Error("C04 candidate state is missing");
  return row;
}
function lifecycleState(database: DatabaseSync, fixtureValue: ReviewerFixture): Row {
  const row = database.prepare("SELECT c.status AS case_status, w.state AS workflow_state, w.revision AS workflow_revision, i.status AS invocation_status FROM cases c JOIN workflow_runs w ON w.case_id = c.case_id JOIN runtime_invocations i ON i.invocation_id = ? WHERE c.case_id = ?").get(fixtureValue.reviewer.invocationId, fixtureValue.caseId) as Row | undefined;
  if (row === undefined) throw new Error("C04 lifecycle state is missing");
  return row;
}
function assertNoCandidate(database: DatabaseSync, fixtureValue: ReviewerFixture, before: Row, targetBefore: Row): void {
  assert.deepEqual(candidateState(database, fixtureValue), before);
  assert.deepEqual(targetState(database, fixtureValue.target), targetBefore);
  assert.equal(reconstructGenericWinnerMaterialization(database, fixtureValue.reviewer.invocationId), undefined);
}
function rawCommit(path: string, invocation: PreparedProfileInvocation, attempt: PreparedAttempt, wire: string, contract: InvocationBoundOutputContract, at: string) {
  const database = new DatabaseSync(path);
  try { return commitProviderResult(database, invocation, attempt, wire, at, contract); }
  finally { database.close(); }
}

test("C04 persists exact unsupported dual disposition and H1 across restart", async () => {
  const fixtureValue = reviewerFixture("c04-winner");
  let authority = fixtureValue.authority;
  try {
    const contract = createReviewerDispositionContract(fixtureValue.reviewer, fixtureValue.decision);
    const beforeDatabase = new DatabaseSync(fixtureValue.temporary.path);
    const before = candidateState(beforeDatabase, fixtureValue);
    const targetBefore = targetState(beforeDatabase, fixtureValue.target);
    beforeDatabase.close();
    const expected = reviewerOutput(fixtureValue.target);
    const outcome = await authority.executePreparedAttempt(fixtureValue.reviewer, { outputContract: contract, complete: () => reviewerWire(expected, "c04-winner") }, "2026-08-26T00:01:06.000Z");
    if (outcome.outcome !== "WINNER" || outcome.materialization === undefined) throw new Error("C04 Reviewer output did not win");
    const database = new DatabaseSync(fixtureValue.temporary.path);
    try {
      const entries = database.prepare("SELECT board_entry_id, entry_type, payload_json, based_on_json, source_refs_json, content_digest, created_revision FROM board_entries WHERE author_id = 'REVIEWER' AND case_id = ? ORDER BY created_revision, board_entry_id").all(fixtureValue.reviewer.caseId) as readonly Row[];
      assert.equal(Number(candidateState(database, fixtureValue)["board_revision"]), Number(before["board_revision"]) + 1);
      assert.deepEqual(entries.map((entry) => [entry["entry_type"], JSON.parse(String(entry["payload_json"])), JSON.parse(String(entry["based_on_json"])), JSON.parse(String(entry["source_refs_json"]))]), [
        ["Critique", expected.critique, [fixtureValue.target.proposalId], []],
        ["VerificationResult", expected.verificationResult, [fixtureValue.target.proposalId], []],
      ]);
      assert.deepEqual(targetState(database, fixtureValue.target), targetBefore);
      assert.deepEqual([candidateState(database, fixtureValue)["artifact_refs"], candidateState(database, fixtureValue)["approvals"], candidateState(database, fixtureValue)["response_claims"], candidateState(database, fixtureValue)["pending_side_effects"]], [before["artifact_refs"], before["approvals"], before["response_claims"], before["pending_side_effects"]]);
      const handoff = parseReviewerDispositionHandoff(outcome.materialization);
      assert.deepEqual({
        schemaVersion: handoff.schemaVersion,
        caseId: handoff.caseId,
        workflowRunId: handoff.workflowRunId,
        boardId: handoff.boardId,
        boardRevision: handoff.boardRevision,
        profile: handoff.profile,
        profileVersion: handoff.profileVersion,
        outputSchema: handoff.outputSchema,
        contextId: handoff.contextId,
        contextDigest: handoff.contextDigest,
        invocationId: handoff.invocationId,
        attemptId: handoff.attemptId,
        resultId: handoff.resultId,
        target: handoff.target,
        disposition: handoff.disposition,
      }, {
        schemaVersion: REVIEWER_DISPOSITION_HANDOFF_VERSION,
        caseId: fixtureValue.caseId,
        workflowRunId: fixtureValue.reviewer.workflowRunId,
        boardId: fixtureValue.reviewer.boardId,
        boardRevision: outcome.boardRevision,
        profile: "REVIEWER",
        profileVersion: fixtureValue.reviewer.profileVersion,
        outputSchema: fixtureValue.reviewer.outputSchema,
        contextId: fixtureValue.reviewer.contextId,
        contextDigest: fixtureValue.reviewer.contextDigest,
        invocationId: fixtureValue.reviewer.invocationId,
        attemptId: outcome.attemptId,
        resultId: outcome.resultId,
        target: { entryId: fixtureValue.target.proposalId, type: "Proposal", digest: fixtureValue.target.proposalDigest },
        disposition: "ISSUE_UNSUPPORTED",
      });
      assert.deepEqual([handoff.critique, handoff.verificationResult], entries.map((entry) => ({ entryId: entry["board_entry_id"], contentDigest: entry["content_digest"] })));
      const physical = database.prepare(`SELECT arrival.response_id, arrival.result_id, delivery.delivery_id, response.response_id AS physical_response_id
        FROM runtime_result_arrivals arrival JOIN runtime_delivery_arrivals linked ON linked.arrival_id = arrival.arrival_id
        JOIN runtime_provider_deliveries delivery ON delivery.delivery_id = linked.delivery_id
        JOIN runtime_physical_responses response ON response.response_id = arrival.response_id
        WHERE arrival.invocation_id = ? AND arrival.outcome = 'WINNER'`).all(fixtureValue.reviewer.invocationId) as readonly Row[];
      assert.equal(physical.length, 1);
      assert.deepEqual([physical[0]?.["result_id"], physical[0]?.["response_id"], physical[0]?.["physical_response_id"]], [outcome.resultId, outcome.responseId, outcome.responseId]);
      const resultLinks = database.prepare(`SELECT link.result_id, count(*) AS entries
        FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id
        WHERE result.invocation_id = ? GROUP BY link.result_id`).all(fixtureValue.reviewer.invocationId) as readonly Row[];
      assert.deepEqual(resultLinks.map((link) => [link["result_id"], link["entries"]]), [[outcome.resultId, 2]]);
    } finally { database.close(); }
    authority.close();
    authority = openAuthorityDatabase(fixtureValue.temporary.path);
    const reopened = new DatabaseSync(fixtureValue.temporary.path);
    try {
      const reconstructed = reconstructGenericWinnerMaterialization(reopened, fixtureValue.reviewer.invocationId);
      assert.deepEqual(reconstructed, outcome.materialization);
      assert.deepEqual(parseReviewerDispositionHandoff(reconstructed!), parseReviewerDispositionHandoff(outcome.materialization));
    } finally { reopened.close(); }
  } finally { try { authority.close(); } catch {} fixtureValue.temporary.cleanup(); }
});

test("C04 rolls back both entries and H1 together, then recovers the durable receipt", () => {
  const fixtureValue = reviewerFixture("c04-atomic");
  let authority = fixtureValue.authority;
  try {
    const contract = createReviewerDispositionContract(fixtureValue.reviewer, fixtureValue.decision);
    const attempt = authority.beginPreparedAttempt(fixtureValue.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    const setup = new DatabaseSync(fixtureValue.temporary.path);
    const before = candidateState(setup, fixtureValue);
    const targetBefore = targetState(setup, fixtureValue.target);
    setup.exec(`CREATE TRIGGER c04_abort_second_reviewer_entry
      BEFORE INSERT ON board_entries WHEN NEW.entry_type = 'VerificationResult'
      BEGIN SELECT RAISE(ABORT, 'c04 atomic abort'); END;`);
    setup.close();
    assert.throws(() => rawCommit(fixtureValue.temporary.path, fixtureValue.reviewer, attempt, reviewerWire(reviewerOutput(fixtureValue.target), "c04-atomic"), contract, "2026-08-26T00:01:07.000Z"), /c04 atomic abort/u);
    const interrupted = new DatabaseSync(fixtureValue.temporary.path);
    try {
      assertNoCandidate(interrupted, fixtureValue, before, targetBefore);
      const durable = interrupted.prepare(`SELECT
        (SELECT count(*) FROM runtime_results WHERE invocation_id = ?) AS results,
        (SELECT count(*) FROM runtime_result_arrivals WHERE invocation_id = ?) AS arrivals,
        (SELECT count(*) FROM runtime_physical_responses WHERE invocation_id = ?) AS physical,
        (SELECT count(*) FROM runtime_provider_deliveries WHERE invocation_id = ?) +
        (SELECT count(*) FROM runtime_opaque_completion_receipts WHERE invocation_id = ?) AS receipts,
        (SELECT count(*) FROM audit_events WHERE event_kind LIKE 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:%') AS resolutions`).get(fixtureValue.reviewer.invocationId, fixtureValue.reviewer.invocationId, fixtureValue.reviewer.invocationId, fixtureValue.reviewer.invocationId, fixtureValue.reviewer.invocationId) as Row;
      assert.deepEqual([durable["results"], durable["arrivals"], durable["physical"], durable["receipts"], durable["resolutions"]], [0, 0, 1, 1, 1]);
      interrupted.exec("DROP TRIGGER c04_abort_second_reviewer_entry");
    } finally { interrupted.close(); }
    authority.close();
    authority = openAuthorityDatabase(fixtureValue.temporary.path);
    const recovered = new DatabaseSync(fixtureValue.temporary.path);
    try {
      const materialization = reconstructGenericWinnerMaterialization(recovered, fixtureValue.reviewer.invocationId);
      assert.ok(materialization);
      const handoff = parseReviewerDispositionHandoff(materialization);
      assert.deepEqual([handoff.target, handoff.disposition], [{ entryId: fixtureValue.target.proposalId, type: "Proposal", digest: fixtureValue.target.proposalDigest }, "ISSUE_UNSUPPORTED"]);
      const links = recovered.prepare(`SELECT link.result_id, count(*) AS entries
        FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id
        WHERE result.invocation_id = ? GROUP BY link.result_id`).all(fixtureValue.reviewer.invocationId) as readonly Row[];
      assert.deepEqual(links.map((link) => [link["result_id"], link["entries"]]), [[handoff.resultId, 2]]);
    } finally { recovered.close(); }
  } finally { try { authority.close(); } catch {} fixtureValue.temporary.cleanup(); }
});

test("C04 rejects missing Context before provider and keeps malformed results restart-safe", async () => {
  const fixtureValue = reviewerFixture("c04-invalid");
  let authority = fixtureValue.authority;
  try {
    const database = new DatabaseSync(fixtureValue.temporary.path);
    const before = candidateState(database, fixtureValue);
    const targetBefore = targetState(database, fixtureValue.target);
    database.close();
    const denied = { ...fixtureValue.decision, outcome: "DENY", reason: "CONTEXT_NOT_FOUND", value: null } as unknown as ProfileContextDecision;
    let calls = 0;
    assert.throws(() => {
      const contract = createReviewerDispositionContract(fixtureValue.reviewer, denied);
      void authority.executePreparedAttempt(fixtureValue.reviewer, { outputContract: contract, complete: () => { calls += 1; return reviewerWire(reviewerOutput(fixtureValue.target), "unreachable"); } }, "2026-08-26T00:01:06.000Z");
    });
    assert.equal(calls, 0);
    const contract = createReviewerDispositionContract(fixtureValue.reviewer, fixtureValue.decision);
    authority.close();
    authority = openAuthorityDatabase(fixtureValue.temporary.path);
    const prepared = new DatabaseSync(fixtureValue.temporary.path);
    try {
      assert.deepEqual(reconstructPreparedProfileInvocation(prepared, fixtureValue.reviewer.invocationId), fixtureValue.reviewer);
      assertNoCandidate(prepared, fixtureValue, before, targetBefore);
    } finally { prepared.close(); }
    const malformed = { critique: reviewerOutput(fixtureValue.target).critique };
    const first = await authority.executePreparedAttempt(fixtureValue.reviewer, { outputContract: contract, complete: () => reviewerWire(malformed, "c04-invalid-one") }, "2026-08-26T00:01:06.000Z");
    assert.equal(first.outcome, "INVALID");
    const afterFirst = new DatabaseSync(fixtureValue.temporary.path);
    try { assertNoCandidate(afterFirst, fixtureValue, before, targetBefore); assert.deepEqual({ ...lifecycleState(afterFirst, fixtureValue) }, { case_status: "OPEN", workflow_state: "REVIEWER", workflow_revision: fixtureValue.reviewer.workflowRevision, invocation_status: "UNKNOWN" }); }
    finally { afterFirst.close(); }
    authority.close();
    authority = openAuthorityDatabase(fixtureValue.temporary.path);
    const restarted = new DatabaseSync(fixtureValue.temporary.path);
    try { assert.deepEqual(reconstructPreparedProfileInvocation(restarted, fixtureValue.reviewer.invocationId), fixtureValue.reviewer); assertNoCandidate(restarted, fixtureValue, before, targetBefore); }
    finally { restarted.close(); }
    const second = await authority.executePreparedAttempt(fixtureValue.reviewer, { outputContract: contract, complete: () => reviewerWire(malformed, "c04-invalid-two") }, "2026-08-26T00:01:08.000Z");
    assert.equal(second.outcome, "INVALID");
    authority.close();
    authority = openAuthorityDatabase(fixtureValue.temporary.path);
    const exhausted = new DatabaseSync(fixtureValue.temporary.path);
    try {
      assertNoCandidate(exhausted, fixtureValue, before, targetBefore);
      assert.deepEqual({ ...lifecycleState(exhausted, fixtureValue) }, { case_status: "FAILED", workflow_state: "FAILED", workflow_revision: fixtureValue.reviewer.workflowRevision + 1, invocation_status: "FAILED" });
      const attempts = exhausted.prepare("SELECT state FROM runtime_attempts WHERE invocation_id = ? ORDER BY attempt_number").all(fixtureValue.reviewer.invocationId) as readonly Row[];
      assert.deepEqual(attempts.map((attempt) => attempt["state"]), ["DISCARDED", "DISCARDED"]);
    } finally { exhausted.close(); }
  } finally { try { authority.close(); } catch {} fixtureValue.temporary.cleanup(); }
});

test("C04 stale, late, duplicate, and divergent arrivals add no candidates", async () => {
  const staleFixture = reviewerFixture("c04-stale");
  try {
    const contract = createReviewerDispositionContract(staleFixture.reviewer, staleFixture.decision);
    const attempt = staleFixture.authority.beginPreparedAttempt(staleFixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    const database = new DatabaseSync(staleFixture.temporary.path);
    database.prepare("UPDATE boards SET revision = revision + 1 WHERE board_id = ?").run(staleFixture.reviewer.boardId);
    database.prepare("UPDATE workflow_runs SET revision = revision + 1 WHERE workflow_run_id = ?").run(staleFixture.reviewer.workflowRunId);
    const before = candidateState(database, staleFixture); const targetBefore = targetState(database, staleFixture.target); database.close();
    const stale = rawCommit(staleFixture.temporary.path, staleFixture.reviewer, attempt, reviewerWire(reviewerOutput(staleFixture.target), "c04-stale"), contract, "2026-08-26T00:01:07.000Z");
    assert.equal(stale.outcome, "STALE");
    const after = new DatabaseSync(staleFixture.temporary.path);
    try {
      assertNoCandidate(after, staleFixture, before, targetBefore);
      const arrivals = after.prepare("SELECT outcome, result_id, response_id FROM runtime_result_arrivals WHERE invocation_id = ?").all(staleFixture.reviewer.invocationId) as readonly Row[];
      assert.deepEqual(arrivals.map((arrival) => [arrival["outcome"], arrival["result_id"], arrival["response_id"]]), [["STALE", stale.resultId, stale.responseId]]);
      assert.equal(Number((after.prepare("SELECT count(*) AS count FROM audit_events WHERE event_kind LIKE 'RUNTIME_RESULT:STALE:%'").get() as Row)["count"]), 1);
    } finally { after.close(); }
  } finally { try { staleFixture.authority.close(); } catch {} staleFixture.temporary.cleanup(); }

  const duplicateFixture = reviewerFixture("c04-duplicate");
  try {
    const contract = createReviewerDispositionContract(duplicateFixture.reviewer, duplicateFixture.decision);
    const attempt = duplicateFixture.authority.beginPreparedAttempt(duplicateFixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    const firstWire = reviewerWire(reviewerOutput(duplicateFixture.target), "c04-duplicate-one");
    assert.equal(rawCommit(duplicateFixture.temporary.path, duplicateFixture.reviewer, attempt, firstWire, contract, "2026-08-26T00:01:07.000Z").outcome, "WINNER");
    const database = new DatabaseSync(duplicateFixture.temporary.path);
    const before = candidateState(database, duplicateFixture); const targetBefore = targetState(database, duplicateFixture.target); database.close();
    assert.equal(rawCommit(duplicateFixture.temporary.path, duplicateFixture.reviewer, attempt, firstWire, contract, "2026-08-26T00:01:08.000Z").outcome, "DUPLICATE");
    assert.equal(rawCommit(duplicateFixture.temporary.path, duplicateFixture.reviewer, attempt, reviewerWire(reviewerOutput(duplicateFixture.target, "changed rationale"), "c04-divergent"), contract, "2026-08-26T00:01:09.000Z").outcome, "DIVERGENT");
    const after = new DatabaseSync(duplicateFixture.temporary.path);
    try { assert.deepEqual(candidateState(after, duplicateFixture), before); assert.deepEqual(targetState(after, duplicateFixture.target), targetBefore); }
    finally { after.close(); }
  } finally { try { duplicateFixture.authority.close(); } catch {} duplicateFixture.temporary.cleanup(); }

  const lateFixture = reviewerFixture("c04-late");
  try {
    const contract = createReviewerDispositionContract(lateFixture.reviewer, lateFixture.decision);
    const first = lateFixture.authority.beginPreparedAttempt(lateFixture.reviewer.invocationId, "2026-08-26T00:01:06.000Z");
    assert.equal(rawCommit(lateFixture.temporary.path, lateFixture.reviewer, first, reviewerWire({ critique: reviewerOutput(lateFixture.target).critique }, "c04-late-invalid"), contract, "2026-08-26T00:01:07.000Z").outcome, "INVALID");
    lateFixture.authority.beginPreparedAttempt(lateFixture.reviewer.invocationId, "2026-08-26T00:01:08.000Z");
    const database = new DatabaseSync(lateFixture.temporary.path);
    const before = candidateState(database, lateFixture); const targetBefore = targetState(database, lateFixture.target); database.close();
    assert.equal(rawCommit(lateFixture.temporary.path, lateFixture.reviewer, first, reviewerWire(reviewerOutput(lateFixture.target), "c04-late"), contract, "2026-08-26T00:01:09.000Z").outcome, "LATE");
    const after = new DatabaseSync(lateFixture.temporary.path);
    try { assertNoCandidate(after, lateFixture, before, targetBefore); }
    finally { after.close(); }
  } finally { try { lateFixture.authority.close(); } catch {} lateFixture.temporary.cleanup(); }
});
