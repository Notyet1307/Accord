import assert from "node:assert/strict";
import test from "node:test";
import "../reviewer-disposition.integration.test.js";

import {
  PROFILE_CONTEXT_DECISION_VERSION,
  PROFILE_CONTEXT_VIEW_VERSION,
  type ProfileContextDecision,
} from "../../src/contracts/profile-context.js";
import {
  REVIEWER_DISPOSITION_HANDOFF_KIND,
  REVIEWER_DISPOSITION_HANDOFF_VERSION,
  type ReviewerCritiqueIssue,
  type ReviewerCritiqueSeverity,
  type ReviewerDisposition,
  type ReviewerDispositionOutput,
  type ReviewerTargetRef,
  type ReviewerVerificationStatus,
} from "../../src/contracts/reviewer-disposition.js";
import {
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseContextId,
  parseInvocationId,
  parseResultId,
  parseSourceId,
  parseWorkflowRunId,
  type BoardEntryId,
} from "../../src/core/ids.js";
import { REVIEWER_OUTPUT_SCHEMA, REVIEWER_PROFILE_VERSION } from "../../src/profile-context.js";
import { createReviewerDispositionContract } from "../../src/reviewer-disposition.js";
import {
  NATIVE_BAIZHI_PROVIDER_PORT_VERSION,
  RUNTIME_VERSION,
  type PreparedProfileInvocation,
} from "../../src/researcher-analyst.js";

const hex = (value: string): string => value.repeat(64);
const identifier = (prefix: string, value: string): string => `${prefix}_${hex(value)}`;
const mappings: Record<ReviewerDisposition, readonly [ReviewerCritiqueIssue, ReviewerCritiqueSeverity, ReviewerVerificationStatus]> = {
  SUPPORTED: ["NONE", "NONE", "PASS"],
  ISSUE_UNSUPPORTED: ["UNSUPPORTED_MATERIAL", "MATERIAL", "FAIL"],
  ISSUE_CONTRADICTORY: ["CONTRADICTORY_MATERIAL", "MATERIAL", "FAIL"],
  ISSUE_INCONCLUSIVE: ["INCONCLUSIVE_VERIFICATION", "MATERIAL", "INCONCLUSIVE"],
};

type PureFixture = Readonly<{
  canary: Readonly<{ id: BoardEntryId; digest: string; type: "Proposal" }>;
  decision: ProfileContextDecision;
  evidence: BoardEntryId;
  prepared: PreparedProfileInvocation;
  target: ReviewerTargetRef;
}>;

function fixture(): PureFixture {
  const caseId = parseCaseId(identifier("case", "a"));
  const boardId = parseBoardId(identifier("board", "b"));
  const workflowRunId = parseWorkflowRunId(identifier("run", "c"));
  const reviewerInvocationId = parseInvocationId(identifier("invocation", "d"));
  const analystInvocationId = parseInvocationId(identifier("invocation", "e"));
  const contextId = parseContextId(identifier("context", "f"));
  const root = { id: parseBoardEntryId(identifier("entry", "1")), type: "Proposal" as const, digest: hex("1"), payload: { action: "Synthetic target", supportStatus: "UNSUPPORTED" } };
  const claim = { id: parseBoardEntryId(identifier("entry", "2")), type: "Claim" as const, digest: hex("2"), payload: { statement: "Synthetic claim", unsupported: true } };
  const evidence = { id: parseBoardEntryId(identifier("entry", "3")), type: "EvidenceRef" as const, digest: hex("3"), payload: { locator: "fixture://evidence" } };
  const canary = { id: parseBoardEntryId(identifier("entry", "4")), type: "Proposal" as const, digest: hex("4"), payload: { action: "unrelated broad PreparedInvocation canary" } };
  const contextDigest = hex("5");
  const prepared: PreparedProfileInvocation = {
    approvedSources: [],
    boardId,
    boardRevision: 4,
    caseId,
    contextDigest,
    contextId,
    entries: [root, claim, evidence, canary],
    invocationId: reviewerInvocationId,
    modelId: "fixture-model",
    objective: "",
    outputSchema: REVIEWER_OUTPUT_SCHEMA,
    permissionSummary: {},
    profile: "REVIEWER",
    profileVersion: REVIEWER_PROFILE_VERSION,
    providerPortVersion: NATIVE_BAIZHI_PROVIDER_PORT_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    workflowRevision: 5,
    workflowRunId,
  };
  const target: ReviewerTargetRef = { entryId: root.id, type: "Proposal", digest: root.digest };
  const decision = {
    schemaVersion: PROFILE_CONTEXT_DECISION_VERSION,
    auditEventId: "audit-pure-o04",
    correlationId: "corr-pure-o04",
    requestId: "pure-o04",
    requestFingerprint: hex("6"),
    requestTime: "2026-08-26T00:02:00.000Z",
    operation: "READ_CONTEXT",
    outcome: "ALLOW",
    reason: "CURRENT_CONTEXT",
    value: {
      schemaVersion: PROFILE_CONTEXT_VIEW_VERSION,
      kind: "REVIEWER_CONTEXT",
      caseId,
      workflowRunId,
      boardId,
      boardRevision: prepared.boardRevision,
      workflowRevision: prepared.workflowRevision,
      profile: "REVIEWER",
      profileVersion: REVIEWER_PROFILE_VERSION,
      outputSchema: REVIEWER_OUTPUT_SCHEMA,
      context: { invocationId: reviewerInvocationId, contextId, contextDigest },
      target: {
        boardId,
        caseId,
        invocationId: analystInvocationId,
        proposalBoardRevision: 3,
        proposalDigest: root.digest,
        proposalId: root.id,
        resultId: parseResultId(identifier("result", "7")),
        runId: workflowRunId,
        supportStatus: "UNSUPPORTED",
        workflowNode: "REVIEWER",
      },
      entries: [
        { kind: "BOARD_ENTRY", id: root.id, type: root.type, digest: root.digest, payload: root.payload, basedOn: [claim.id], sourceRefs: [] },
        { kind: "BOARD_ENTRY", id: claim.id, type: claim.type, digest: claim.digest, payload: claim.payload, basedOn: [evidence.id], sourceRefs: [] },
        { kind: "BOARD_ENTRY", id: evidence.id, type: evidence.type, digest: evidence.digest, payload: evidence.payload, basedOn: [], sourceRefs: [parseSourceId(identifier("source", "8"))] },
      ],
    },
  } as unknown as ProfileContextDecision;
  return { canary, decision, evidence: evidence.id, prepared, target };
}

function output(fixtureValue: PureFixture, disposition: ReviewerDisposition, refs: readonly BoardEntryId[] = []): ReviewerDispositionOutput {
  const [issue, severity, result] = mappings[disposition];
  return {
    critique: { target: fixtureValue.target, issue, severity, disposition, rationale: `Critique ${disposition}` },
    verificationResult: { target: fixtureValue.target, method: "CITED_GRAPH_SUPPORT", result, supportingEvidenceRefs: refs, disposition, rationale: `Verification ${disposition}` },
  };
}

function assertDisposition(fixtureValue: PureFixture, disposition: ReviewerDisposition, refs: readonly BoardEntryId[]): void {
  const expected = output(fixtureValue, disposition, refs);
  const candidate = createReviewerDispositionContract(fixtureValue.prepared, fixtureValue.decision).materialize(fixtureValue.prepared, expected);
  assert.deepEqual(candidate.boardEntries, [
    { entryType: "Critique", payload: expected.critique, basedOn: [fixtureValue.target.entryId], sourceRefs: [] },
    { entryType: "VerificationResult", payload: expected.verificationResult, basedOn: [fixtureValue.target.entryId], sourceRefs: refs },
  ]);
  assert.deepEqual(candidate.handoff, {
    kind: REVIEWER_DISPOSITION_HANDOFF_KIND,
    version: REVIEWER_DISPOSITION_HANDOFF_VERSION,
    payload: { target: fixtureValue.target, disposition },
  });
}

test("O04 supported-target", () => {
  const current = fixture();
  assertDisposition(current, "SUPPORTED", [current.evidence]);
});

test("O04 unsupported-material", async (t) => {
  const current = fixture();
  assertDisposition(current, "ISSUE_UNSUPPORTED", []);
  await t.test("ISSUE_INCONCLUSIVE mapping", () => {
    assertDisposition(current, "ISSUE_INCONCLUSIVE", []);
  });
});

test("O04 contradictory-material", () => {
  const current = fixture();
  assertDisposition(current, "ISSUE_CONTRADICTORY", [current.evidence]);
});

test("O04 missing-or-unrelated-context", () => {
  const current = fixture();
  const denied = { ...current.decision, outcome: "DENY", reason: "CONTEXT_NOT_FOUND", value: null } as unknown as ProfileContextDecision;
  assert.throws(() => createReviewerDispositionContract(current.prepared, denied));
  const contract = createReviewerDispositionContract(current.prepared, current.decision);
  const unrelatedTarget: ReviewerTargetRef = { entryId: current.canary.id, type: "Proposal", digest: current.canary.digest };
  const unrelated = output(current, "ISSUE_UNSUPPORTED");
  assert.throws(() => contract.materialize(current.prepared, { ...unrelated, critique: { ...unrelated.critique, target: unrelatedTarget }, verificationResult: { ...unrelated.verificationResult, target: unrelatedTarget } }));
  assert.throws(() => contract.materialize(current.prepared, output(current, "ISSUE_UNSUPPORTED", [current.canary.id])));
});

test("O04 malformed-output", () => {
  const current = fixture();
  const contract = createReviewerDispositionContract(current.prepared, current.decision);
  const valid = output(current, "ISSUE_UNSUPPORTED");
  const { supportingEvidenceRefs: _refs, ...withoutProvenance } = valid.verificationResult;
  const variants: readonly unknown[] = [
    { verificationResult: valid.verificationResult },
    { critique: valid.critique },
    { ...valid, critique: { ...valid.critique, extra: true } },
    { ...valid, verificationResult: withoutProvenance },
    { ...valid, verificationResult: { ...valid.verificationResult, disposition: "SUPPORTED" } },
  ];
  for (const candidate of variants) assert.throws(() => contract.materialize(current.prepared, candidate));
});

test("O04 stale-target", () => {
  const current = fixture();
  const stale = { ...current.prepared, boardRevision: current.prepared.boardRevision + 1 };
  assert.throws(() => createReviewerDispositionContract(stale, current.decision));
});
