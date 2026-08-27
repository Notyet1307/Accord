import {
  MAGICCHAT_INGRESS_MIGRATION_SHA256,
  MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT,
  MIGRATION_SCHEMA_FINGERPRINT,
  MIGRATION_SHA256,
} from "./handoff.js";
import { MAGICCHAT_APP_WEBSOCKET_CONTRACT, MAGICCHAT_SOURCE_COMMIT } from "./magicchat.js";
import {
  CONTRACT_VERSIONS,
  CORE_HANDOFF_VERSION,
  DATABASE_SCHEMA_VERSION,
  MAGICCHAT_INGRESS_MIGRATION_FILE,
  MAGICCHAT_INGRESS_MIGRATION_ID,
  MIGRATION_FILE,
  MIGRATION_ID,
  TRANSACTION_AUTHORITY_TABLES,
} from "./versions.js";

export const MAGICCHAT_HANDOFF_VERSION = "accord.r003-magicchat-handoff/v1" as const;

export const R003_MAGICCHAT_HANDOFF = Object.freeze({
  handoffVersion: MAGICCHAT_HANDOFF_VERSION,
  prerequisiteHandoffVersion: CORE_HANDOFF_VERSION,
  databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
  migrations: Object.freeze([
    Object.freeze({
      version: 1,
      id: MIGRATION_ID,
      file: MIGRATION_FILE,
      sha256: MIGRATION_SHA256,
      schemaFingerprint: MIGRATION_SCHEMA_FINGERPRINT,
    }),
    Object.freeze({
      version: 2,
      id: MAGICCHAT_INGRESS_MIGRATION_ID,
      file: MAGICCHAT_INGRESS_MIGRATION_FILE,
      sha256: MAGICCHAT_INGRESS_MIGRATION_SHA256,
      schemaFingerprint: MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT,
    }),
  ]),
  contractVersions: CONTRACT_VERSIONS,
  transactionAuthority: TRANSACTION_AUTHORITY_TABLES,
  magicChat: Object.freeze({
    sourceRepository: "chaitin/MagicChat",
    sourceCommit: MAGICCHAT_SOURCE_COMMIT,
    appWebSocketContract: MAGICCHAT_APP_WEBSOCKET_CONTRACT,
    networkEnabled: false,
  }),
  receiptIdentity: Object.freeze(["app_id", "cursor"] as const),
  clarification: Object.freeze({
    challengeVersion: 1,
    expectedInputContract: "accord.clarification-answer/plain-text/v1",
    ttlMilliseconds: 86_400_000,
    requestIdentityParts: Object.freeze([
      "case_id",
      "workflow_run_id",
      "challenge_version",
      "CLARIFICATION",
    ] as const),
  }),
  cumulativeAck: Object.freeze({
    intentState: "ACK_INTENT",
    confirmedState: "ACK_CONFIRMED",
    lowerCursorGate: true,
  }),
  downstreamHandoff: Object.freeze({
    consumerIssue: 12,
    sameCase: true,
    sameRun: true,
    workflowNode: "RESEARCHER",
  }),
  primarySeamClaims: Object.freeze({
    realMagicChatResourceCreated: false,
    scenarioS1Passed: false,
    scenarioS2Passed: false,
  }),
} as const);

export function serializeR003MagicChatHandoff(): string {
  return `HANDOFF ${JSON.stringify(R003_MAGICCHAT_HANDOFF)}`;
}
