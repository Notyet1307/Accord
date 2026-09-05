import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { type ProfileContextDecision, type ProfileContextDecisionRequest, type ProfileContextEntryRef, type ProfileContextOperation, PROFILE_CONTEXT_AUDIT_EVENT_KIND, PROFILE_CONTEXT_REQUEST_VERSION } from "../../src/contracts/profile-context.js";
import { generateR003ResearcherAnalystHandoff, type ReviewerHandoffTarget } from "../../src/contracts/researcher-analyst-handoff.js";
import { deriveSourceId, parseBoardId, parseWorkflowRunId } from "../../src/core/ids.js";
import { MagicChatProtocolAdapter } from "../../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { type PreparedProfileInvocation } from "../../src/researcher-analyst.js";
import { type InvocationBoundOutputContract } from "../../src/profile-runtime.js";
import { decideProfileContextAccess } from "../../src/reviewer-context.js";
import { magicChatAckSuccessResponse, magicChatMessageCreatedEnvelope, magicChatMessageSendSuccessResponse, temporaryDatabase } from "../fixture.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])); return value; }
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
const digest = (value: string): string => hash(value);
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });

type Row = Record<string, unknown>;

function researcherWire(invocation: PreparedProfileInvocation): string {
  const observation = invocation.entries.find((entry) => entry.type === "Observation");
  assert.ok(observation);
  return JSON.stringify({ providerMetadata: metadata("o03-researcher"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}
function analystWire(invocation: PreparedProfileInvocation): string {
  const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef");
  assert.ok(evidence);
  return JSON.stringify({ providerMetadata: metadata("o03-analyst"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
}
function reviewerContract(invocation: PreparedProfileInvocation): InvocationBoundOutputContract {
  return { invocationId: invocation.invocationId, contextDigest: invocation.contextDigest, profile: "REVIEWER", profileVersion: invocation.profileVersion, outputSchema: invocation.outputSchema, materialize(context) { const entry = context.entries[0]; if (entry === undefined) throw new Error("Reviewer needs one Context entry"); return { boardEntries: [{ basedOn: [entry.id], entryType: "Critique", payload: { text: "Reviewer critique" }, sourceRefs: [] }], handoff: { kind: "reviewer-handoff", payload: { text: "Reviewer critique" }, version: "v1" } }; } };
}
function reviewerFixture() {
  const temporary = temporaryDatabase("r003-c1-o03");
  const authority = openAuthorityDatabase(temporary.path);
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
  assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z");
  assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: "event-o03-reply", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "message-o03-reply", messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
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
function auditRow(database: DatabaseSync, decision: ProfileContextDecision): Row {
  const row = database.prepare("SELECT * FROM audit_events WHERE audit_event_id = ? AND event_kind = ?").get(decision.auditEventId, PROFILE_CONTEXT_AUDIT_EVENT_KIND) as Row | undefined;
  if (row === undefined) throw new Error("C03 audit is missing");
  return row;
}
function assertAudit(database: DatabaseSync, requestValue: ProfileContextDecisionRequest, decision: ProfileContextDecision): void {
  const row = auditRow(database, decision);
  const details = JSON.parse(String(row["details_json"])) as Record<string, unknown>;
  assert.equal(row["correlation_id"], decision.correlationId);
  assert.equal(row["recorded_at"], decision.requestTime);
  assert.deepEqual(details["request"], requestValue);
  const fingerprint = hash(requestValue);
  assert.equal(decision.requestFingerprint, fingerprint);
  assert.equal(details["requestFingerprint"], fingerprint);
  assert.deepEqual(details["decision"], decision);
}
const auditCount = (database: DatabaseSync): number => Number((database.prepare("SELECT count(*) AS count FROM audit_events WHERE event_kind = ?").get(PROFILE_CONTEXT_AUDIT_EVENT_KIND) as Row)["count"]);
function assertRedacted(database: DatabaseSync, decision: ProfileContextDecision, canaries: readonly string[]): void {
  assert.equal(decision.outcome, "DENY");
  assert.equal(decision.value, null);
  const row = auditRow(database, decision);
  assert.deepEqual([row["case_id"], row["board_id"], row["workflow_run_id"]], [null, null, null]);
  const serialized = String(row["details_json"]);
  for (const canary of canaries) assert.equal(serialized.includes(canary), false);
}
function snapshot(database: DatabaseSync, caseId: string): Row {
  const row = database.prepare("SELECT c.status AS case_status, c.board_id AS case_board_id, b.revision AS board_revision, w.state AS workflow_state, w.revision AS workflow_revision, (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id) AS entries, (SELECT count(*) FROM board_entries entry WHERE entry.case_id = c.case_id AND entry.entry_type = 'ArtifactRef') AS artifact_refs, (SELECT count(*) FROM runtime_results result JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE invocation.case_id = c.case_id) AS results, (SELECT count(*) FROM approvals approval WHERE approval.case_id = c.case_id) AS approvals, (SELECT count(*) FROM response_claims claim WHERE claim.case_id = c.case_id) AS response_claims, (SELECT count(*) FROM pending_side_effects effect WHERE effect.case_id = c.case_id) AS pending_side_effects FROM cases c JOIN boards b ON b.board_id = c.board_id JOIN workflow_runs w ON w.workflow_run_id = c.workflow_run_id WHERE c.case_id = ?").get(caseId) as Row | undefined;
  if (row === undefined) throw new Error("Case state is missing");
  return row;
}
function reviewerView(decision: ProfileContextDecision) {
  if (decision.value === null || decision.value.kind !== "REVIEWER_CONTEXT") throw new Error("Reviewer Context was not allowed");
  return decision.value;
}
function writerBoundary(decision: ProfileContextDecision) {
  if (decision.value === null || decision.value.kind !== "WRITER_BOUNDARY") throw new Error("Writer boundary was not allowed");
  return decision.value;
}

test("O03 reviewer-target-view permits only the exact target and cited closure", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const input = request(fixture.reviewer, target, "o03-reviewer-target-view");
      const decision = decideProfileContextAccess(database, input);
      const view = reviewerView(decision);
      const root = database.prepare("SELECT based_on_json FROM board_entries WHERE board_entry_id = ?").get(target.proposalId) as Row;
      const [claimId] = JSON.parse(String(root["based_on_json"])) as string[];
      assert.deepEqual(view.entries.map((entry) => entry.id), [target.proposalId, claimId]);
      assert.deepEqual(view.entries.map(({ basedOn, sourceRefs }) => [basedOn, sourceRefs]), [[[claimId], []], [[], []]]);
      assert.deepEqual(view.entries[0]?.payload, { action: "Promise adoption.", supportStatus: "UNSUPPORTED" });
      assert.deepEqual(view.entries[1]?.payload, { statement: "Customer adoption is guaranteed.", unsupported: true });
      const unrelated = fixture.reviewer.entries.find((entry) => entry.type === "Proposal" && entry.payload["action"] === "Use two weeks.");
      assert.ok(unrelated);
      assert.equal(view.entries.some((entry) => entry.id === unrelated.id), false);
      assert.equal(view.entries.some((entry) => JSON.stringify(entry.payload).includes(source.content)), false);
      assert.equal(decision.reason, "CURRENT_CONTEXT");
      assertAudit(database, input, decision);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O03 writer-boundary-view exposes refs only and never produces Writer output", async () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    let target: ReviewerHandoffTarget;
    try { target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget; } finally { database.close(); }
    const reviewerOutcome = await fixture.authority.executePreparedAttempt(fixture.reviewer, { outputContract: reviewerContract(fixture.reviewer), complete: () => JSON.stringify({ providerMetadata: metadata("o03-reviewer"), output: { text: "Reviewer critique" }, receivedAt: "2026-08-26T00:01:07.000Z", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } }) }, "2026-08-26T00:01:06.000Z");
    assert.equal(reviewerOutcome.outcome, "WINNER");
    const writer = fixture.authority.prepareProfileInvocation({ caseId: fixture.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:08.000Z", profile: "WRITER" });
    const current = new DatabaseSync(fixture.temporary.path);
    try {
      const input = request(writer, target, "o03-writer-boundary-view");
      const before = snapshot(current, fixture.caseId);
      const decision = decideProfileContextAccess(current, input);
      const boundary = writerBoundary(decision);
      assert.equal(boundary.outputAvailable, false);
      assert.equal(boundary.entries.length, 2);
      assert.equal(boundary.entries.every((entry) => Object.keys(entry).sort().join(",") === "digest,id,type"), true);
      const entryRequest = request(writer, target, "o03-writer-no-entry-output", "READ_BOARD_ENTRY", boundary.entries[0] ?? null);
      const entryDecision = decideProfileContextAccess(current, entryRequest);
      assert.deepEqual([entryDecision.outcome, entryDecision.reason, entryDecision.value], ["DENY", "OPERATION_NOT_ALLOWED", null]);
      assert.deepEqual(snapshot(current, fixture.caseId), before);
      assert.equal((current.prepare("SELECT count(*) AS count FROM runtime_results WHERE invocation_id = ?").get(writer.invocationId) as Row)["count"], 0);
      assertAudit(current, input, decision);
      assertRedacted(current, entryDecision, [source.content]);
    } finally { current.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O03 cross-case-read denies another Case and unrelated current entries without disclosure", () => {
  const fixture = reviewerFixture();
  try {
    const protocol = new MagicChatProtocolAdapter(fixture.authority, "other-synthetic-app");
    const other = protocol.receive(magicChatMessageCreatedEnvelope({ body: "cross-case-canary", conversationId: "conversation-o03-other", cursor: 1, envelopeEventId: "event-o03-other", messageId: "message-o03-other", messageSequence: 1 }), "2026-08-26T00:01:09.000Z");
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const foreign = database.prepare("SELECT board_id, workflow_run_id FROM cases WHERE case_id = ?").get(other.snapshot.caseId) as Row;
      const otherBoardId = parseBoardId(foreign["board_id"]);
      const otherRunId = parseWorkflowRunId(foreign["workflow_run_id"]);
      const base = request(fixture.reviewer, target, "o03-cross-case");
      const crossCase = { ...base, caseId: other.snapshot.caseId, boardId: otherBoardId, workflowRunId: otherRunId, target: { ...target, caseId: other.snapshot.caseId, boardId: otherBoardId, runId: otherRunId } };
      const crossDecision = decideProfileContextAccess(database, crossCase);
      assert.deepEqual([crossDecision.outcome, crossDecision.reason, crossDecision.value], ["DENY", "CONTEXT_BINDING_MISMATCH", null]);
      const unrelated = fixture.reviewer.entries.find((entry) => entry.type === "Proposal" && entry.payload["action"] === "Use two weeks.");
      assert.ok(unrelated);
      const unrelatedDecision = decideProfileContextAccess(database, request(fixture.reviewer, target, "o03-unrelated-entry", "READ_BOARD_ENTRY", { id: unrelated.id, type: "Proposal", digest: unrelated.digest }));
      assert.deepEqual([unrelatedDecision.outcome, unrelatedDecision.reason, unrelatedDecision.value], ["DENY", "ENTRY_OUTSIDE_CONTEXT", null]);
      assertRedacted(database, crossDecision, ["cross-case-canary", source.content]);
      assertRedacted(database, unrelatedDecision, ["cross-case-canary", source.content]);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O03 authority-escalation records denials without authoritative mutation", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const before = snapshot(database, fixture.caseId);
      const operations = ["APPEND_EVIDENCE", "MUTATE_TARGET", "CREATE_APPROVAL", "PUBLISH_RESPONSE", "SET_ARTIFACT_ELIGIBILITY", "MUTATE_WORKFLOW_INSTRUCTIONS"] as const;
      for (const operation of operations) {
        const decision = decideProfileContextAccess(database, request(fixture.reviewer, target, `o03-authority-${operation}`, operation));
        assert.deepEqual([decision.outcome, decision.reason, decision.value], ["DENY", "AUTHORITY_ESCALATION", null]);
        assertRedacted(database, decision, [source.content]);
        assert.deepEqual(snapshot(database, fixture.caseId), before);
      }
      assert.equal(auditCount(database), operations.length);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("O03 private-history-read denies every protected resource with a redacted audit", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const operations = ["READ_HIDDEN_REASONING", "READ_PRIVATE_RUNTIME_HISTORY", "READ_CREDENTIALS", "READ_UNRELATED_SOURCE"] as const;
      for (const operation of operations) {
        const decision = decideProfileContextAccess(database, request(fixture.reviewer, target, `o03-protected-${operation}`, operation));
        assert.deepEqual([decision.outcome, decision.reason, decision.value], ["DENY", "PROTECTED_RESOURCE", null]);
        assertRedacted(database, decision, [source.content, "o03-analyst"]);
      }
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});

test("C03 fixes denials and replays global identities before C01 reads", () => {
  const fixture = reviewerFixture();
  try {
    const database = new DatabaseSync(fixture.temporary.path);
    try {
      const target = generateR003ResearcherAnalystHandoff(database, fixture.caseId).reviewerTarget;
      const substitute = fixture.reviewer.entries.find((entry) => entry.type === "Proposal" && entry.payload["action"] === "Use two weeks.");
      assert.ok(substitute);
      const substitutedTarget = { ...target, proposalId: substitute.id, proposalDigest: substitute.digest };
      const targetMismatch = decideProfileContextAccess(database, request(fixture.reviewer, substitutedTarget, "o03-same-winner-substitute"));
      assert.deepEqual([targetMismatch.outcome, targetMismatch.reason, targetMismatch.value], ["DENY", "TARGET_MISMATCH", null]);
      const invalid = { invocationId: fixture.reviewer.invocationId, contextId: fixture.reviewer.contextId, contextDigest: "0".repeat(64) };
      const invalidProtected = decideProfileContextAccess(database, { ...request(fixture.reviewer, substitutedTarget, "o03-invalid-before-protected", "READ_HIDDEN_REASONING"), context: invalid });
      const invalidAuthority = decideProfileContextAccess(database, { ...request(fixture.reviewer, substitutedTarget, "o03-invalid-before-authority", "PUBLISH_RESPONSE"), context: invalid });
      const protectedDecision = decideProfileContextAccess(database, request(fixture.reviewer, substitutedTarget, "o03-protected-before-graph", "READ_HIDDEN_REASONING"));
      const authorityDecision = decideProfileContextAccess(database, request(fixture.reviewer, substitutedTarget, "o03-authority-before-graph", "PUBLISH_RESPONSE"));
      assert.deepEqual([invalidProtected.reason, invalidAuthority.reason, protectedDecision.reason, authorityDecision.reason], ["PROTECTED_RESOURCE", "AUTHORITY_ESCALATION", "PROTECTED_RESOURCE", "AUTHORITY_ESCALATION"]);
      const input = request(fixture.reviewer, target, "o03-global-replay");
      const original = decideProfileContextAccess(database, input);
      assert.equal(original.outcome, "ALLOW");
      assertAudit(database, input, original);
      const count = auditCount(database);
      const triggerSql = (database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'board_entries_immutable_update'").get() as Row | undefined)?.["sql"];
      const originalPayload = (database.prepare("SELECT payload_json FROM board_entries WHERE board_entry_id = ?").get(target.proposalId) as Row | undefined)?.["payload_json"];
      if (typeof triggerSql !== "string" || typeof originalPayload !== "string") throw new Error("target immutability fixture is incomplete");
      const writePayload = (payload: string): void => { database.exec("DROP TRIGGER board_entries_immutable_update"); try { database.prepare("UPDATE board_entries SET payload_json = ? WHERE board_entry_id = ?").run(payload, target.proposalId); } finally { database.exec(triggerSql); } };
      writePayload('{"poison":"test-only"}');
      try {
        assert.deepEqual(decideProfileContextAccess(database, input), original);
        const changes: readonly Partial<ProfileContextDecisionRequest>[] = [
          { boardRevision: input.boardRevision + 1 }, { profile: "WRITER" }, { context: { ...input.context, contextDigest: "0".repeat(64) } },
          { target: { ...target, proposalDigest: "0".repeat(64) } }, { operation: "READ_HIDDEN_REASONING" },
          { operation: "READ_BOARD_ENTRY", requestedEntry: { id: target.proposalId, type: "Proposal", digest: target.proposalDigest } }, { requestTime: "2026-08-26T00:02:01.000Z" },
        ];
        for (const change of changes) {
          assert.throws(() => decideProfileContextAccess(database, { ...input, ...change }), /identity conflict/u);
          assert.equal(auditCount(database), count);
        }
        assert.throws(() => decideProfileContextAccess(database, { ...input, requestId: "o03-poison-control" }), /immutable graph/u);
        assert.equal(auditCount(database), count);
      } finally { writePayload(originalPayload); }
      database.prepare("UPDATE boards SET revision = revision + 1 WHERE board_id = ?").run(fixture.reviewer.boardId);
      database.prepare("UPDATE workflow_runs SET revision = revision + 1 WHERE workflow_run_id = ?").run(fixture.reviewer.workflowRunId);
      const staleProtected = decideProfileContextAccess(database, request(fixture.reviewer, substitutedTarget, "o03-stale-before-protected", "READ_HIDDEN_REASONING"));
      const staleAuthority = decideProfileContextAccess(database, request(fixture.reviewer, substitutedTarget, "o03-stale-before-authority", "PUBLISH_RESPONSE"));
      const stale = decideProfileContextAccess(database, { ...input, requestId: "o03-different-stale" });
      assert.deepEqual([[staleProtected.outcome, staleProtected.reason], [staleAuthority.outcome, staleAuthority.reason], [stale.outcome, stale.reason]], [["DENY", "PROTECTED_RESOURCE"], ["DENY", "AUTHORITY_ESCALATION"], ["DENY", "STALE_CONTEXT"]]);
      assert.notEqual(stale.auditEventId, original.auditEventId);
      const beforeRollback = auditCount(database);
      database.exec("BEGIN");
      try {
        assert.equal(decideProfileContextAccess(database, request(fixture.reviewer, target, "o03-outer-rollback", "READ_HIDDEN_REASONING")).reason, "PROTECTED_RESOURCE");
        assert.equal(auditCount(database), beforeRollback + 1);
      } finally { database.exec("ROLLBACK"); }
      assert.equal(auditCount(database), beforeRollback);
    } finally { database.close(); }
  } finally { fixture.authority.close(); fixture.temporary.cleanup(); }
});
