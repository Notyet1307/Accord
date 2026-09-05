import type { AuditCorrelationId, AuditEventId, BoardEntryId, BoardId, CaseId, ContextId, InvocationId, SourceId, WorkflowRunId } from "../core/ids.js";
import type { ReviewerHandoffTarget } from "./researcher-analyst-handoff.js";
export const PROFILE_CONTEXT_REQUEST_VERSION = "accord.profile-context-request/v1" as const;
export const PROFILE_CONTEXT_DECISION_VERSION = "accord.profile-context-decision/v1" as const;
export const PROFILE_CONTEXT_VIEW_VERSION = "accord.profile-context-view/v1" as const;
export const PROFILE_CONTEXT_AUDIT_EVENT_KIND = "PROFILE_CONTEXT_DECISION" as const;
export type ProfileContextProfile = "REVIEWER" | "WRITER";
export type ProfileContextOperation =
  | "READ_CONTEXT" | "READ_BOARD_ENTRY"
  | "READ_CREDENTIALS" | "READ_HIDDEN_REASONING" | "READ_PRIVATE_RUNTIME_HISTORY" | "READ_UNRELATED_SOURCE"
  | "APPEND_EVIDENCE" | "MUTATE_TARGET" | "CREATE_APPROVAL" | "PUBLISH_RESPONSE"
  | "SET_ARTIFACT_ELIGIBILITY" | "MUTATE_WORKFLOW_INSTRUCTIONS";
export type ProfileContextDecisionReason =
  | "CURRENT_CONTEXT" | "CONTEXT_NOT_FOUND" | "CONTEXT_BINDING_MISMATCH" | "STALE_CONTEXT"
  | "TARGET_MISMATCH" | "INCOMPLETE_CITED_GRAPH" | "ENTRY_OUTSIDE_CONTEXT"
  | "PROTECTED_RESOURCE" | "AUTHORITY_ESCALATION" | "OPERATION_NOT_ALLOWED";
export type ProfileContextEntryType = "Proposal" | "Claim" | "Observation" | "EvidenceRef" | "Critique" | "VerificationResult";
export interface ProfileContextEntryRef {
  readonly id: BoardEntryId; readonly type: ProfileContextEntryType; readonly digest: string;
}
export interface ProfileContextIdentity {
  readonly invocationId: InvocationId; readonly contextId: ContextId; readonly contextDigest: string;
}
export interface ProfileContextDecisionRequest {
  readonly schemaVersion: typeof PROFILE_CONTEXT_REQUEST_VERSION;
  readonly requestId: string;
  readonly requestTime: string;
  readonly operation: ProfileContextOperation;
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly boardId: BoardId;
  readonly boardRevision: number;
  readonly workflowRevision: number;
  readonly profile: ProfileContextProfile;
  readonly context: ProfileContextIdentity;
  readonly target: ReviewerHandoffTarget;
  readonly requestedEntry: ProfileContextEntryRef | null;
}
export interface ProjectedProfileContextEntry extends ProfileContextEntryRef {
  readonly kind: "BOARD_ENTRY"; readonly payload: Readonly<Record<string, unknown>>;
  readonly basedOn: readonly BoardEntryId[]; readonly sourceRefs: readonly (BoardEntryId | SourceId)[];
}
interface ProfileContextViewIdentity {
  readonly schemaVersion: typeof PROFILE_CONTEXT_VIEW_VERSION;
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly boardId: BoardId;
  readonly boardRevision: number;
  readonly workflowRevision: number;
  readonly context: ProfileContextIdentity;
  readonly target: ReviewerHandoffTarget;
}
export interface ReviewerContextView extends ProfileContextViewIdentity {
  readonly kind: "REVIEWER_CONTEXT";
  readonly profile: "REVIEWER";
  readonly profileVersion: string;
  readonly outputSchema: string;
  readonly entries: readonly ProjectedProfileContextEntry[];
}
export interface WriterContextBoundary extends ProfileContextViewIdentity {
  readonly kind: "WRITER_BOUNDARY";
  readonly profile: "WRITER";
  readonly profileVersion: string;
  readonly outputSchema: string;
  readonly entries: readonly ProfileContextEntryRef[];
  readonly outputAvailable: false;
}
export type ProfileContextDecisionValue = ReviewerContextView | WriterContextBoundary | ProjectedProfileContextEntry;
export interface ProfileContextDecision {
  readonly schemaVersion: typeof PROFILE_CONTEXT_DECISION_VERSION;
  readonly auditEventId: AuditEventId;
  readonly correlationId: AuditCorrelationId;
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly requestTime: string;
  readonly operation: ProfileContextOperation;
  readonly outcome: "ALLOW" | "DENY";
  readonly reason: ProfileContextDecisionReason;
  readonly value: ProfileContextDecisionValue | null;
}
