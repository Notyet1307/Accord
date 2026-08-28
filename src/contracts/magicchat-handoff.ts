import { MAGICCHAT_INGRESS_MIGRATION_SHA256, MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT, MIGRATION_SCHEMA_FINGERPRINT, MIGRATION_SHA256 } from "./handoff.js";
import { MAGICCHAT_APP_WEBSOCKET_CONTRACT, MAGICCHAT_SOURCE_COMMIT } from "./magicchat.js";
import { CORE_HANDOFF_VERSION, MAGICCHAT_INGRESS_MIGRATION_FILE, MAGICCHAT_INGRESS_MIGRATION_ID, MIGRATION_FILE, MIGRATION_ID } from "./versions.js";

/** Immutable Issue 11 prerequisite snapshot; it is deliberately not upgraded by Issue 12. */
export const MAGICCHAT_HANDOFF_VERSION = "accord.r003-magicchat-handoff/v1" as const;
export const R003_MAGICCHAT_HANDOFF = Object.freeze({
  handoffVersion: MAGICCHAT_HANDOFF_VERSION, prerequisiteHandoffVersion: CORE_HANDOFF_VERSION, databaseSchemaVersion: 2,
  migrations: Object.freeze([Object.freeze({ version: 1, id: MIGRATION_ID, file: MIGRATION_FILE, sha256: MIGRATION_SHA256, schemaFingerprint: MIGRATION_SCHEMA_FINGERPRINT }), Object.freeze({ version: 2, id: MAGICCHAT_INGRESS_MIGRATION_ID, file: MAGICCHAT_INGRESS_MIGRATION_FILE, sha256: MAGICCHAT_INGRESS_MIGRATION_SHA256, schemaFingerprint: MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT })]),
  contractVersions: Object.freeze({ approval: "accord.approval/v1", auditEvent: "accord.audit-event/v1", board: "accord.board/v1", boardEntry: "accord.board-entry/v1", case: "accord.case/v1", inboxDelivery: "accord.inbox-delivery/v1", inboxReceipt: "accord.inbox-receipt/v1", pendingSideEffect: "accord.pending-side-effect/v1", responseClaim: "accord.response-claim/v1", runtimeInvocation: "accord.runtime-invocation/v1", workflowRun: "accord.workflow-run/v1", magicChatInboxState: "accord.magicchat-inbox-state/v1", magicChatMessage: "accord.magicchat-message/v1", magicChatRpcAction: "accord.magicchat-rpc-action/v1", waitChallenge: "accord.wait-challenge/v1" }),
  transactionAuthority: Object.freeze(["cases", "boards", "workflow_runs", "inbox_receipts", "inbox_deliveries", "board_entries", "runtime_invocations", "approvals", "response_claims", "pending_side_effects", "audit_events", "magicchat_inbox_states", "wait_challenges", "magicchat_rpc_actions", "magicchat_messages"]),
  magicChat: Object.freeze({ sourceRepository: "chaitin/MagicChat", sourceCommit: MAGICCHAT_SOURCE_COMMIT, appWebSocketContract: MAGICCHAT_APP_WEBSOCKET_CONTRACT, networkEnabled: false }),
  receiptIdentity: Object.freeze(["app_id", "cursor"] as const), clarification: Object.freeze({ challengeVersion: 1, expectedInputContract: "accord.clarification-answer/plain-text/v1", ttlMilliseconds: 86_400_000, requestIdentityParts: Object.freeze(["case_id", "workflow_run_id", "challenge_version", "CLARIFICATION"] as const) }),
  cumulativeAck: Object.freeze({ intentState: "ACK_INTENT", confirmedState: "ACK_CONFIRMED", lowerCursorGate: true }), downstreamHandoff: Object.freeze({ consumerIssue: 12, sameCase: true, sameRun: true, workflowNode: "RESEARCHER" }), primarySeamClaims: Object.freeze({ realMagicChatResourceCreated: false, scenarioS1Passed: false, scenarioS2Passed: false }),
} as const);
export function serializeR003MagicChatHandoff(): string { return `HANDOFF ${JSON.stringify(R003_MAGICCHAT_HANDOFF)}`; }
