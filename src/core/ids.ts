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

const PREFIXES = {
  auditEvent: "audit",
  board: "board",
  case: "case",
  correlation: "corr",
  delivery: "delivery",
  receipt: "receipt",
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
  const receiptId = derive<"InboxReceiptId">(PREFIXES.receipt, "inbox-receipt", [input.appId, String(input.cursor)]);
  const auditCorrelationId = derive<"AuditCorrelationId">(PREFIXES.correlation, "intake-correlation", [receiptId, input.payloadDigest]);
  const auditEventId = derive<"AuditEventId">(PREFIXES.auditEvent, "audit-event", [auditCorrelationId, "INTAKE_COMMITTED"]);

  return { auditCorrelationId, auditEventId, boardId, caseId, receiptId, workflowRunId };
}

export function deriveInboxDeliveryId(input: {
  readonly receiptId: InboxReceiptId;
  readonly envelopeEventId: string;
}): InboxDeliveryId {
  return derive<"InboxDeliveryId">(PREFIXES.delivery, "inbox-delivery", [input.receiptId, input.envelopeEventId]);
}

const BUSINESS_ID_PATTERNS = {
  auditEventId: /^audit_[0-9a-f]{64}$/u,
  auditCorrelationId: /^corr_[0-9a-f]{64}$/u,
  boardId: /^board_[0-9a-f]{64}$/u,
  caseId: /^case_[0-9a-f]{64}$/u,
  deliveryId: /^delivery_[0-9a-f]{64}$/u,
  receiptId: /^receipt_[0-9a-f]{64}$/u,
  workflowRunId: /^run_[0-9a-f]{64}$/u,
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
