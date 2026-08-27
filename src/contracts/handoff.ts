import {
  CONTRACT_VERSIONS,
  CORE_HANDOFF_VERSION,
  DATABASE_SCHEMA_VERSION,
  FIXED_WORKFLOW_DEFINITION,
  MIGRATION_FILE,
  MIGRATION_ID,
  NORMALIZED_INTAKE_CONTRACT,
  SQLITE_PRAGMAS,
  TRANSACTION_AUTHORITY_TABLES,
} from "./versions.js";

export const MIGRATION_SHA256 = "5bc684c4613fc5c8bb1abf4ec2fdd0f3d717fb0ea4b5e8b62771867d440e9cbe" as const;
export const MIGRATION_SCHEMA_FINGERPRINT =
  "943d8f01887669ea34c79d5b4931c0b258ad878198e3a879820e0da915641ddd" as const;

export const R003_CORE_HANDOFF = Object.freeze({
  handoffVersion: CORE_HANDOFF_VERSION,
  normalizedIntakeContract: NORMALIZED_INTAKE_CONTRACT,
  contractVersions: CONTRACT_VERSIONS,
  databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
  migration: Object.freeze({
    id: MIGRATION_ID,
    file: MIGRATION_FILE,
    sha256: MIGRATION_SHA256,
    schemaFingerprint: MIGRATION_SCHEMA_FINGERPRINT,
  }),
  fixedWorkflowDefinition: FIXED_WORKFLOW_DEFINITION,
  transactionAuthority: TRANSACTION_AUTHORITY_TABLES,
  sqlitePragmas: SQLITE_PRAGMAS,
} as const);

export function serializeR003CoreHandoff(): string {
  return `HANDOFF ${JSON.stringify(R003_CORE_HANDOFF)}`;
}
