import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { PROFILE_CONTEXT_REQUEST_VERSION, type ProfileContextDecision } from "../src/contracts/profile-context.js";
import type { ReviewerDispositionOutput, ReviewerTargetRef } from "../src/contracts/reviewer-disposition.js";
import { generateR003ResearcherAnalystHandoff, type ReviewerHandoffTarget } from "../src/contracts/researcher-analyst-handoff.js";
import { deriveRuntimeAuditCorrelationId, deriveSourceId, parseBoardEntryId, type BoardEntryId, type CaseId } from "../src/core/ids.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { AuthorityStartupError, openAuthorityDatabase, type AuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { createReviewerDispositionContract, parseReviewerDispositionHandoff } from "../src/reviewer-disposition.js";
import { decideProfileContextAccess } from "../src/reviewer-context.js";
import { GENERIC_MATERIALIZATION_SCHEMA_VERSION, WRITER_MATERIALIZATION_SCHEMA_VERSION, deriveDurableGenericMaterialization, parseDurableGenericMaterialization } from "../src/profile-runtime.js";
import { reconstructGenericWinnerMaterialization, type PreparedProfileInvocation } from "../src/researcher-analyst.js";
import { createWriterArtifactContract, parseWriterArtifactAuthority } from "../src/writer-artifact.js";
import {
  magicChatAckSuccessResponse,
  magicChatMessageCreatedEnvelope,
  magicChatMessageSendSuccessResponse,
  temporaryDatabase,
  type TemporaryDatabase,
} from "./fixture.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])) : value;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });
type Row = Record<string, unknown>;
type Fixture = Readonly<{ authority: AuthorityDatabase; caseId: CaseId; reviewer: PreparedProfileInvocation; target: ReviewerHandoffTarget; decision: ProfileContextDecision; temporary: TemporaryDatabase }>;

function wire(output: unknown, requestId: string, receivedAt: string): string {
  return JSON.stringify({ providerMetadata: metadata(requestId), output, receivedAt, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}

function reviewerOutput(target: ReviewerHandoffTarget): ReviewerDispositionOutput {
  const reference: ReviewerTargetRef = { entryId: target.proposalId, type: "Proposal", digest: target.proposalDigest };
  return {
    critique: { target: reference, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal must not become evidence." },
    verificationResult: { target: reference, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal has no evidence." },
  };
}

async function fixture(label: string): Promise<Fixture> {
  const temporary = temporaryDatabase(label); const authority = openAuthorityDatabase(temporary.path);
  authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z"); assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), "2026-08-26T00:00:03.000Z"); assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: `event-${label}`, messageCreatedAt: "2026-08-26T00:01:00Z", messageId: `message-${label}`, messageSequence: 3, replyToMessageId: "clarification-message-1" }), "2026-08-26T00:01:01.000Z");
  const caseId = resumed.snapshot.caseId;
  const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  const observation = researcher.entries.find((entry) => entry.type === "Observation"); assert.ok(observation);
  const researcherOutput = { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] };
  assert.equal((await authority.executePreparedAttempt(researcher, { complete: () => wire(researcherOutput, `${label}-researcher`, "2026-08-26T00:01:03.000Z") }, "2026-08-26T00:01:02.000Z")).outcome, "WINNER");
  const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
  const evidence = analyst.entries.find((entry) => entry.type === "EvidenceRef"); assert.ok(evidence);
  const analystOutput = { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] };
  assert.equal((await authority.executePreparedAttempt(analyst, { complete: () => wire(analystOutput, `${label}-analyst`, "2026-08-26T00:01:05.000Z") }, "2026-08-26T00:01:04.000Z")).outcome, "WINNER");
  const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
  const database = new DatabaseSync(temporary.path);
  let target: ReviewerHandoffTarget; let decision: ProfileContextDecision;
  try {
    target = generateR003ResearcherAnalystHandoff(database, caseId).reviewerTarget;
    decision = decideProfileContextAccess(database, { schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId: `${label}-context`, requestTime: "2026-08-26T00:02:00.000Z", operation: "READ_CONTEXT", caseId, workflowRunId: reviewer.workflowRunId, boardId: reviewer.boardId, boardRevision: reviewer.boardRevision, workflowRevision: reviewer.workflowRevision, profile: "REVIEWER", context: { invocationId: reviewer.invocationId, contextId: reviewer.contextId, contextDigest: reviewer.contextDigest }, target, requestedEntry: null });
  } finally { database.close(); }
  const contract = createReviewerDispositionContract(reviewer, decision);
  assert.equal((await authority.executePreparedAttempt(reviewer, { outputContract: contract, complete: () => wire(reviewerOutput(target), `${label}-reviewer`, "2026-08-26T00:01:07.000Z") }, "2026-08-26T00:01:06.000Z")).outcome, "WINNER");
  return { authority, caseId, reviewer, target, decision, temporary };
}

function candidate(database: DatabaseSync, caseId: CaseId): BoardEntryId {
  const row = database.prepare("SELECT board_entry_id FROM board_entries WHERE case_id = ? AND entry_type = 'EvidenceRef' AND status = 'CANDIDATE'").get(caseId) as Row | undefined;
  assert.ok(row); return parseBoardEntryId(row["board_entry_id"]);
}

function counts(database: DatabaseSync, caseId: CaseId): readonly unknown[] {
  const row = database.prepare(`SELECT board.revision, workflow.state,
    (SELECT count(*) FROM artifacts artifact WHERE artifact.case_id = workflow.case_id) AS artifacts,
    (SELECT count(*) FROM board_entries entry WHERE entry.case_id = workflow.case_id AND entry.entry_type = 'ArtifactRef') AS refs,
    (SELECT count(*) FROM approvals approval WHERE approval.case_id = workflow.case_id) AS approvals
    FROM workflow_runs workflow JOIN boards board ON board.board_id = workflow.board_id WHERE workflow.case_id = ?`).get(caseId) as Row;
  return [row["revision"], row["state"], row["artifacts"], row["refs"], row["approvals"]];
}

test("C2 promotes exact sealed evidence and persists one immutable Writer Artifact before approval", async () => {
  const value = await fixture("c2-writer"); let authority = value.authority;
  try {
    const beforePromotion = authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:08.000Z", profile: "WRITER" });
    const database = new DatabaseSync(value.temporary.path); const candidateId = candidate(database, value.caseId); const before = counts(database, value.caseId); database.close();
    const accepted = authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z");
    authority.close(); authority = openAuthorityDatabase(value.temporary.path);
    assert.deepEqual(authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:10.000Z"), accepted);
    assert.throws(() => authority.beginPreparedAttempt(beforePromotion.invocationId, "2026-08-26T00:01:10.000Z"), /stale/u);
    const writer = authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" });
    const raw = new DatabaseSync(value.temporary.path); const reviewerMaterialization = reconstructGenericWinnerMaterialization(raw, value.reviewer.invocationId); assert.ok(reviewerMaterialization); const h1 = parseReviewerDispositionHandoff(reviewerMaterialization); const contract = createWriterArtifactContract(raw, writer, h1);
    assert.throws(() => contract.materialize(writer, { materialAssertions: [{ statement: "Candidate material", basisEntryId: candidateId }] }), /basis is missing/u);
    assert.throws(() => contract.materialize(writer, { materialAssertions: [{ statement: "Adverse material", basisEntryId: h1.verificationResult.entryId }] }), /basis is missing/u);
    assert.throws(() => contract.materialize(writer, { materialAssertions: [{ statement: "Missing material", basisEntryId: `entry_${"0".repeat(64)}` }] }), /basis is missing/u);
    assert.throws(() => contract.materialize(writer, { materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }], extra: true }), /unsupported or missing field/u);
    raw.close();
    const output = { materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] };
    const outcome = await authority.executePreparedAttempt(writer, { outputContract: contract, complete: () => wire(output, "c2-writer", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z");
    assert.equal(outcome.outcome, "WINNER"); assert.ok(outcome.materialization); assert.equal(outcome.materialization.schemaVersion, WRITER_MATERIALIZATION_SCHEMA_VERSION); assert.equal(outcome.materialization.boardEntries.length, 1); assert.equal(outcome.materialization.boardEntries[0]?.entryType, "ArtifactRef");
    const inspected = new DatabaseSync(value.temporary.path);
    assert.deepEqual(counts(inspected, value.caseId), [Number(before[0]) + 2, "WAIT_FOR_APPROVAL", 1, 1, 0]);
    const artifact = parseWriterArtifactAuthority(inspected, writer, outcome.materialization, h1); const row = inspected.prepare("SELECT * FROM artifacts WHERE source_result_id = ?").get(outcome.resultId) as Row;
    assert.deepEqual([row["artifact_id"], row["artifact_digest"], row["reviewer_handoff_id"], row["reviewer_result_id"]], [artifact.artifactId, artifact.artifactDigest, artifact.reviewerHandoffId, artifact.reviewerResultId]);
    assert.throws(() => inspected.prepare("UPDATE artifacts SET content_markdown = 'tampered'").run(), /immutable/u); inspected.close();
    authority.close(); authority = openAuthorityDatabase(value.temporary.path); authority.close(); authority = openAuthorityDatabase(value.temporary.path);
  } finally { try { authority.close(); } catch {} value.temporary.cleanup(); }
});

test("C2 rolls Artifact, ArtifactRef, H2, and workflow transition back together and recovers once", async () => {
  const value = await fixture("c2-recovery"); let authority = value.authority;
  try {
    const raw = new DatabaseSync(value.temporary.path); const candidateId = candidate(raw, value.caseId); raw.close();
    const accepted = authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z");
    const writer = authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" });
    const setup = new DatabaseSync(value.temporary.path); const reviewerMaterialization = reconstructGenericWinnerMaterialization(setup, value.reviewer.invocationId); assert.ok(reviewerMaterialization); const contract = createWriterArtifactContract(setup, writer, parseReviewerDispositionHandoff(reviewerMaterialization)); setup.exec("CREATE TRIGGER fail_artifact BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT, 'forced artifact failure'); END"); setup.close();
    const output = { materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] };
    await assert.rejects(() => authority.executePreparedAttempt(writer, { outputContract: contract, complete: () => wire(output, "c2-recovery", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z"), /forced artifact failure/u);
    const failed = new DatabaseSync(value.temporary.path); assert.deepEqual(counts(failed, value.caseId).slice(1), ["WRITER", 0, 0, 0]); failed.exec("DROP TRIGGER fail_artifact"); failed.close();
    authority.close(); authority = openAuthorityDatabase(value.temporary.path);
    const recovered = new DatabaseSync(value.temporary.path); assert.deepEqual(counts(recovered, value.caseId).slice(1), ["WAIT_FOR_APPROVAL", 1, 1, 0]); assert.equal(recovered.prepare("SELECT count(*) AS count FROM runtime_opaque_completion_receipts WHERE invocation_id = ?").get(writer.invocationId)?.["count"], 0); recovered.close();
    authority.close(); authority = openAuthorityDatabase(value.temporary.path);
    const replayed = new DatabaseSync(value.temporary.path); assert.deepEqual(counts(replayed, value.caseId).slice(1), ["WAIT_FOR_APPROVAL", 1, 1, 0]); replayed.close();
  } finally { try { authority.close(); } catch {} value.temporary.cleanup(); }
});

test("C2 rejects a forged H1 inside the Writer winner transaction", async () => {
  const value = await fixture("c2-forged-h1");
  try {
    const raw = new DatabaseSync(value.temporary.path); const candidateId = candidate(raw, value.caseId); raw.close();
    const accepted = value.authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z"); const writer = value.authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" });
    const database = new DatabaseSync(value.temporary.path); const reviewerMaterialization = reconstructGenericWinnerMaterialization(database, value.reviewer.invocationId); assert.ok(reviewerMaterialization); const h1 = parseReviewerDispositionHandoff(reviewerMaterialization); const forged = Object.freeze({ ...h1, payloadDigest: "0".repeat(64) }); const contract = createWriterArtifactContract(database, writer, forged); database.close();
    await assert.rejects(() => value.authority.executePreparedAttempt(writer, { outputContract: contract, complete: () => wire({ materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] }, "c2-forged-h1", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z"), /exact durable H1/u);
    const inspected = new DatabaseSync(value.temporary.path); assert.deepEqual(counts(inspected, value.caseId).slice(1), ["WRITER", 0, 0, 0]); inspected.close();
  } finally { try { value.authority.close(); } catch {} value.temporary.cleanup(); }
});

test("C2 startup independently refuses accepted Evidence and sealed tuple corruption", async (t) => {
  for (const mode of ["accepted-row", "candidate-type", "sealed-tuple"] as const) await t.test(mode, async () => {
    const value = await fixture(`c2-${mode}`);
    try {
      const initial = new DatabaseSync(value.temporary.path); const candidateId = candidate(initial, value.caseId); initial.close(); const accepted = value.authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z"); value.authority.close();
      const database = new DatabaseSync(value.temporary.path); const triggerName = mode === "sealed-tuple" ? "approved_synthetic_sources_immutable_update" : "board_entries_immutable_update"; const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?").get(triggerName) as Row; database.exec(`DROP TRIGGER ${triggerName}`);
      if (mode === "accepted-row") database.prepare("UPDATE board_entries SET author_id = 'EVIDENCE_ACCEPTANCE_FORGED' WHERE board_entry_id = ?").run(accepted.entryId);
      else if (mode === "candidate-type") { const row = database.prepare("SELECT * FROM board_entries WHERE board_entry_id = ?").get(candidateId) as Row; const immutable = { authorId: row["author_id"], authorType: row["author_type"], basedOn: JSON.parse(String(row["based_on_json"])), contradicts: JSON.parse(String(row["contradicts_json"])), entryType: "Proposal", instructionAuthority: row["instruction_authority"], payload: JSON.parse(String(row["payload_json"])), sourceRefs: JSON.parse(String(row["source_refs_json"])), status: row["status"], supersedes: JSON.parse(String(row["supersedes_json"])), trustLevel: row["trust_level"], visibility: row["visibility"] }; database.prepare("UPDATE board_entries SET entry_type = 'Proposal', content_digest = ? WHERE board_entry_id = ?").run(digest(immutable), candidateId); }
      else database.prepare("UPDATE approved_synthetic_sources SET locator = 'fixture://policy/forged'").run();
      database.exec(String(trigger["sql"])); database.close();
      assert.throws(() => openAuthorityDatabase(value.temporary.path), (error: unknown) => error instanceof AuthorityStartupError && /accepted EvidenceRef|approved synthetic source manifest member|persisted approved sources|Researcher materialization|Invocation context entry digest/u.test(error.message));
    } finally { try { value.authority.close(); } catch {} value.temporary.cleanup(); }
  });
});

test("schema 9 Writer generic v1 winner upgrades and reopens without manufacturing an Artifact", async () => {
  const value = await fixture("c2-writer-v1"); let authority = value.authority;
  try {
    const initial = new DatabaseSync(value.temporary.path); const candidateId = candidate(initial, value.caseId); initial.close(); const accepted = authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z");
    const writer = authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" }); const setup = new DatabaseSync(value.temporary.path); const reviewer = reconstructGenericWinnerMaterialization(setup, value.reviewer.invocationId); assert.ok(reviewer); const contract = createWriterArtifactContract(setup, writer, parseReviewerDispositionHandoff(reviewer)); setup.close();
    const winner = await authority.executePreparedAttempt(writer, { outputContract: contract, complete: () => wire({ materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] }, "c2-writer-v1", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z"); assert.equal(winner.outcome, "WINNER"); assert.ok(winner.materialization?.handoff);
    const historicalCandidate = { boardEntries: winner.materialization.boardEntries.map(({ entryType, payload, basedOn, sourceRefs }) => ({ entryType, payload, basedOn, sourceRefs })), handoff: { kind: winner.materialization.handoff.kind, version: winner.materialization.handoff.version, payload: winner.materialization.handoff.payload } }; const historical = deriveDurableGenericMaterialization(writer, winner.attemptId, winner.resultId, historicalCandidate); const historicalBytes = JSON.stringify(historical); assert.equal(historical.schemaVersion, GENERIC_MATERIALIZATION_SCHEMA_VERSION); assert.equal("writerArtifact" in historical, false); assert.equal(JSON.stringify(parseDurableGenericMaterialization(writer, winner.attemptId, winner.resultId, JSON.parse(historicalBytes))), historicalBytes);
    authority.close(); const schema9 = new DatabaseSync(value.temporary.path); const correlationId = deriveRuntimeAuditCorrelationId(writer.invocationId); const arrivalAudit = schema9.prepare("SELECT audit_event_id, details_json FROM audit_events WHERE correlation_id = ? AND event_kind GLOB 'RUNTIME_RESULT:WINNER:*'").get(correlationId) as Row; const arrivalDetails = JSON.parse(String(arrivalAudit["details_json"])) as Row; schema9.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify(canonical({ ...arrivalDetails, materialization: historical })), String(arrivalAudit["audit_event_id"]));
    const resolutionAudit = schema9.prepare("SELECT audit_event_id, details_json FROM audit_events WHERE correlation_id = ? AND event_kind GLOB 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:*'").get(correlationId) as Row; const resolutionDetails = JSON.parse(String(resolutionAudit["details_json"])) as Row; schema9.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify(canonical({ ...resolutionDetails, schemaVersion: "accord.runtime-generic-output-resolution/v1", candidate: historicalCandidate })), String(resolutionAudit["audit_event_id"])); schema9.exec("DROP TABLE artifacts"); schema9.prepare("DELETE FROM accord_schema_migrations WHERE version = 10").run(); schema9.exec("PRAGMA user_version = 9"); schema9.close();
    authority = openAuthorityDatabase(value.temporary.path); authority.close(); authority = openAuthorityDatabase(value.temporary.path); const upgraded = new DatabaseSync(value.temporary.path); assert.equal((upgraded.prepare("PRAGMA user_version").get() as Row)["user_version"], 10); assert.equal((upgraded.prepare("SELECT count(*) AS count FROM artifacts").get() as Row)["count"], 0); const reconstructed = reconstructGenericWinnerMaterialization(upgraded, writer.invocationId); assert.equal(JSON.stringify(reconstructed), historicalBytes); upgraded.close();
  } finally { try { authority.close(); } catch {} value.temporary.cleanup(); }
});

test("schema 9 Writer v1 resolution refuses an impossible Writer Artifact field", async () => {
  const value = await fixture("c2-writer-v1-artifact-forgery"); let authority = value.authority;
  try {
    const initial = new DatabaseSync(value.temporary.path); const candidateId = candidate(initial, value.caseId); initial.close(); const accepted = authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z");
    const writer = authority.prepareProfileInvocation({ caseId: value.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" }); const setup = new DatabaseSync(value.temporary.path); const reviewer = reconstructGenericWinnerMaterialization(setup, value.reviewer.invocationId); assert.ok(reviewer); const contract = createWriterArtifactContract(setup, writer, parseReviewerDispositionHandoff(reviewer)); setup.close();
    const winner = await authority.executePreparedAttempt(writer, { outputContract: contract, complete: () => wire({ materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] }, "c2-writer-v1-forged", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z"); assert.equal(winner.outcome, "WINNER"); assert.ok(winner.materialization?.handoff);
    const historicalCandidate = { boardEntries: winner.materialization.boardEntries.map(({ entryType, payload, basedOn, sourceRefs }) => ({ entryType, payload, basedOn, sourceRefs })), handoff: { kind: winner.materialization.handoff.kind, version: winner.materialization.handoff.version, payload: winner.materialization.handoff.payload } }; const historical = deriveDurableGenericMaterialization(writer, winner.attemptId, winner.resultId, historicalCandidate);
    authority.close(); const schema9 = new DatabaseSync(value.temporary.path); const correlationId = deriveRuntimeAuditCorrelationId(writer.invocationId); const arrivalAudit = schema9.prepare("SELECT audit_event_id, details_json FROM audit_events WHERE correlation_id = ? AND event_kind GLOB 'RUNTIME_RESULT:WINNER:*'").get(correlationId) as Row; const arrivalDetails = JSON.parse(String(arrivalAudit["details_json"])) as Row; schema9.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify(canonical({ ...arrivalDetails, materialization: historical })), String(arrivalAudit["audit_event_id"])); const resolutionAudit = schema9.prepare("SELECT audit_event_id, details_json FROM audit_events WHERE correlation_id = ? AND event_kind GLOB 'RUNTIME_GENERIC_OUTPUT_RESOLUTION:*'").get(correlationId) as Row; const resolutionDetails = JSON.parse(String(resolutionAudit["details_json"])) as Row; schema9.prepare("UPDATE audit_events SET details_json = ? WHERE audit_event_id = ?").run(JSON.stringify(canonical({ ...resolutionDetails, schemaVersion: "accord.runtime-generic-output-resolution/v1", candidate: { ...historicalCandidate, writerArtifact: {} } })), String(resolutionAudit["audit_event_id"])); schema9.exec("DROP TABLE artifacts"); schema9.prepare("DELETE FROM accord_schema_migrations WHERE version = 10").run(); schema9.exec("PRAGMA user_version = 9"); schema9.close();
    assert.throws(() => openAuthorityDatabase(value.temporary.path), (error: unknown) => error instanceof AuthorityStartupError && /generic output resolution is invalid/u.test(error.message));
  } finally { try { authority.close(); } catch {} value.temporary.cleanup(); }
});
