import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { type ProfileContextDecision, type ProfileContextDecisionRequest, type ProfileContextEntryRef, type ProfileContextOperation, PROFILE_CONTEXT_AUDIT_EVENT_KIND, PROFILE_CONTEXT_REQUEST_VERSION } from "../src/contracts/profile-context.js";
import { generateR003ResearcherAnalystHandoff, type ReviewerHandoffTarget } from "../src/contracts/researcher-analyst-handoff.js";
import { deriveSourceId } from "../src/core/ids.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { readFixedProfileContext } from "../src/profile-context.js";
import { type PreparedProfileInvocation } from "../src/researcher-analyst.js";
import { type InvocationBoundOutputContract } from "../src/profile-runtime.js";
import { decideProfileContextAccess } from "../src/reviewer-context.js";
import { magicChatAckSuccessResponse, magicChatMessageCreatedEnvelope, magicChatMessageSendSuccessResponse, temporaryDatabase } from "./fixture.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const digest = (value: string): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });

type Row = Record<string, unknown>;

function researcherWire(invocation: PreparedProfileInvocation): string {
  const observation = invocation.entries.find((entry) => entry.type === "Observation");
  assert.ok(observation);
  return JSON.stringify({ providerMetadata: metadata("c03-integration-researcher"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}
function analystWire(invocation: PreparedProfileInvocation): string {
  const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef");
  assert.ok(evidence);
  return JSON.stringify({ providerMetadata: metadata("c03-integration-analyst"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
}
function reviewerFixture() {
  const temporary = temporaryDatabase("reviewer-context");
  const authority = openAuthorityDatabase(temporary.path);
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
  assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z");
  assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: "event-c03-integration-reply", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "message-c03-integration-reply", messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
  const caseId = resumed.snapshot.caseId;
  const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  assert.equal(authority.commitProviderResult(researcher, authority.beginPreparedAttempt(researcher.invocationId, "2026-08-26T00:01:02.000Z"), researcherWire(researcher)).outcome, "WINNER");
  const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
  assert.equal(authority.commitProviderResult(analyst, authority.beginPreparedAttempt(analyst.invocationId, "2026-08-26T00:01:04.000Z"), analystWire(analyst)).outcome, "WINNER");
  const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
  return { authority, caseId, reviewer, temporary };
}
function request(invocation: PreparedProfileInvocation, target: ReviewerHandoffTarget, requestId: string, operation: ProfileContextOperation = "READ_CONTEXT", requestedEntry: ProfileContextEntryRef | null = null): ProfileContextDecisionRequest {
  if (invocation.profile !== "REVIEWER" && invocation.profile !== "WRITER") throw new Error("C03 only accepts fixed Profiles");
  return { schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId, requestTime: "2026-08-26T00:02:00.000Z", operation, caseId: invocation.caseId, workflowRunId: invocation.workflowRunId, boardId: invocation.boardId, boardRevision: invocation.boardRevision, workflowRevision: invocation.workflowRevision, profile: invocation.profile, context: { invocationId: invocation.invocationId, contextId: invocation.contextId, contextDigest: invocation.contextDigest }, target, requestedEntry };
}
const auditCount = (database: DatabaseSync): number => Number((database.prepare("SELECT count(*) AS count FROM audit_events WHERE event_kind = ?").get(PROFILE_CONTEXT_AUDIT_EVENT_KIND) as Row)["count"]);
function authoritySnapshot(database: DatabaseSync, caseId: string): Row {
  const state = database.prepare("SELECT c.status, b.revision AS board_revision, w.state AS workflow_state, w.revision AS workflow_revision, (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id) AS board_entries, (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id AND entry.entry_type = 'ArtifactRef') AS artifact_refs, (SELECT count(*) FROM runtime_results result JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE invocation.case_id = c.case_id) AS runtime_results, (SELECT count(*) FROM approvals approval WHERE approval.case_id = c.case_id) AS approvals, (SELECT count(*) FROM response_claims claim WHERE claim.case_id = c.case_id) AS response_claims FROM cases c JOIN boards b ON b.board_id = c.board_id JOIN workflow_runs w ON w.workflow_run_id = c.workflow_run_id WHERE c.case_id = ?").get(caseId) as Row | undefined;
  if (state === undefined) throw new Error("C03 authoritative state is missing");
  return state;
}
function assertRedacted(database: DatabaseSync, decision: ProfileContextDecision, canaries: readonly string[]): void {
  const row = database.prepare("SELECT case_id, board_id, workflow_run_id, details_json FROM audit_events WHERE audit_event_id = ?").get(decision.auditEventId) as Row | undefined;
  if (row === undefined) throw new Error("C03 denial audit is missing");
  assert.deepEqual([row["case_id"], row["board_id"], row["workflow_run_id"]], [null, null, null]);
  for (const canary of canaries) assert.equal(String(row["details_json"]).includes(canary), false);
}
function withTargetMutation<T>(path: string, entryId: string, column: "payload_json" | "based_on_json" | "source_refs_json", replacement: string, action: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try {
    const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'board_entries_immutable_update'").get() as Row | undefined;
    const triggerSql = trigger?.["sql"];
    if (typeof triggerSql !== "string") throw new Error("board entry update trigger is missing");
    const original = database.prepare(`SELECT ${column} AS value FROM board_entries WHERE board_entry_id = ?`).get(entryId) as Row | undefined;
    const originalValue = original?.["value"];
    if (typeof originalValue !== "string") throw new Error("target field is missing");
    const replace = (value: string): void => {
      database.exec("DROP TRIGGER board_entries_immutable_update");
      try { database.prepare(`UPDATE board_entries SET ${column} = ? WHERE board_entry_id = ?`).run(value, entryId); }
      finally { database.exec(triggerSql); }
    };
    replace(replacement);
    try { return action(database); }
    finally { replace(originalValue); }
  } finally { database.close(); }
}

test("C03 integrates C01 Context with the exact generated Reviewer target graph", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const fixed = readFixedProfileContext(database, fixture.reviewer.invocationId);
      assert.ok(fixed);
      assert.deepEqual([fixed.contextId, fixed.contextDigest, fixed.boardRevision, fixed.workflowRevision], [fixture.reviewer.contextId, fixture.reviewer.contextDigest, fixture.reviewer.boardRevision, fixture.reviewer.workflowRevision]);
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const decision = decideProfileContextAccess(database, request(fixture.reviewer, target, "c03-target-graph"));
      if (decision.value === null || decision.value.kind !== "REVIEWER_CONTEXT") throw new Error("Reviewer Context was not allowed");
      const view = decision.value;
      const root = database.prepare("SELECT based_on_json FROM board_entries WHERE board_entry_id = ?").get(target.proposalId) as Row;
      const [claimId] = JSON.parse(String(root["based_on_json"])) as string[];
      assert.deepEqual(view.entries.map((entry) => entry.id), [target.proposalId, claimId]);
      assert.deepEqual(view.entries.map(({ basedOn, sourceRefs }) => [basedOn, sourceRefs]), [[[claimId], []], [[], []]]);
      assert.deepEqual(view.entries.map((entry) => entry.payload), [{ action: "Promise adoption.", supportStatus: "UNSUPPORTED" }, { statement: "Customer adoption is guaranteed.", unsupported: true }]);
      assert.equal(view.entries.some((entry) => JSON.stringify(entry.payload).includes(source.content)), false);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("C03 keeps Writer as a refs-only boundary without output or Artifact authority", async () => {
  const fixture = reviewerFixture();
  try {
    let target: ReviewerHandoffTarget;
    {
      const database = new DatabaseSync(fixture.temporary.path);
      try { target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget; }
      finally { database.close(); }
    }
    const reviewerContract: InvocationBoundOutputContract = { invocationId: fixture.reviewer.invocationId, contextDigest: fixture.reviewer.contextDigest, profile: "REVIEWER", profileVersion: fixture.reviewer.profileVersion, outputSchema: fixture.reviewer.outputSchema, materialize(context) {
      const entry = context.entries.find((candidate) => candidate.id === target.proposalId); const unrelated = context.entries.find((candidate) => candidate.id !== target.proposalId);
      if (entry === undefined || unrelated === undefined) throw new Error("Reviewer Context lacks a target or unrelated entry");
      const targetRef = { digest: target.proposalDigest, entryId: target.proposalId, type: "Proposal" as const };
      return { boardEntries: [
        { basedOn: [entry.id], entryType: "Critique", payload: { target: targetRef }, sourceRefs: [] },
        { basedOn: [entry.id], entryType: "VerificationResult", payload: { target: targetRef }, sourceRefs: [] },
        { basedOn: [unrelated.id], entryType: "Critique", payload: { target: { digest: unrelated.digest, entryId: unrelated.id, type: unrelated.type } }, sourceRefs: [] },
      ] };
    } };
    const reviewerOutcome = await fixture.authority.executePreparedAttempt(fixture.reviewer, { outputContract: reviewerContract, complete: () => JSON.stringify({ providerMetadata: metadata("c03-writer-boundary-review"), output: { text: "Review target." }, receivedAt: "2026-08-26T00:01:07.000Z", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }) }, "2026-08-26T00:01:06.000Z");
    if (reviewerOutcome.outcome !== "WINNER" || reviewerOutcome.materialization === undefined) throw new Error("Reviewer materialization did not win");
    const expectedReviews = reviewerOutcome.materialization.boardEntries.slice(0, 2).map(({ contentDigest: digest, entryId: id, entryType: type }) => ({ digest, id, type })).sort((a, b) => a.id.localeCompare(b.id));
    const writer = fixture.authority.prepareProfileInvocation({ caseId: fixture.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:08.000Z", profile: "WRITER" });
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const before = authoritySnapshot(database, fixture.caseId);
      const decision = decideProfileContextAccess(database, request(writer, target, "c03-writer-boundary"));
      if (decision.value === null || decision.value.kind !== "WRITER_BOUNDARY") throw new Error("Writer boundary was not allowed");
      assert.equal(decision.value.outputAvailable, false);
      assert.equal(decision.value.entries.every((entry) => Object.keys(entry).sort().join(",") === "digest,id,type"), true);
      assert.deepEqual(decision.value.entries.filter((entry) => entry.type === "Critique" || entry.type === "VerificationResult"), expectedReviews);
      assert.equal(decision.value.entries.some((entry) => entry.id === reviewerOutcome.materialization?.boardEntries[2]?.entryId), false);
      assert.equal(Number((database.prepare("SELECT count(*) AS count FROM runtime_results WHERE invocation_id = ?").get(writer.invocationId) as Row)["count"]), 0);
      const blocked = decideProfileContextAccess(database, request(writer, target, "c03-writer-artifact-authority", "SET_ARTIFACT_ELIGIBILITY"));
      assert.deepEqual([blocked.outcome, blocked.reason, blocked.value], ["DENY", "AUTHORITY_ESCALATION", null]);
      assertRedacted(database, blocked, [source.content, "Review target."]);
      assert.deepEqual(authoritySnapshot(database, fixture.caseId), before);
    } finally { database.close(); }
  } finally { try { fixture.authority.close(); } catch {} fixture.temporary.cleanup(); }
});

test("C03 denies duplicate, cyclic, incomplete, or over-bound cited closures without disclosure", () => {
  const fixture = reviewerFixture();
  try {
    let target: ReviewerHandoffTarget; let citedId: string;
    const setup = new DatabaseSync(fixture.temporary.path);
    try {
      target = generateR003ResearcherAnalystHandoff(setup, fixture.caseId).reviewerTarget;
      const [candidate] = JSON.parse(String((setup.prepare("SELECT based_on_json FROM board_entries WHERE board_entry_id = ?").get(target.proposalId) as Row | undefined)?.["based_on_json"])) as unknown[];
      if (typeof candidate !== "string") throw new Error("Reviewer target lacks a cited Claim");
      citedId = candidate;
    } finally { setup.close(); }
    fixture.authority.close();
    const mutations = [
      ["duplicate", "based_on_json", JSON.stringify([citedId, citedId])],
      ["cyclic", "source_refs_json", JSON.stringify([target.proposalId])],
      ["incomplete", "source_refs_json", JSON.stringify([`entry_${"0".repeat(64)}`])],
      ["over-bound", "source_refs_json", JSON.stringify(Array.from({ length: 17 }, (_, index) => `entry_${index.toString(16).padStart(64, "0")}`))],
    ] as const;
    for (const [index, [kind, column, replacement]] of mutations.entries()) {
      withTargetMutation(fixture.temporary.path, target.proposalId, column, replacement, (database) => {
        const denied = decideProfileContextAccess(database, request(fixture.reviewer, target, `c03-${kind}-cited-graph`));
        assert.deepEqual([denied.outcome, denied.reason, denied.value], ["DENY", "INCOMPLETE_CITED_GRAPH", null]);
        assertRedacted(database, denied, [source.content, "Promise adoption."]);
        assert.equal(auditCount(database), index + 1);
      });
    }
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const arrival = database.prepare("SELECT attempt_id, raw_response_json, raw_response_digest, response_id FROM runtime_result_arrivals WHERE result_id = ? AND outcome = 'WINNER'").get(target.resultId) as Row | undefined;
      const attemptId = arrival?.["attempt_id"]; const rawResponse = arrival?.["raw_response_json"]; const rawDigest = arrival?.["raw_response_digest"]; const responseId = arrival?.["response_id"];
      if (typeof attemptId !== "string" || typeof rawResponse !== "string" || typeof rawDigest !== "string" || responseId !== null && typeof responseId !== "string") throw new Error("target winner arrival is incomplete");
      const nextArrival = Number((database.prepare("SELECT max(arrival_number) + 1 AS number FROM runtime_result_arrivals WHERE attempt_id = ?").get(attemptId) as Row)["number"]);
      database.prepare("INSERT INTO runtime_result_arrivals (arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, outcome, raw_response_json, raw_response_digest, recorded_at, response_id) VALUES (?, 'accord.runtime-result-arrival/v1', ?, ?, ?, ?, 'WINNER', ?, ?, ?, ?)").run(`arrival_${"f".repeat(64)}`, target.invocationId, attemptId, target.resultId, nextArrival, rawResponse, rawDigest, "2026-08-26T00:02:01.000Z", responseId);
      const duplicateTarget = decideProfileContextAccess(database, request(fixture.reviewer, target, "c03-duplicate-target"));
      assert.deepEqual([duplicateTarget.outcome, duplicateTarget.reason, duplicateTarget.value], ["DENY", "TARGET_MISMATCH", null]);
      assertRedacted(database, duplicateTarget, [source.content, "Promise adoption."]);
      assert.equal(auditCount(database), 5);
    } finally { database.close(); }
  } finally { try { fixture.authority.close(); } catch {} fixture.temporary.cleanup(); }
});

test("C03 fails closed on tampered audit state after restart", () => {
  const fixture = reviewerFixture();
  try {
    let input: ProfileContextDecisionRequest; let original: ProfileContextDecision; let target: ReviewerHandoffTarget;
    const first = new DatabaseSync(fixture.temporary.path);
    try {
      target = generateR003ResearcherAnalystHandoff(first, fixture.caseId).reviewerTarget;
      input = request(fixture.reviewer, target, "c03-tampered-replay");
      original = decideProfileContextAccess(first, input);
      assert.equal(original.outcome, "ALLOW");
    } finally { first.close(); }
    fixture.authority.close(); const reopened = openAuthorityDatabase(fixture.temporary.path); reopened.close();
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      assert.deepEqual(decideProfileContextAccess(database, input), original);
      const count = auditCount(database);
      assert.throws(() => decideProfileContextAccess(database, { ...input, requestId: "c03-malformed", unexpected: true } as unknown as ProfileContextDecisionRequest), /unsupported or missing field/u);
      assert.equal(auditCount(database), count);
      const details = (database.prepare("SELECT details_json FROM audit_events WHERE audit_event_id = ?").get(original.auditEventId) as Row | undefined)?.["details_json"];
      if (typeof details !== "string") throw new Error("original C03 audit details are missing");
      database.prepare("UPDATE audit_events SET details_json = '{}' WHERE audit_event_id = ?").run(original.auditEventId);
      assert.throws(() => decideProfileContextAccess(database, input));
      assert.equal(auditCount(database), count);
      database.prepare("UPDATE audit_events SET details_json = ?, correlation_id = ? WHERE audit_event_id = ?").run(details, `corr_${"f".repeat(64)}`, original.auditEventId);
      assert.throws(() => decideProfileContextAccess(database, input));
      assert.equal(auditCount(database), count);
      const selfRehashInput = request(fixture.reviewer, target, "c03-audit-self-rehash", "READ_HIDDEN_REASONING");
      const selfRehash = decideProfileContextAccess(database, selfRehashInput);
      const selfRehashDetails = JSON.parse(String((database.prepare("SELECT details_json FROM audit_events WHERE audit_event_id = ?").get(selfRehash.auditEventId) as Row)["details_json"])) as Row;
      const originalDecision = selfRehashDetails["decision"];
      if (originalDecision === null || typeof originalDecision !== "object" || Array.isArray(originalDecision)) throw new Error("self-rehash audit decision is missing");
      const forgedDecision = { ...(originalDecision as Row), reason: "AUTHORITY_ESCALATION" };
      database.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify({ ...selfRehashDetails, decision: forgedDecision, decisionDigest: createHash("sha256").update(JSON.stringify(forgedDecision), "utf8").digest("hex") }), selfRehash.auditEventId);
      const stable = auditCount(database);
      assert.throws(() => decideProfileContextAccess(database, selfRehashInput));
      assert.equal(auditCount(database), stable);
    } finally { database.close(); }
  } finally { try { fixture.authority.close(); } catch {} fixture.temporary.cleanup(); }
});
