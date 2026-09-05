import type {
  AttemptId,
  BoardEntryId,
  BoardId,
  CaseId,
  ContextId,
  InvocationId,
  ResultId,
  WorkflowRunId,
} from "../core/ids.js";
import type { HandoffId } from "../profile-runtime.js";

export const REVIEWER_DISPOSITION_HANDOFF_KIND = "REVIEWER_DISPOSITION" as const;
export const REVIEWER_DISPOSITION_HANDOFF_VERSION = "accord.reviewer-disposition-handoff/v1" as const;

export type ReviewerDisposition =
  | "SUPPORTED"
  | "ISSUE_UNSUPPORTED"
  | "ISSUE_CONTRADICTORY"
  | "ISSUE_INCONCLUSIVE";
export type ReviewerCritiqueIssue =
  | "NONE"
  | "UNSUPPORTED_MATERIAL"
  | "CONTRADICTORY_MATERIAL"
  | "INCONCLUSIVE_VERIFICATION";
export type ReviewerCritiqueSeverity = "NONE" | "MATERIAL";
export type ReviewerVerificationStatus = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface ReviewerTargetRef {
  readonly entryId: BoardEntryId;
  readonly type: "Proposal";
  readonly digest: string;
}
export interface ReviewerCritiqueOutput {
  readonly target: ReviewerTargetRef;
  readonly issue: ReviewerCritiqueIssue;
  readonly severity: ReviewerCritiqueSeverity;
  readonly disposition: ReviewerDisposition;
  readonly rationale: string;
}
export interface ReviewerVerificationOutput {
  readonly target: ReviewerTargetRef;
  readonly method: "CITED_GRAPH_SUPPORT";
  readonly result: ReviewerVerificationStatus;
  readonly supportingEvidenceRefs: readonly BoardEntryId[];
  readonly disposition: ReviewerDisposition;
  readonly rationale: string;
}
export interface ReviewerDispositionOutput {
  readonly critique: ReviewerCritiqueOutput;
  readonly verificationResult: ReviewerVerificationOutput;
}
export interface ReviewerDispositionEntryRef {
  readonly entryId: BoardEntryId;
  readonly contentDigest: string;
}
export interface ReviewerDispositionHandoff {
  readonly schemaVersion: typeof REVIEWER_DISPOSITION_HANDOFF_VERSION;
  readonly handoffId: HandoffId;
  readonly payloadDigest: string;
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly boardId: BoardId;
  readonly boardRevision: number;
  readonly profile: "REVIEWER";
  readonly profileVersion: string;
  readonly outputSchema: string;
  readonly contextId: ContextId;
  readonly contextDigest: string;
  readonly invocationId: InvocationId;
  readonly attemptId: AttemptId;
  readonly resultId: ResultId;
  readonly target: ReviewerTargetRef;
  readonly disposition: ReviewerDisposition;
  readonly critique: ReviewerDispositionEntryRef;
  readonly verificationResult: ReviewerDispositionEntryRef;
}
