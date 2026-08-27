export const CORE_HANDOFF_VERSION = "accord.r003-core-handoff/v1" as const;
export const NORMALIZED_INTAKE_CONTRACT = "accord.normalized-synthetic-intake/v1" as const;
export const DATABASE_SCHEMA_VERSION = 1 as const;
export const MIGRATION_ID = "001_r003_authority_core" as const;
export const MIGRATION_FILE = "migrations/001_r003_authority_core.sql" as const;
export const FIXED_WORKFLOW_DEFINITION = "r003-fixed/v1" as const;
export const FIXED_WORKFLOW_DEFINITION_ID = "workflow_definition_r003_fixed_v1" as const;

export const CONTRACT_VERSIONS = Object.freeze({
  approval: "accord.approval/v1",
  auditEvent: "accord.audit-event/v1",
  board: "accord.board/v1",
  boardEntry: "accord.board-entry/v1",
  case: "accord.case/v1",
  inboxDelivery: "accord.inbox-delivery/v1",
  inboxReceipt: "accord.inbox-receipt/v1",
  pendingSideEffect: "accord.pending-side-effect/v1",
  responseClaim: "accord.response-claim/v1",
  runtimeInvocation: "accord.runtime-invocation/v1",
  workflowRun: "accord.workflow-run/v1",
} as const);

export const TRANSACTION_AUTHORITY_TABLES = Object.freeze([
  "cases",
  "boards",
  "workflow_runs",
  "inbox_receipts",
  "inbox_deliveries",
  "board_entries",
  "runtime_invocations",
  "approvals",
  "response_claims",
  "pending_side_effects",
  "audit_events",
] as const);

export const SQLITE_PRAGMAS = Object.freeze({
  journalMode: "wal",
  foreignKeys: true,
  synchronous: "full",
  busyTimeoutMs: 5_000,
} as const);
