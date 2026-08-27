export const CORE_HANDOFF_VERSION = "accord.r003-core-handoff/v1" as const;
export const NORMALIZED_INTAKE_CONTRACT = "accord.normalized-synthetic-intake/v1" as const;
export const CORE_DATABASE_SCHEMA_VERSION = 1 as const;
export const DATABASE_SCHEMA_VERSION = 2 as const;
export const MIGRATION_ID = "001_r003_authority_core" as const;
export const MIGRATION_FILE = "migrations/001_r003_authority_core.sql" as const;
export const MAGICCHAT_INGRESS_MIGRATION_ID = "002_r003_magicchat_ingress" as const;
export const MAGICCHAT_INGRESS_MIGRATION_FILE = "migrations/002_r003_magicchat_ingress.sql" as const;
export const FIXED_WORKFLOW_DEFINITION = "r003-fixed/v1" as const;
export const FIXED_WORKFLOW_DEFINITION_ID = "workflow_definition_r003_fixed_v1" as const;

export const CORE_CONTRACT_VERSIONS = Object.freeze({
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

export const CONTRACT_VERSIONS = Object.freeze({
  ...CORE_CONTRACT_VERSIONS,
  magicChatInboxState: "accord.magicchat-inbox-state/v1",
  magicChatMessage: "accord.magicchat-message/v1",
  magicChatRpcAction: "accord.magicchat-rpc-action/v1",
  waitChallenge: "accord.wait-challenge/v1",
} as const);

export const CORE_TRANSACTION_AUTHORITY_TABLES = Object.freeze([
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

export const TRANSACTION_AUTHORITY_TABLES = Object.freeze([
  ...CORE_TRANSACTION_AUTHORITY_TABLES,
  "magicchat_inbox_states",
  "wait_challenges",
  "magicchat_rpc_actions",
  "magicchat_messages",
] as const);

export const SQLITE_PRAGMAS = Object.freeze({
  journalMode: "wal",
  foreignKeys: true,
  synchronous: "full",
  busyTimeoutMs: 5_000,
} as const);
