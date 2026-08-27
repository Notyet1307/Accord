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
} as const;

function digestParts(namespace: string, parts: readonly string[]): string {
  return createHash("sha256")
    .update("accord.r003.business-id/v1\0", "utf8")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex");
}

function derive<Kind extends string>(prefix: string, namespace: string, parts: readonly string[]): BusinessId<Kind> {
  return `${prefix}_${digestParts(namespace, parts)}` as BusinessId<Kind>;
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
