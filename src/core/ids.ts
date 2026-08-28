import { createHash } from "node:crypto";

declare const businessIdBrand: unique symbol;

type BusinessId<Kind extends string> = string & {
  readonly [businessIdBrand]: Kind;
};

export type CaseId = BusinessId<"CaseId">;
export type BoardId = BusinessId<"BoardId">;
export type WorkflowRunId = BusinessId<"WorkflowRunId">;
export type InboxReceiptId = BusinessId<"InboxReceiptId">;
export type InboxDeliveryId = BusinessId<"InboxDeliveryId">;
export type AuditEventId = BusinessId<"AuditEventId">;
export type AuditCorrelationId = BusinessId<"AuditCorrelationId">;
export type BoardEntryId = BusinessId<"BoardEntryId">;
export type WaitChallengeId = BusinessId<"WaitChallengeId">;
export type PendingActionId = BusinessId<"PendingActionId">;
export type MagicChatMessageRecordId = BusinessId<"MagicChatMessageRecordId">;
export type MagicChatRequestEnvelopeId = BusinessId<"MagicChatRequestEnvelopeId">;
export type InvocationId = BusinessId<"InvocationId">;
export type AttemptId = BusinessId<"AttemptId">;
export type ResultId = BusinessId<"ResultId">;
export type ArrivalId = BusinessId<"ArrivalId">;
export type ContextId = BusinessId<"ContextId">;
export type SourceId = BusinessId<"SourceId">;
export type ResponseId = BusinessId<"ResponseId">;
export type ProviderDeliveryId = BusinessId<"ProviderDeliveryId">;
export type OpaqueCompletionReceiptId = BusinessId<"OpaqueCompletionReceiptId">;

const PREFIXES = {
  auditEvent: "audit",
  action: "action",
  board: "board",
  case: "case",
  challenge: "challenge",
  correlation: "corr",
  delivery: "delivery",
  entry: "entry",
  magicChatMessage: "mc_message",
  receipt: "receipt",
  request: "request",
  run: "run",
  invocation: "invocation",
  attempt: "attempt",
  result: "result",
  arrival: "arrival",
  context: "context",
  response: "response",
  opaqueReceipt: "opaque",
} as const;

/*
 * Runtime IDs were introduced with the Issue 12 candidate using this exact
 * preimage.  Keep it here, rather than reimplementing it at every runtime
 * call-site: persisted candidates and public handoffs must remain
 * reproducible.
 */
/** The sole private derivation authority.  Legacy preimages stay reproducible. */
function deriveIdentity<Kind extends string>(prefix: string, namespace: string, parts: readonly string[], family: "business" | "runtime"): BusinessId<Kind> {
  const hash = createHash("sha256");
  if (family === "runtime") hash.update(`accord.r003/${namespace}\\0${JSON.stringify(parts)}`, "utf8");
  else hash.update("accord.r003.business-id/v1\0", "utf8").update(namespace, "utf8").update("\0", "utf8").update(JSON.stringify(parts), "utf8");
  return `${prefix}_${hash.digest("hex")}` as BusinessId<Kind>;
}
function deriveRuntime<Kind extends string>(prefix: string, namespace: string, parts: readonly string[]): BusinessId<Kind> { return deriveIdentity<Kind>(prefix, namespace, parts, "runtime"); }

export function deriveProfileInvocationId(input: { readonly caseId: CaseId; readonly workflowRunId: WorkflowRunId; readonly nodeId: string; readonly profileVersion: string; readonly contextDigest: string }): InvocationId {
  return deriveRuntime<"InvocationId">(PREFIXES.invocation, "runtime-invocation", [input.caseId, input.workflowRunId, input.nodeId, input.profileVersion, input.contextDigest]);
}
export function deriveRuntimeAttemptId(input: { readonly invocationId: InvocationId; readonly attemptNumber: 1 | 2 }): AttemptId {
  return deriveRuntime<"AttemptId">(PREFIXES.attempt, "runtime-attempt", [input.invocationId, String(input.attemptNumber)]);
}
export function deriveRuntimeResultId(input: { readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly outputDigest: string }): ResultId {
  return deriveRuntime<"ResultId">(PREFIXES.result, "runtime-result", [input.invocationId, input.attemptId, input.outputDigest]);
}
/** Physical provider envelopes deliberately retain their own identity. */
export function deriveRuntimeResponseId(input: { readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly envelopeDigest: string }): ResponseId {
  return deriveRuntime<"ResponseId">(PREFIXES.response, "runtime-physical-response", [input.invocationId, input.attemptId, input.envelopeDigest]);
}
/** Each completion delivery has an identity even when it reuses a physical wire. */
export function deriveRuntimeProviderDeliveryId(input: { readonly attemptId: AttemptId; readonly receiptBinding: string }): ProviderDeliveryId {
  return deriveRuntime<"ProviderDeliveryId">(PREFIXES.delivery, "runtime-provider-delivery", [input.attemptId, input.receiptBinding]);
}
/** A crash-only opaque receipt is distinct for every Provider delivery. */
export function deriveRuntimeOpaqueCompletionReceiptId(input: { readonly attemptId: AttemptId; readonly receiptBinding: string }): OpaqueCompletionReceiptId {
  return deriveRuntime<"OpaqueCompletionReceiptId">(PREFIXES.opaqueReceipt, "runtime-opaque-completion-receipt", [input.attemptId, input.receiptBinding]);
}
export function deriveRuntimeArrivalId(input: { readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly arrivalNumber: number }): ArrivalId {
  return deriveRuntime<"ArrivalId">(PREFIXES.arrival, "runtime-result-arrival", [input.invocationId, input.attemptId, String(input.arrivalNumber)]);
}
export function deriveProfileContextId(input: { readonly invocationId: InvocationId }): ContextId {
  return deriveRuntime<"ContextId">(PREFIXES.context, "profile-context", [input.invocationId]);
}
export function deriveRuntimeBoardEntryId(input: { readonly invocationId: InvocationId; readonly entryType: string; readonly index: number }): BoardEntryId {
  return deriveRuntime<"BoardEntryId">(PREFIXES.entry, "board-entry", [input.invocationId, input.entryType, String(input.index)]);
}
export const deriveRuntimeAuditCorrelationId = (invocationId: InvocationId): AuditCorrelationId => deriveRuntime<"AuditCorrelationId">(PREFIXES.correlation, "runtime-correlation", [invocationId]);
export function deriveRuntimeAuditEventId(namespace: "runtime-exhausted" | "runtime-stale", parts: readonly [InvocationId]): AuditEventId;
export function deriveRuntimeAuditEventId(namespace: "runtime-contract-rejected", parts: readonly [AttemptId]): AuditEventId;
export function deriveRuntimeAuditEventId(namespace: "runtime-result-arrival" | "runtime-unknown-arrival", parts: readonly [ArrivalId]): AuditEventId;
/** Each runtime audit namespace is bound to its sole identity family. */
export function deriveRuntimeAuditEventId(namespace: "runtime-exhausted" | "runtime-stale" | "runtime-contract-rejected" | "runtime-result-arrival" | "runtime-unknown-arrival", parts: readonly [InvocationId] | readonly [AttemptId] | readonly [ArrivalId]): AuditEventId {
  return deriveRuntime<"AuditEventId">(PREFIXES.auditEvent, namespace, parts);
}
export function deriveSourceId(input: { readonly sourceKind: string; readonly locator: string; readonly contentDigest: string; readonly observedAt: string }): SourceId {
  return deriveRuntime<"SourceId">("source", "approved-synthetic-source", [input.sourceKind, input.locator, input.contentDigest, input.observedAt]);
}

function derive<Kind extends string>(prefix: string, namespace: string, parts: readonly string[]): BusinessId<Kind> {
  return deriveIdentity<Kind>(prefix, namespace, parts, "business");
}

export interface IntakeBusinessIds {
  readonly caseId: CaseId;
  readonly boardId: BoardId;
  readonly workflowRunId: WorkflowRunId;
  readonly receiptId: InboxReceiptId;
  readonly auditCorrelationId: AuditCorrelationId;
  readonly auditEventId: AuditEventId;
}

export interface ReceiptBusinessIds {
  readonly receiptId: InboxReceiptId;
  readonly auditCorrelationId: AuditCorrelationId;
}

export function deriveReceiptBusinessIds(input: {
  readonly appId: string;
  readonly cursor: number;
  readonly payloadDigest: string;
}): ReceiptBusinessIds {
  const receiptId = derive<"InboxReceiptId">(PREFIXES.receipt, "inbox-receipt", [input.appId, String(input.cursor)]);
  const auditCorrelationId = derive<"AuditCorrelationId">(PREFIXES.correlation, "intake-correlation", [
    receiptId,
    input.payloadDigest,
  ]);
  return { auditCorrelationId, receiptId };
}

export function deriveIntakeBusinessIds(input: {
  readonly appId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly cursor: number;
  readonly payloadDigest: string;
  readonly workflowDefinition: string;
}): IntakeBusinessIds {
  const caseId = derive<"CaseId">(PREFIXES.case, "case", [input.appId, input.conversationId, input.messageId]);
  const boardId = derive<"BoardId">(PREFIXES.board, "board", [caseId]);
  const workflowRunId = derive<"WorkflowRunId">(PREFIXES.run, "workflow-run", [caseId, input.workflowDefinition]);
  const { auditCorrelationId, receiptId } = deriveReceiptBusinessIds(input);
  const auditEventId = derive<"AuditEventId">(PREFIXES.auditEvent, "audit-event", [auditCorrelationId, "INTAKE_COMMITTED"]);

  return { auditCorrelationId, auditEventId, boardId, caseId, receiptId, workflowRunId };
}

export function deriveObservationEntryId(input: {
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly receiptId: InboxReceiptId;
  readonly messageId: string;
}): BoardEntryId {
  return derive<"BoardEntryId">(PREFIXES.entry, "board-entry", [
    input.caseId,
    input.workflowRunId,
    input.receiptId,
    input.messageId,
    "Observation",
  ]);
}

export function deriveInboxDeliveryId(input: {
  readonly receiptId: InboxReceiptId;
  readonly envelopeEventId: string;
}): InboxDeliveryId {
  return derive<"InboxDeliveryId">(PREFIXES.delivery, "inbox-delivery", [input.receiptId, input.envelopeEventId]);
}

export interface ClarificationBusinessIds {
  readonly questionEntryId: BoardEntryId;
  readonly challengeId: WaitChallengeId;
  readonly actionId: PendingActionId;
  readonly requestEnvelopeId: MagicChatRequestEnvelopeId;
  readonly auditEventId: AuditEventId;
}

export function deriveClarificationBusinessIds(input: {
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly auditCorrelationId: AuditCorrelationId;
  readonly challengeVersion: number;
}): ClarificationBusinessIds {
  const version = String(input.challengeVersion);
  const common = [input.caseId, input.workflowRunId, version, "CLARIFICATION"] as const;
  return {
    actionId: derive<"PendingActionId">(PREFIXES.action, "pending-action", common),
    auditEventId: derive<"AuditEventId">(PREFIXES.auditEvent, "audit-event", [
      input.auditCorrelationId,
      "CLARIFICATION_REQUIRED",
    ]),
    challengeId: derive<"WaitChallengeId">(PREFIXES.challenge, "wait-challenge", [
      input.caseId,
      input.workflowRunId,
      version,
    ]),
    questionEntryId: derive<"BoardEntryId">(PREFIXES.entry, "board-entry", [
      input.caseId,
      input.workflowRunId,
      version,
      "Question",
    ]),
    requestEnvelopeId: derive<"MagicChatRequestEnvelopeId">(PREFIXES.request, "magicchat-request", common),
  };
}

export interface AckBusinessIds {
  readonly actionId: PendingActionId;
  readonly requestEnvelopeId: MagicChatRequestEnvelopeId;
  readonly auditEventId: AuditEventId;
}

export function deriveAckBusinessIds(input: {
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly receiptId: InboxReceiptId;
  readonly auditCorrelationId: AuditCorrelationId;
  readonly cursor: number;
}): AckBusinessIds {
  const common = [
    input.caseId,
    input.workflowRunId,
    input.receiptId,
    String(input.cursor),
    "ACK",
  ] as const;
  return {
    actionId: derive<"PendingActionId">(PREFIXES.action, "pending-action", common),
    auditEventId: derive<"AuditEventId">(PREFIXES.auditEvent, "audit-event", [
      input.auditCorrelationId,
      "ACK_INTENT",
    ]),
    requestEnvelopeId: derive<"MagicChatRequestEnvelopeId">(PREFIXES.request, "magicchat-request", common),
  };
}

export function deriveProtocolAuditEventId(
  correlationId: AuditCorrelationId,
  eventKind: string,
): AuditEventId {
  return derive<"AuditEventId">(PREFIXES.auditEvent, "audit-event", [correlationId, eventKind]);
}

export function deriveMagicChatMessageRecordId(input: {
  readonly actionId: PendingActionId;
  readonly messageId: string;
}): MagicChatMessageRecordId {
  return derive<"MagicChatMessageRecordId">(PREFIXES.magicChatMessage, "magicchat-message", [
    input.actionId,
    input.messageId,
  ]);
}

const BUSINESS_ID_PATTERNS = {
  auditEventId: /^audit_[0-9a-f]{64}$/u,
  auditCorrelationId: /^corr_[0-9a-f]{64}$/u,
  boardId: /^board_[0-9a-f]{64}$/u,
  caseId: /^case_[0-9a-f]{64}$/u,
  deliveryId: /^delivery_[0-9a-f]{64}$/u,
  receiptId: /^receipt_[0-9a-f]{64}$/u,
  workflowRunId: /^run_[0-9a-f]{64}$/u,
  boardEntryId: /^entry_[0-9a-f]{64}$/u,
  waitChallengeId: /^challenge_[0-9a-f]{64}$/u,
  pendingActionId: /^action_[0-9a-f]{64}$/u,
  magicChatMessageRecordId: /^mc_message_[0-9a-f]{64}$/u,
  magicChatRequestEnvelopeId: /^request_[0-9a-f]{64}$/u,
  invocationId: /^invocation_[0-9a-f]{64}$/u,
  attemptId: /^attempt_[0-9a-f]{64}$/u,
  resultId: /^result_[0-9a-f]{64}$/u,
  arrivalId: /^arrival_[0-9a-f]{64}$/u,
  contextId: /^context_[0-9a-f]{64}$/u,
  sourceId: /^source_[0-9a-f]{64}$/u,
  responseId: /^response_[0-9a-f]{64}$/u,
} as const;

function parseBusinessId<Kind extends string>(value: unknown, pattern: RegExp, label: string): BusinessId<Kind> {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is not a valid stable business ID`);
  }
  return value as BusinessId<Kind>;
}

export const parseCaseId = (value: unknown): CaseId => parseBusinessId<"CaseId">(value, BUSINESS_ID_PATTERNS.caseId, "caseId");
export const parseBoardId = (value: unknown): BoardId => parseBusinessId<"BoardId">(value, BUSINESS_ID_PATTERNS.boardId, "boardId");
export const parseWorkflowRunId = (value: unknown): WorkflowRunId =>
  parseBusinessId<"WorkflowRunId">(value, BUSINESS_ID_PATTERNS.workflowRunId, "workflowRunId");
export const parseInboxReceiptId = (value: unknown): InboxReceiptId =>
  parseBusinessId<"InboxReceiptId">(value, BUSINESS_ID_PATTERNS.receiptId, "receiptId");
export const parseInboxDeliveryId = (value: unknown): InboxDeliveryId =>
  parseBusinessId<"InboxDeliveryId">(value, BUSINESS_ID_PATTERNS.deliveryId, "deliveryId");
export const parseAuditCorrelationId = (value: unknown): AuditCorrelationId =>
  parseBusinessId<"AuditCorrelationId">(value, BUSINESS_ID_PATTERNS.auditCorrelationId, "auditCorrelationId");
export const parseAuditEventId = (value: unknown): AuditEventId =>
  parseBusinessId<"AuditEventId">(value, BUSINESS_ID_PATTERNS.auditEventId, "auditEventId");
export const parseBoardEntryId = (value: unknown): BoardEntryId =>
  parseBusinessId<"BoardEntryId">(value, BUSINESS_ID_PATTERNS.boardEntryId, "boardEntryId");
export const parseWaitChallengeId = (value: unknown): WaitChallengeId =>
  parseBusinessId<"WaitChallengeId">(value, BUSINESS_ID_PATTERNS.waitChallengeId, "waitChallengeId");
export const parsePendingActionId = (value: unknown): PendingActionId =>
  parseBusinessId<"PendingActionId">(value, BUSINESS_ID_PATTERNS.pendingActionId, "pendingActionId");
export const parseMagicChatMessageRecordId = (value: unknown): MagicChatMessageRecordId =>
  parseBusinessId<"MagicChatMessageRecordId">(
    value,
    BUSINESS_ID_PATTERNS.magicChatMessageRecordId,
    "magicChatMessageRecordId",
  );
export const parseMagicChatRequestEnvelopeId = (value: unknown): MagicChatRequestEnvelopeId =>
  parseBusinessId<"MagicChatRequestEnvelopeId">(
    value,
    BUSINESS_ID_PATTERNS.magicChatRequestEnvelopeId,
    "magicChatRequestEnvelopeId",
  );
export const parseInvocationId = (value: unknown): InvocationId => parseBusinessId<"InvocationId">(value, BUSINESS_ID_PATTERNS.invocationId, "invocationId");
export const parseAttemptId = (value: unknown): AttemptId => parseBusinessId<"AttemptId">(value, BUSINESS_ID_PATTERNS.attemptId, "attemptId");
export const parseResultId = (value: unknown): ResultId => parseBusinessId<"ResultId">(value, BUSINESS_ID_PATTERNS.resultId, "resultId");
export const parseArrivalId = (value: unknown): ArrivalId => parseBusinessId<"ArrivalId">(value, BUSINESS_ID_PATTERNS.arrivalId, "arrivalId");
export const parseContextId = (value: unknown): ContextId => parseBusinessId<"ContextId">(value, BUSINESS_ID_PATTERNS.contextId, "contextId");
export const parseSourceId = (value: unknown): SourceId => parseBusinessId<"SourceId">(value, BUSINESS_ID_PATTERNS.sourceId, "sourceId");
export const parseResponseId = (value: unknown): ResponseId => parseBusinessId<"ResponseId">(value, BUSINESS_ID_PATTERNS.responseId, "responseId");
