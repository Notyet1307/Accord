export {
  NORMALIZED_INTAKE_CONTRACT,
  CORE_DATABASE_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  FIXED_WORKFLOW_DEFINITION,
  CONTRACT_VERSIONS,
} from "./contracts/versions.js";
export { R003_CORE_HANDOFF, serializeR003CoreHandoff } from "./contracts/handoff.js";
export { R003_MAGICCHAT_HANDOFF, serializeR003MagicChatHandoff } from "./contracts/magicchat-handoff.js";
export { normalizeSyntheticIntake, type NormalizedSyntheticIntake } from "./contracts/intake.js";
export {
  MAGICCHAT_APP_WEBSOCKET_CONTRACT,
  MAGICCHAT_SOURCE_COMMIT,
  normalizeMagicChatEnvelope,
  type NormalizedMagicChatEnvelope,
  type NormalizedMagicChatMessageCreated,
  type NormalizedMagicChatResponse,
} from "./contracts/magicchat.js";
export type {
  AuditCorrelationId,
  AuditEventId,
  BoardEntryId,
  BoardId,
  CaseId,
  InboxDeliveryId,
  InboxReceiptId,
  MagicChatMessageRecordId,
  MagicChatRequestEnvelopeId,
  PendingActionId,
  WaitChallengeId,
  WorkflowRunId,
} from "./core/ids.js";
export {
  MagicChatProtocolAdapter,
  type MagicChatAckRequest,
  type MagicChatChallengeSnapshot,
  type MagicChatMessageSendRequest,
  type MagicChatPendingRequest,
  type MagicChatProtocolResult,
  type MagicChatProtocolSnapshot,
  type MagicChatQuestionSnapshot,
  type MagicChatRequestEnvelope,
  type MagicChatWorkflowState,
} from "./magicchat/adapter.js";
export {
  DeterministicMagicChatSimulator,
  type DeterministicMagicChatSimulatorOptions,
  type SimulatedMagicChatAckResponse,
  type SimulatedMagicChatMessageResponse,
  type SimulatedMagicChatResponse,
} from "./magicchat/simulator.js";
export {
  AuthorityDatabase,
  AuthorityStartupError,
  openAuthorityDatabase,
  type IntakeTransactionResult,
  type PersistedInboxDelivery,
  type PersistedIntakeAuthority,
  type SqlitePragmaState,
} from "./persistence/sqlite-authority.js";
