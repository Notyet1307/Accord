export const CORE_HANDOFF_VERSION = "accord.r003-core-handoff/v1" as const;
export const NORMALIZED_INTAKE_CONTRACT = "accord.normalized-synthetic-intake/v1" as const;
export const CORE_DATABASE_SCHEMA_VERSION = 1 as const;
/** The generated Researcher/Analyst artifact is a frozen schema-8 handoff. */
export const RESEARCHER_ANALYST_HANDOFF_SCHEMA_VERSION = 8 as const;
export const DATABASE_SCHEMA_VERSION = 12 as const;
export const MIGRATION_ID = "001_r003_authority_core" as const;
export const MIGRATION_FILE = "migrations/001_r003_authority_core.sql" as const;
export const MAGICCHAT_INGRESS_MIGRATION_ID = "002_r003_magicchat_ingress" as const;
export const MAGICCHAT_INGRESS_MIGRATION_FILE = "migrations/002_r003_magicchat_ingress.sql" as const;
export const RESEARCHER_ANALYST_MIGRATION_ID = "003_r003_researcher_analyst" as const;
export const RESEARCHER_ANALYST_MIGRATION_FILE = "migrations/003_r003_researcher_analyst.sql" as const;
export const RESEARCHER_ANALYST_AUTHORITY_REPAIR_MIGRATION_ID = "004_r003_researcher_analyst_authority_repair" as const;
export const RESEARCHER_ANALYST_AUTHORITY_REPAIR_MIGRATION_FILE = "migrations/004_r003_researcher_analyst_authority_repair.sql" as const;
export const RESEARCHER_ANALYST_DURABLE_RECOVERY_MIGRATION_ID = "005_r003_researcher_analyst_durable_recovery" as const;
export const RESEARCHER_ANALYST_DURABLE_RECOVERY_MIGRATION_FILE = "migrations/005_r003_researcher_analyst_durable_recovery.sql" as const;
export const RESEARCHER_ANALYST_LEGACY_ARRIVAL_RECONCILIATION_MIGRATION_ID = "006_r003_researcher_analyst_legacy_arrival_reconciliation" as const;
export const RESEARCHER_ANALYST_LEGACY_ARRIVAL_RECONCILIATION_MIGRATION_FILE = "migrations/006_r003_researcher_analyst_legacy_arrival_reconciliation.sql" as const;
export const RESEARCHER_ANALYST_TERMINAL_DELIVERY_RECOVERY_MIGRATION_ID = "007_r003_terminal_delivery_recovery" as const;
export const RESEARCHER_ANALYST_TERMINAL_DELIVERY_RECOVERY_MIGRATION_FILE = "migrations/007_r003_terminal_delivery_recovery.sql" as const;
export const RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_ID = "008_r003_opaque_completion_receipts" as const;
export const RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_FILE = "migrations/008_r003_opaque_completion_receipts.sql" as const;
export const REVIEWER_WRITER_MIGRATION_ID = "009_r003_reviewer_writer_contexts" as const;
export const REVIEWER_WRITER_MIGRATION_FILE = "migrations/009_r003_reviewer_writer_contexts.sql" as const;
export const REVIEWER_WRITER_MIGRATION_SHA256 = "1bcd2a85cfe61426b00fad2a855f2ab75ba0bbb42640a201ba6a1a3d4d603aba" as const;
export const REVIEWER_WRITER_SCHEMA_FINGERPRINT = "a2ac1ffd0104bd23c092b6bbc6580d737d85953d818f145a6676e339bd942535" as const;
export const WRITER_ARTIFACT_MIGRATION_ID = "010_r003_writer_artifact" as const;
export const WRITER_ARTIFACT_MIGRATION_FILE = "migrations/010_r003_writer_artifact.sql" as const;
export const WRITER_ARTIFACT_MIGRATION_SHA256 = "d1b02b48b2649b93a1cb72e13feabaf6a753e85e90e61f47f5b6ef515db55d3a" as const;
export const WRITER_ARTIFACT_SCHEMA_FINGERPRINT = "2c9959096d550c9ea06cdf9ac8f598286a55bdf3194c12185bf74d9284a19fd0" as const;
export const APPROVAL_PUBLICATION_MIGRATION_ID = "011_r003_approval_publication" as const;
export const APPROVAL_PUBLICATION_MIGRATION_FILE = "migrations/011_r003_approval_publication.sql" as const;
export const APPROVAL_PUBLICATION_MIGRATION_SHA256 = "571a457be5caa191516228613d91807d86757dae66b24ce5db374385682ed6f3" as const;
export const APPROVAL_PUBLICATION_SCHEMA_FINGERPRINT = "61ee78bc324397d880158910a563a2694a737d48c7cd285139d8eb59fa9a90b6" as const;
export const FROZEN_RUNTIME_CONFIG_MIGRATION_ID = "012_r003_frozen_runtime_config" as const;
export const FROZEN_RUNTIME_CONFIG_MIGRATION_FILE = "migrations/012_r003_frozen_runtime_config.sql" as const;
export const FROZEN_RUNTIME_CONFIG_MIGRATION_SHA256 = "10cadf12104ada8862e0bdb2c8e1cef26aea9dedb7c5b845661712da2f581a69" as const;
export const FROZEN_RUNTIME_CONFIG_SCHEMA_FINGERPRINT = "3d7aef0881aa3c420b2b1ce4cfc660c67f2ab215214c350ac738bd05f549fa6e" as const;
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
  artifact: "accord.artifact/v1",
  approvalChallenge: "accord.approval-challenge/v1",
  publicationFreshness: "accord.publication-freshness/v1",
  ...CORE_CONTRACT_VERSIONS,
  magicChatInboxState: "accord.magicchat-inbox-state/v1",
  magicChatMessage: "accord.magicchat-message/v1",
  magicChatRpcAction: "accord.magicchat-rpc-action/v1",
  waitChallenge: "accord.wait-challenge/v1",
  frozenRuntimeConfiguration: "accord.frozen-runtime-config/v1",
  invocationRuntimeConfiguration: "accord.invocation-runtime-config/v1",
  runRuntimeConfiguration: "accord.run-runtime-config/v1",
  profileContext: "accord.profile-context/v1",
  runtimeAttempt: "accord.runtime-attempt/v1",
  runtimeResult: "accord.runtime-result/v1",
  runtimeResultArrival: "accord.runtime-result-arrival/v1",
  runtimePhysicalResponse: "accord.runtime-physical-response/v1",
  /** v1 is accepted only for classified pre-v7 receipts during migration. */
  runtimeProviderDelivery: "accord.runtime-provider-delivery/v2",
  runtimeOpaqueCompletionReceipt: "accord.runtime-opaque-completion-receipt/v1",
  approvedSyntheticSource: "accord.approved-synthetic-source/v1",
} as const);

export const F1_TRANSACTION_AUTHORITY_TABLES = Object.freeze([
  "runtime_configurations", "run_runtime_configurations", "invocation_runtime_configurations",
] as const);

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
  ...F1_TRANSACTION_AUTHORITY_TABLES,
  "magicchat_inbox_states",
  "wait_challenges",
  "magicchat_rpc_actions",
  "magicchat_messages",
  "profile_contexts",
  "runtime_attempts",
  "runtime_results",
  "runtime_result_arrivals",
  "approved_synthetic_sources",
  "runtime_physical_responses",
  "runtime_result_entries",
  "approved_synthetic_source_manifests",
  "runtime_legacy_reconciliation",
  "runtime_provider_deliveries",
  "runtime_delivery_arrivals",
  "runtime_opaque_completion_receipts",
  "artifacts",
  "approval_challenges",
  "publication_freshness",
  "approval_legacy_provenance",
] as const);

export const SQLITE_PRAGMAS = Object.freeze({
  journalMode: "wal",
  foreignKeys: true,
  synchronous: "full",
  busyTimeoutMs: 5_000,
} as const);
