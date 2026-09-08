import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { TestContext } from "node:test";

import { PROFILE_CONTEXT_REQUEST_VERSION } from "../../src/contracts/profile-context.js";
import { generateR003ResearcherAnalystHandoff } from "../../src/contracts/researcher-analyst-handoff.js";
import { deriveSourceId, parseBoardEntryId, type CaseId, type WorkflowRunId } from "../../src/core/ids.js";
import { MagicChatProtocolAdapter, type MagicChatRequestEnvelope } from "../../src/magicchat/adapter.js";
import { DeterministicMagicChatSimulator, type SimulatedMagicChatMessageResponse } from "../../src/magicchat/simulator.js";
import { openAuthorityDatabase, type AuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { createReviewerDispositionContract, parseReviewerDispositionHandoff } from "../../src/reviewer-disposition.js";
import { decideProfileContextAccess } from "../../src/reviewer-context.js";
import { reconstructGenericWinnerMaterialization, type PreparedProfileInvocation, type ProviderResultArbitration, type ResultArbitration } from "../../src/researcher-analyst.js";
import { createWriterArtifactContract } from "../../src/writer-artifact.js";
import { magicChatMessageCreatedEnvelope, temporaryDatabase, type TemporaryDatabase } from "../fixture.js";

export const C3_NOW = "2026-08-26T00:02:00.000Z";
const source = { content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])) : value;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });

export async function prepareC3Fixture(label: string, context: TestContext) {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-26T00:00:00.000Z") });
  const wire = (output: unknown, requestId: string, receivedAt: string): string => {
    context.mock.timers.setTime(Date.parse(receivedAt));
    return JSON.stringify({ providerMetadata: { deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1", requestId, responseId: `${requestId}-response` }, output, receivedAt, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  };
  const temporary = temporaryDatabase(label);
  let authority;
  try { authority = openAuthorityDatabase(temporary.path); } catch (error) { temporary.cleanup(); throw error; }
  const close = (): void => { try { authority.close(); } catch {} finally { temporary.cleanup(); } };
  try {
    authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app", firstMessageSequence: 2 });
    const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const confirmation = simulator.respond(created.nextRequest, "2026-08-26T00:00:02.000Z");
    assert.ok("message" in confirmation.payload);
    const clarificationId = confirmation.payload.message.id;
    const waiting = protocol.receive(confirmation, "2026-08-26T00:00:03.000Z");
    assert.ok(waiting.nextRequest);
    protocol.receive(simulator.respond(waiting.nextRequest, "2026-08-26T00:00:04.000Z"), "2026-08-26T00:00:04.000Z");
    const answer = magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: `event-${label}`, messageCreatedAt: "2026-08-26T00:01:00Z", messageId: `message-${label}`, messageSequence: 3, replyToMessageId: clarificationId });
    simulator.observeUserMessage(answer);
    const resumed = protocol.receive(answer, "2026-08-26T00:01:01.000Z");
    if (resumed.nextRequest) protocol.receive(simulator.respond(resumed.nextRequest, "2026-08-26T00:01:01.000Z"), "2026-08-26T00:01:01.000Z");
    const caseId = resumed.snapshot.caseId;
    const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
    const observation = researcher.entries.find((entry) => entry.type === "Observation"); assert.ok(observation);
    const research = { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] };
    assert.equal((await authority.executePreparedAttempt(researcher, { complete: () => wire(research, `${label}-researcher`, "2026-08-26T00:01:03.000Z") }, "2026-08-26T00:01:02.000Z")).outcome, "WINNER");
    const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
    const evidence = analyst.entries.find((entry) => entry.type === "EvidenceRef"); assert.ok(evidence);
    const analysis = { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] };
    assert.equal((await authority.executePreparedAttempt(analyst, { complete: () => wire(analysis, `${label}-analyst`, "2026-08-26T00:01:05.000Z") }, "2026-08-26T00:01:04.000Z")).outcome, "WINNER");
    const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
    const raw = new DatabaseSync(temporary.path);
    let reviewContract;
    let target;
    try {
      target = generateR003ResearcherAnalystHandoff(raw, caseId).reviewerTarget;
      const decision = decideProfileContextAccess(raw, { schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId: `${label}-context`, requestTime: "2026-08-26T00:02:00.000Z", operation: "READ_CONTEXT", caseId, workflowRunId: reviewer.workflowRunId, boardId: reviewer.boardId, boardRevision: reviewer.boardRevision, workflowRevision: reviewer.workflowRevision, profile: "REVIEWER", context: { invocationId: reviewer.invocationId, contextId: reviewer.contextId, contextDigest: reviewer.contextDigest }, target, requestedEntry: null });
      reviewContract = createReviewerDispositionContract(reviewer, decision);
    } finally { raw.close(); }
    const reference = { entryId: target.proposalId, type: "Proposal", digest: target.proposalDigest };
    const review = { critique: { target: reference, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal must not become evidence." }, verificationResult: { target: reference, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal has no evidence." } };
    assert.equal((await authority.executePreparedAttempt(reviewer, { outputContract: reviewContract, complete: () => wire(review, `${label}-reviewer`, "2026-08-26T00:01:07.000Z") }, "2026-08-26T00:01:06.000Z")).outcome, "WINNER");
    const candidates = new DatabaseSync(temporary.path);
    let candidateId;
    try { candidateId = parseBoardEntryId(candidates.prepare("SELECT board_entry_id FROM board_entries WHERE case_id = ? AND entry_type = 'EvidenceRef' AND status = 'CANDIDATE'").get(caseId)?.["board_entry_id"]); } finally { candidates.close(); }
    const accepted = authority.acceptSyntheticEvidence(candidateId, "2026-08-26T00:01:09.000Z");
    const writer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" });
    const setup = new DatabaseSync(temporary.path);
    let writerContract;
    try {
      const materialization = reconstructGenericWinnerMaterialization(setup, reviewer.invocationId); assert.ok(materialization);
      writerContract = createWriterArtifactContract(setup, writer, parseReviewerDispositionHandoff(materialization));
    } finally { setup.close(); }
    const completeWriter = () => authority.executePreparedAttempt(writer, { outputContract: writerContract, complete: () => wire({ materialAssertions: [{ statement: source.content, basisEntryId: accepted.entryId }] }, `${label}-writer`, "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z");
    return { authority, protocol, simulator, temporary, caseId, runId: writer.workflowRunId, researcher, analyst, reviewer, writer, completeWriter, close };
  } catch (error) { close(); throw error; }
}

export async function c3Fixture(label: string, context: TestContext) {
  const fixture = await prepareC3Fixture(label, context);
  try {
    const winner = await fixture.completeWriter();
    assert.equal(winner.outcome, "WINNER"); assert.ok(winner.materialization);
    return { ...fixture, winner };
  } catch (error) { fixture.close(); throw error; }
}

export interface PreparedC3Fixture {
  authority: AuthorityDatabase;
  protocol: MagicChatProtocolAdapter;
  simulator: DeterministicMagicChatSimulator;
  temporary: TemporaryDatabase;
  caseId: CaseId;
  runId: WorkflowRunId;
  researcher: PreparedProfileInvocation;
  analyst: PreparedProfileInvocation;
  reviewer: PreparedProfileInvocation;
  writer: PreparedProfileInvocation;
  completeWriter: () => Promise<ProviderResultArbitration>;
  close: () => void;
}
export interface C3Fixture extends PreparedC3Fixture { winner: ResultArbitration; }
export interface C3ApprovalConfirmation {
  request: MagicChatRequestEnvelope;
  card: SimulatedMagicChatMessageResponse["payload"]["message"];
}

export function confirmC3Approval(fixture: C3Fixture): C3ApprovalConfirmation {
  const pending = fixture.protocol.pendingRequests().find(({ request }) => request.method === "message.send");
  assert.ok(pending, "Writer H2 must durably enqueue its approval request");
  const delivered = fixture.protocol.dispatch(pending.request.id, C3_NOW, (request) => fixture.simulator.respond(request, C3_NOW));
  fixture.protocol.receive(delivered, C3_NOW);
  const response = fixture.simulator.respond(pending.request, C3_NOW);
  assert.ok("message" in response.payload);
  return { request: pending.request, card: response.payload.message };
}

export function choiceEnvelope(confirmation: C3ApprovalConfirmation, option = "approve", cursor = 3) {
  return {
    v: 1, id: `choice-delivery-${cursor}`, kind: "event", cursor, event: "choice.response_created",
    payload: {
      conversation: { id: "conversation-1", name: "Synthetic App Conversation", type: "app" },
      choice_message: { id: confirmation.card.id, seq: confirmation.card.seq, body: confirmation.card.body, summary: confirmation.card.summary, created_at: confirmation.card.created_at },
      response: { id: `choice-response-${cursor}`, option_ids: [option], created_at: "2026-08-26T00:02:01.000Z" },
      sender: { id: "actor-1", name: "Synthetic User", nickname: "Synthetic User", type: "user" },
    },
  };
}
