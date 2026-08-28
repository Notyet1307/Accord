import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { normalizeSyntheticIntake, type NormalizedSyntheticIntake } from "../contracts/intake.js";
import {
  normalizeMagicChatEnvelope,
  parseCanonicalInstant,
  parseMagicChatInstant,
  type NormalizedMagicChatMessageCreated,
} from "../contracts/magicchat.js";
import {
  CONTRACT_VERSIONS,
  CORE_TRANSACTION_AUTHORITY_TABLES,
  DATABASE_SCHEMA_VERSION,
  FIXED_WORKFLOW_DEFINITION,
  FIXED_WORKFLOW_DEFINITION_ID,
  MIGRATION_ID,
  NORMALIZED_INTAKE_CONTRACT,
  SQLITE_PRAGMAS,
} from "../contracts/versions.js";
import {
  deriveInboxDeliveryId,
  deriveAckBusinessIds,
  deriveClarificationBusinessIds,
  deriveIntakeBusinessIds,
  deriveMagicChatMessageRecordId,
  deriveObservationEntryId,
  deriveRuntimeArrivalId,
  deriveRuntimeAuditCorrelationId,
  deriveRuntimeAuditEventId,
  deriveRuntimeResponseId,
  deriveRuntimeResultId,
  deriveSourceId,
  deriveProtocolAuditEventId,
  deriveReceiptBusinessIds,
  parseAuditCorrelationId,
  parseArrivalId,
  parseAttemptId,
  parseInvocationId,
  parseResultId,
  parseAuditEventId,
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseInboxDeliveryId,
  parseInboxReceiptId,
  parseMagicChatMessageRecordId,
  parsePendingActionId,
  parseWaitChallengeId,
  parseWorkflowRunId,
  type AuditCorrelationId,
  type AuditEventId,
  type BoardId,
  type CaseId,
  type InboxDeliveryId,
  type InboxReceiptId,
  type IntakeBusinessIds,
  type InvocationId,
  type WorkflowRunId,
} from "../core/ids.js";
import type {
  MagicChatAckRequest,
  MagicChatChallengeSnapshot,
  MagicChatMessageSendRequest,
  MagicChatPendingRequest,
  MagicChatProtocolResult,
  MagicChatProtocolSnapshot,
  MagicChatQuestionSnapshot,
  MagicChatRequestEnvelope,
} from "../magicchat/adapter.js";
import { loadAuthorityMigrations, type AuthorityMigration } from "./migration.js";
import {
  beginPreparedAttempt,
  commitProviderResult,
  executePreparedAttempt,
  reconcileLegacyRuntimeDeliveries,
  sealLegacyDeliveryProvenance,
  recoverOpaqueCompletionReceipts,
  recoverReceivedRuntimeAttempts,
  prepareProfileInvocation,
  recordUnknownRuntimeArrival,
  reconstructWinnerBoardEntries,
  validateLegacyRuntimeDeliveryChronology,
  validatePersistedRuntimeAuthorityGraph,
  installTrustedSyntheticSourceManifest,
  TRUSTED_SYNTHETIC_SOURCE_INPUT,
  type PreparedAttempt,
  type PreparedProfileInvocation,
  type ProfileInvocationRequest,
  type ProviderPort,
  type ProviderWire,
  type ProviderResultArbitration,
} from "../researcher-analyst.js";
import {
  parsePersistenceRow,
  requireHexDigest,
  requireInteger,
  requireIsoInstant,
  requireLiteral,
  requireOneOf,
  requireString,
  type PersistenceRow,
} from "./rows.js";

const WORKFLOW_NODES = [
  "INTAKE",
  "WAIT_FOR_INPUT",
  "RESEARCHER",
  "ANALYST",
  "REVIEWER",
  "WRITER",
  "WAIT_FOR_APPROVAL",
  "FRESHNESS_CHECK",
  "PUBLISH",
  "COMPLETE",
] as const;
const WORKFLOW_NODES_JSON = JSON.stringify(WORKFLOW_NODES);
const WORKFLOW_NODES_DIGEST = "c3642f68d32c15d7b1940103ebb74b8e2c882beb71499f1871138eebfd987f61";
const CASE_STATUSES = ["OPEN", "COMPLETE", "FAILED", "REJECTED"] as const;
const WORKFLOW_STATES = [
  ...WORKFLOW_NODES,
  "PUBLICATION_HOLD",
  "FAILED",
  "REJECTED",
] as const;

const CLARIFICATION_CHALLENGE_VERSION = 1 as const;
const CLARIFICATION_TTL_MILLISECONDS = 86_400_000;
const CLARIFICATION_EXPECTED_INPUT_CONTRACT = "accord.clarification-answer/plain-text/v1" as const;
const CLARIFICATION_PROMPT = "What decision constraint must the Researcher preserve?" as const;
const CLARIFICATION_QUESTION_PAYLOAD = Object.freeze({
  expectedInputContract: CLARIFICATION_EXPECTED_INPUT_CONTRACT,
  missingInformation: "decision_constraint" as const,
  prompt: CLARIFICATION_PROMPT,
});

const REQUIRED_CORE_SCHEMA_OBJECTS = [
  "accord_schema_migrations",
  "workflow_definitions",
  ...CORE_TRANSACTION_AUTHORITY_TABLES,
] as const;
const REQUIRED_SCHEMA_OBJECTS = [
  ...REQUIRED_CORE_SCHEMA_OBJECTS,
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
  "runtime_provider_deliveries",
  "runtime_delivery_arrivals",
  "runtime_opaque_completion_receipts",
  "runtime_provider_delivery_legacy_provenance",
  "runtime_provider_delivery_legacy_provenance_gate",
] as const;

export interface SqlitePragmaState {
  readonly journalMode: "wal";
  readonly foreignKeys: true;
  readonly synchronous: "full";
  readonly busyTimeoutMs: 5_000;
}

export interface PersistedIntakeAuthority {
  readonly databaseSchemaVersion: typeof DATABASE_SCHEMA_VERSION;
  readonly migrationId: typeof MIGRATION_ID;
  readonly caseId: CaseId;
  readonly boardId: BoardId;
  readonly workflowRunId: WorkflowRunId;
  readonly receiptId: InboxReceiptId;
  readonly auditCorrelationId: AuditCorrelationId;
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: string;
  readonly caseStatus: (typeof CASE_STATUSES)[number];
  readonly boardRevision: number;
  readonly workflowState: (typeof WORKFLOW_STATES)[number];
  readonly workflowRevision: number;
  readonly workflowDefinition: typeof FIXED_WORKFLOW_DEFINITION;
  readonly receiptStatus: "PROCESSED";
  readonly firstEnvelopeEventId: string;
  readonly firstReceivedAt: string;
}

export interface PersistedInboxDelivery {
  readonly deliveryId: InboxDeliveryId;
  readonly receiptId: InboxReceiptId;
  readonly caseId: CaseId;
  readonly envelopeEventId: string;
  readonly receivedAt: string;
}

export interface IntakeTransactionResult extends PersistedIntakeAuthority {
  readonly outcome: "CREATED" | "REPLAYED";
  readonly delivery: PersistedInboxDelivery;
}

export class AuthorityStartupError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthorityStartupError";
  }
}

function parseDatabaseLocation(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) {
    throw new TypeError("database location must be a non-empty filesystem path");
  }
  if (value === ":memory:" || value.startsWith("file:")) {
    throw new TypeError("the R003 authority requires one filesystem SQLite database for WAL recovery");
  }
  return resolve(value);
}

function assertDatabasePathIsNotSymlink(databasePath: string): void {
  try {
    if (lstatSync(databasePath).isSymbolicLink()) {
      throw new AuthorityStartupError("authority database path must not be a symbolic link");
    }
  } catch (error) {
    if (error instanceof AuthorityStartupError) {
      throw error;
    }
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") {
      return;
    }
    throw error;
  }
}

function pragmaValue(database: DatabaseSync, statement: string, label: string): unknown {
  const row = database.prepare(statement).get();
  const record = parsePersistenceRow(row, label);
  const values = Object.values(record);
  if (values.length !== 1) {
    throw new TypeError(`${label} must return exactly one value`);
  }
  return values[0];
}

function configureAndReadPragmas(database: DatabaseSync): SqlitePragmaState {
  database.exec(`
    PRAGMA busy_timeout = ${SQLITE_PRAGMAS.busyTimeoutMs};
    PRAGMA foreign_keys = ON;
  `);
  const selectedMode = pragmaValue(database, "PRAGMA journal_mode = WAL", "journal_mode selection");
  if (typeof selectedMode !== "string" || selectedMode.toLowerCase() !== SQLITE_PRAGMAS.journalMode) {
    throw new Error(`SQLite refused WAL mode (selected ${String(selectedMode)})`);
  }

  database.exec(`
    PRAGMA synchronous = FULL;
  `);

  const journalMode = pragmaValue(database, "PRAGMA journal_mode", "journal_mode");
  const foreignKeys = pragmaValue(database, "PRAGMA foreign_keys", "foreign_keys");
  const synchronous = pragmaValue(database, "PRAGMA synchronous", "synchronous");
  const busyTimeoutMs = pragmaValue(database, "PRAGMA busy_timeout", "busy_timeout");
  if (journalMode !== "wal" || foreignKeys !== 1 || synchronous !== 2 || busyTimeoutMs !== 5_000) {
    throw new Error(
      `required SQLite PRAGMAs were not applied: ${JSON.stringify({ busyTimeoutMs, foreignKeys, journalMode, synchronous })}`,
    );
  }
  return SQLITE_PRAGMAS;
}

function checkDatabaseHealth(database: DatabaseSync): void {
  const integrityRows = database.prepare("PRAGMA integrity_check").all();
  if (integrityRows.length !== 1) {
    throw new Error(`SQLite integrity check returned ${integrityRows.length} rows`);
  }
  const integrity = parsePersistenceRow(integrityRows[0], "integrity_check row");
  if (Object.values(integrity).length !== 1 || Object.values(integrity)[0] !== "ok") {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrityRows)}`);
  }

  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length !== 0) {
    throw new Error(`SQLite foreign-key check failed: ${JSON.stringify(foreignKeyViolations)}`);
  }
}

function readUserVersion(database: DatabaseSync): number {
  const version = pragmaValue(database, "PRAGMA user_version", "user_version");
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw new TypeError("SQLite user_version must be a non-negative safe integer");
  }
  return version;
}

interface SchemaObject {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string;
}

function readSchemaObjects(database: DatabaseSync): readonly SchemaObject[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name AS table_name, sql
       FROM sqlite_schema
       WHERE substr(name, 1, 7) <> 'sqlite_' AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all()
    .map((value, index) => {
      const row = parsePersistenceRow(value, `sqlite_schema row ${index}`);
      return {
        type: requireString(row, "type"),
        name: requireString(row, "name"),
        tableName: requireString(row, "table_name"),
        sql: requireString(row, "sql"),
      };
    });
}

function schemaFingerprint(database: DatabaseSync): string {
  return createHash("sha256").update(JSON.stringify(readSchemaObjects(database)), "utf8").digest("hex");
}

function ensureFreshDatabaseHasNoSchema(database: DatabaseSync): void {
  const objects = readSchemaObjects(database);
  if (objects.length !== 0) {
    throw new Error("unversioned SQLite database already contains schema objects");
  }
}

function rollbackAfterFailure(database: DatabaseSync, error: unknown): never {
  try {
    database.exec("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], "SQLite transaction and rollback both failed");
  }
  throw error;
}

function validateWorkflowDefinition(database: DatabaseSync): void {
  const value = database
    .prepare(
      `SELECT workflow_definition_id, definition_version, nodes_json, definition_digest
       FROM workflow_definitions`,
    )
    .all();
  if (value.length !== 1) {
    throw new Error("the fixed R003 workflow definition must exist exactly once");
  }
  const row = parsePersistenceRow(value[0], "workflow definition");
  if (
    requireString(row, "workflow_definition_id") !== FIXED_WORKFLOW_DEFINITION_ID ||
    requireString(row, "definition_version") !== FIXED_WORKFLOW_DEFINITION ||
    requireString(row, "nodes_json") !== WORKFLOW_NODES_JSON ||
    requireHexDigest(row, "definition_digest") !== WORKFLOW_NODES_DIGEST
  ) {
    throw new Error("the fixed R003 workflow definition is invalid");
  }
}

function validateAppliedSchema(database: DatabaseSync, migrations: readonly AuthorityMigration[]): void {
  const migration = migrations.at(-1);
  if (migration === undefined) {
    throw new Error("at least one pinned authority migration is required");
  }
  const version = readUserVersion(database);
  if (version !== migration.version) {
    throw new Error(`unsupported database schema version ${version}; expected ${migration.version}`);
  }

  const migrationRows = database
    .prepare(
       `SELECT version, migration_id, migration_sha256, schema_fingerprint, applied_at
       FROM accord_schema_migrations
       ORDER BY version`,
    )
    .all();
  if (migrationRows.length !== migrations.length) {
    throw new Error(`database must contain exactly ${migrations.length} R003 migration records`);
  }
  for (const [index, expected] of migrations.entries()) {
    const row = parsePersistenceRow(migrationRows[index], `migration record ${index}`);
    if (
      requireInteger(row, "version") !== expected.version ||
      requireString(row, "migration_id") !== expected.id ||
      requireHexDigest(row, "migration_sha256") !== expected.sha256 ||
      requireHexDigest(row, "schema_fingerprint") !== expected.schemaFingerprint
    ) {
      throw new Error("database schema drifted from the pinned migration chain metadata");
    }
    requireIsoInstant(row, "applied_at");
  }

  const actualFingerprint = schemaFingerprint(database);
  if (actualFingerprint !== migration.schemaFingerprint) {
    throw new Error(`database schema drifted from ${migration.id}`);
  }

  const names = new Set(readSchemaObjects(database).filter((item) => item.type === "table").map((item) => item.name));
  const requiredSchemaObjects = version === DATABASE_SCHEMA_VERSION ? REQUIRED_SCHEMA_OBJECTS : REQUIRED_CORE_SCHEMA_OBJECTS;
  for (const required of requiredSchemaObjects) {
    if (!names.has(required)) {
      throw new Error(`database schema is missing required table ${required}`);
    }
  }
  validateWorkflowDefinition(database);
}

function migrateAndValidate(database: DatabaseSync, migrations: readonly AuthorityMigration[]): void {
  const latestMigration = migrations.at(-1);
  if (latestMigration === undefined || latestMigration.version !== DATABASE_SCHEMA_VERSION) {
    throw new Error("the pinned authority migration chain does not reach the current schema version");
  }
  checkDatabaseHealth(database);
  const version = readUserVersion(database);
  if (version === 0) {
    ensureFreshDatabaseHasNoSchema(database);
  } else {
    const appliedIndex = migrations.findIndex((migration) => migration.version === version);
    if (appliedIndex === -1) {
      throw new Error(`unsupported database schema version ${version}; expected ${latestMigration.version}`);
    }
    validateAppliedSchema(database, migrations.slice(0, appliedIndex + 1));
  }
  const pending = migrations.filter((migration) => migration.version > version);
  if (pending.length > 0) {
    /* A populated legacy authority must never be left half-upgraded. */
    database.exec("BEGIN IMMEDIATE");
    try {
      if (version === 7) validateLegacyRuntimeDeliveryChronology(database);
      for (const migration of pending) {
        database.exec(migration.sql);
        if (schemaFingerprint(database) !== migration.schemaFingerprint) throw new Error(`database schema drifted from ${migration.id} while applying the pinned migration`);
        database.prepare(`INSERT INTO accord_schema_migrations (version, migration_id, migration_sha256, schema_fingerprint, applied_at) VALUES (?, ?, ?, ?, ?)`)
          .run(migration.version, migration.id, migration.sha256, migration.schemaFingerprint, new Date().toISOString());
        database.exec(`PRAGMA user_version = ${migration.version}`);
      }
      /* v3/v4 values are authority data, so all reconciliation and recovery
       * complete before the schema transaction becomes visible. */
      /* A pre-sealed row is historical authority, not a hint.  Validate it
       * before any reconciliation can make the failed open observable. */
      validateLegacyRuntimeReconciliationIfSealed(database);
      reconcileLegacySourceManifest(database);
      backfillLegacyRuntimeResults(database);
      reconcileLegacyRuntimeDeliveries(database);
      sealLegacyRuntimeReconciliation(database);
      validateLegacyRuntimeReconciliation(database);
      validatePersistedAuthorityState(database);
      validatePersistedRuntimeAuthorityGraph(database);
      recoverOpaqueCompletionReceipts(database);
      recoverReceivedRuntimeAttempts(database);
      reconcileInterruptedRuntimeAttempts(database);
      validatePersistedAuthorityState(database);
      validatePersistedRuntimeAuthorityGraph(database);
      checkDatabaseHealth(database);
      database.exec("COMMIT");
    } catch (error) {
      rollbackAfterFailure(database, error);
    }
  }
  validateAppliedSchema(database, migrations);
  checkDatabaseHealth(database);
  validateLegacyRuntimeReconciliation(database);
  if (pending.length === 0) {
    /* Current-schema recovery is all-or-nothing too: every opaque authority
     * must validate before a later malformed or superseding row can leave an
     * earlier recovery observable. */
    database.exec("BEGIN IMMEDIATE");
    try {
      validatePersistedAuthorityState(database);
      validatePersistedRuntimeAuthorityGraph(database);
      recoverOpaqueCompletionReceipts(database);
      recoverReceivedRuntimeAttempts(database);
      reconcileInterruptedRuntimeAttempts(database);
      validatePersistedAuthorityState(database);
      validatePersistedRuntimeAuthorityGraph(database);
      database.exec("COMMIT");
    } catch (error) {
      rollbackAfterFailure(database, error);
    }
  }
}

/** v3 stored complete frozen source snapshots in Contexts; seal that exact set once. */
function reconcileLegacySourceManifest(database: DatabaseSync): void {
  const header = database.prepare("SELECT state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'").get() as Record<string, unknown> | undefined;
  if (header?.["state"] !== "OPEN") return;
  const contexts = database.prepare("SELECT context_id, node_id, approved_sources_json FROM profile_contexts ORDER BY context_id").all() as readonly Record<string, unknown>[];
  const trusted = TRUSTED_SYNTHETIC_SOURCE_INPUT;
  const trustedId = deriveSourceId({ contentDigest: createHash("sha256").update(JSON.stringify(trusted.content), "utf8").digest("hex"), locator: trusted.locator, observedAt: trusted.observedAt, sourceKind: trusted.sourceKind });
  for (const context of contexts) {
    const row = parsePersistenceRow(context, "legacy source context");
    let sources: unknown;
    try { sources = JSON.parse(requireString(row, "approved_sources_json")); } catch { throw new Error("legacy Profile source context is not valid JSON"); }
    if (!Array.isArray(sources)) throw new Error("legacy Profile source context is not an array");
    if (row["node_id"] === "ANALYST") {
      if (sources.length !== 0) throw new Error("legacy Analyst context must contain no approved sources");
      continue;
    }
    if (row["node_id"] !== "RESEARCHER" || sources.length !== 1) throw new Error("legacy Researcher context must contain exactly the trusted manifest source");
    const source = parsePersistenceRow(sources[0], "legacy approved source");
    const keys = Object.keys(source).sort();
    if (keys.length !== 5 || keys.some((key, index) => key !== ["content", "locator", "observedAt", "sourceId", "sourceKind"][index])) throw new Error("legacy Researcher source has an unsupported field");
    if (requireString(source, "sourceId") !== trustedId || requireString(source, "content") !== trusted.content || requireString(source, "locator") !== trusted.locator || requireString(source, "observedAt") !== trusted.observedAt || requireString(source, "sourceKind") !== trusted.sourceKind) throw new Error("legacy Researcher source does not exactly match the trusted manifest");
  }
  installTrustedSyntheticSourceManifest(database, "2026-08-26T00:01:00.000Z");
}

function exactLegacyWinnerEntries(database: DatabaseSync, invocationId: InvocationId, caseId: CaseId, boardId: BoardId, revision: number, outputJson: string, createdAt: string): readonly string[] {
  let output: unknown;
  try { output = JSON.parse(outputJson); } catch { throw new Error("legacy runtime Result output is not valid JSON"); }
  const expected = reconstructWinnerBoardEntries(database, invocationId, output);
  const actual = database.prepare(`SELECT board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type, author_id,
      payload_json, source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level,
      instruction_authority, created_revision, content_digest, created_at
    FROM board_entries WHERE case_id = ? AND board_id = ? AND created_revision = ? ORDER BY board_entry_id`).all(caseId, boardId, revision) as readonly Record<string, unknown>[];
  if (actual.length !== expected.length) throw new Error("legacy runtime Result Board revision has an extra or missing entry");
  const byId = new Map(actual.map((row) => [String(row["board_entry_id"]), row]));
  for (const entry of expected) {
    const row = byId.get(entry.entryId);
    if (row === undefined) throw new Error("legacy runtime Result Board entries do not exactly reconstruct from its winner output");
    const persisted = parsePersistenceRow(row, "legacy runtime Board entry");
    const immutable = {
      authorId: requireString(persisted, "author_id"), authorType: requireString(persisted, "author_type"), basedOn: JSON.parse(requireString(persisted, "based_on_json")),
      contradicts: JSON.parse(requireString(persisted, "contradicts_json")), entryType: requireString(persisted, "entry_type"), instructionAuthority: requireString(persisted, "instruction_authority"),
      payload: JSON.parse(requireString(persisted, "payload_json")), sourceRefs: JSON.parse(requireString(persisted, "source_refs_json")), status: requireString(persisted, "status"),
      supersedes: JSON.parse(requireString(persisted, "supersedes_json")), trustLevel: requireString(persisted, "trust_level"), visibility: requireString(persisted, "visibility"),
    };
    const recomputedDigest = createHash("sha256").update(JSON.stringify(canonicalJson(immutable)), "utf8").digest("hex");
    const expectedImmutable = { authorId: entry.authorId, authorType: entry.authorType, basedOn: entry.basedOn, contradicts: entry.contradicts, entryType: entry.type, instructionAuthority: entry.instructionAuthority, payload: entry.payload, sourceRefs: entry.sourceRefs, status: entry.status, supersedes: entry.supersedes, trustLevel: entry.trustLevel, visibility: entry.visibility };
    if (
      requireString(persisted, "board_entry_id") !== entry.entryId || requireString(persisted, "schema_version") !== entry.schemaVersion || requireString(persisted, "board_id") !== boardId || requireString(persisted, "case_id") !== caseId ||
      requireInteger(persisted, "created_revision") !== revision || requireIsoInstant(persisted, "created_at") !== createdAt || requireHexDigest(persisted, "content_digest") !== recomputedDigest || recomputedDigest !== entry.contentDigest ||
      JSON.stringify(canonicalJson(immutable)) !== JSON.stringify(canonicalJson(expectedImmutable))
    ) throw new Error("legacy runtime Result Board entries do not exactly reconstruct from its winner output");
  }
  return Object.freeze(expected.map((entry) => entry.entryId));
}

/**
 * v3 persisted logical Results but had no physical receipt, Arrival, or
 * result-to-entry link tables.  Backfill only an already committed, exactly
 * derivable winner; every other shape is rejected while the upgrade is open.
 */
function backfillLegacyRuntimeResults(database: DatabaseSync): void {
  const legacy = database.prepare(`SELECT r.result_id, r.invocation_id, r.attempt_id, r.output_json, r.output_digest, r.first_received_at,
      i.case_id, i.board_id, i.workflow_run_id, i.board_revision, i.status, a.state AS attempt_state
    FROM runtime_results r
    JOIN runtime_invocations i ON i.invocation_id = r.invocation_id
    JOIN runtime_attempts a ON a.attempt_id = r.attempt_id AND a.invocation_id = r.invocation_id
    WHERE NOT EXISTS (SELECT 1 FROM runtime_result_arrivals arrival WHERE arrival.result_id = r.result_id)
    ORDER BY r.result_id`).all() as readonly Record<string, unknown>[];
  for (const raw of legacy) {
    const row = parsePersistenceRow(raw, "legacy runtime Result");
    const invocationId = parseInvocationId(requireString(row, "invocation_id"));
    const attemptId = parseAttemptId(requireString(row, "attempt_id"));
    const resultId = parseResultId(requireString(row, "result_id"));
    const outputDigest = requireHexDigest(row, "output_digest");
    if (resultId !== deriveRuntimeResultId({ invocationId, attemptId, outputDigest }) || row["status"] !== "RESULT_COMMITTED" || row["attempt_state"] !== "WINNER") throw new Error("legacy runtime Result cannot be reconciled as one committed winner");
    const existingWinner = database.prepare("SELECT 1 AS present FROM runtime_result_arrivals WHERE invocation_id = ? AND outcome = 'WINNER'").get(invocationId);
    if (existingWinner !== undefined) throw new Error("legacy runtime Result has an ambiguous winner");
    const caseId = parseCaseId(row["case_id"]); const boardId = parseBoardId(row["board_id"]); const workflowRunId = parseWorkflowRunId(row["workflow_run_id"]);
    const receivedAt = requireIsoInstant(row, "first_received_at");
    let persistedOutput: unknown;
    try { persistedOutput = JSON.parse(requireString(row, "output_json")); } catch { throw new Error("legacy runtime Result output is not valid JSON"); }
    if (outputDigest !== createHash("sha256").update(JSON.stringify(canonicalJson(persistedOutput)), "utf8").digest("hex")) throw new Error("legacy runtime Result output digest is inconsistent");
    const boardEntries = exactLegacyWinnerEntries(database, invocationId, caseId, boardId, requireInteger(row, "board_revision") + 1, requireString(row, "output_json"), receivedAt);
    if (database.prepare("SELECT 1 AS present FROM runtime_result_entries WHERE result_id = ?").get(resultId) !== undefined) throw new Error("legacy runtime Result already has an untrusted Board-entry link");
    const rawDigest = createHash("sha256").update(`accord.r003/legacy-response-backfill/v1\\0${resultId}`, "utf8").digest("hex");
    const responseId = deriveRuntimeResponseId({ invocationId, attemptId, envelopeDigest: rawDigest });
    const rawResponse = JSON.stringify({ envelope: { kind: "legacy-runtime-result-backfill/v1" }, envelopeDigest: rawDigest, kind: "provider-response-redacted", validationErrors: [] });
    database.prepare(`INSERT INTO runtime_physical_responses (response_id, schema_version, invocation_id, attempt_id, envelope_digest, redacted_envelope_json, trusted_received_at, provider_received_at, replayable_response_json)
      VALUES (?, 'accord.runtime-physical-response/v1', ?, ?, ?, ?, ?, NULL, '{}')`).run(responseId, invocationId, attemptId, rawDigest, rawResponse, receivedAt);
    const arrivalId = deriveRuntimeArrivalId({ invocationId, attemptId, arrivalNumber: 1 });
    database.prepare(`INSERT INTO runtime_result_arrivals (arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, outcome, raw_response_json, raw_response_digest, recorded_at, response_id)
      VALUES (?, 'accord.runtime-result-arrival/v1', ?, ?, ?, 1, 'WINNER', ?, ?, ?, ?)`).run(arrivalId, invocationId, attemptId, resultId, rawResponse, rawDigest, receivedAt, responseId);
    for (const entryId of boardEntries) database.prepare("INSERT INTO runtime_result_entries (result_id, board_entry_id) VALUES (?, ?)").run(resultId, entryId);
    database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at)
      VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`).run(String(deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId])), String(deriveRuntimeAuditCorrelationId(invocationId)), `RUNTIME_RESULT:WINNER:${attemptId}:1`, caseId, boardId, workflowRunId, JSON.stringify({ arrivalId, attemptId, outcome: "WINNER", recoveredFromSchema: 3, resultId }), receivedAt);
  }

  /* v3 already recorded immutable arrivals.  Link each non-UNKNOWN arrival
   * to its deterministic physical response without changing any historical
   * identity, payload, result, or audit field. */
  const unlinkedArrivals = database.prepare(`SELECT a.arrival_id, a.attempt_id, a.invocation_id, a.result_id, a.arrival_number, r.output_json, r.first_received_at,
      a.outcome, a.raw_response_json, a.raw_response_digest, a.recorded_at,
      i.case_id, i.board_id, i.workflow_run_id, i.board_revision
    FROM runtime_result_arrivals a
    JOIN runtime_invocations i ON i.invocation_id = a.invocation_id
    JOIN runtime_results r ON r.result_id = a.result_id AND r.invocation_id = a.invocation_id AND r.attempt_id = a.attempt_id
    WHERE a.outcome <> 'UNKNOWN' AND a.response_id IS NULL
    ORDER BY a.arrival_id`).all() as readonly Record<string, unknown>[];
  for (const raw of unlinkedArrivals) {
    const row = parsePersistenceRow(raw, "legacy runtime Arrival");
    const arrivalId = parseArrivalId(requireString(row, "arrival_id"));
    const invocationId = parseInvocationId(requireString(row, "invocation_id"));
    const attemptId = parseAttemptId(requireString(row, "attempt_id"));
    const resultId = parseResultId(requireString(row, "result_id"));
    const arrivalNumber = requireInteger(row, "arrival_number");
    const rawResponseDigest = requireHexDigest(row, "raw_response_digest");
    const rawResponseJson = requireString(row, "raw_response_json");
    const recordedAt = requireIsoInstant(row, "recorded_at");
    let envelope: unknown;
    try { envelope = JSON.parse(rawResponseJson); } catch { throw new Error("legacy runtime Arrival response is not valid JSON"); }
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope) || Reflect.get(envelope, "envelopeDigest") !== rawResponseDigest) throw new Error("legacy runtime Arrival response digest is inconsistent");
    const result = database.prepare("SELECT output_digest FROM runtime_results WHERE result_id = ? AND invocation_id = ? AND attempt_id = ?").get(resultId, invocationId, attemptId) as Record<string, unknown> | undefined;
    if (result === undefined || resultId !== deriveRuntimeResultId({ invocationId, attemptId, outputDigest: requireHexDigest(result, "output_digest") })) throw new Error("legacy runtime Arrival Result identity is invalid");
    const responseId = deriveRuntimeResponseId({ invocationId, attemptId, envelopeDigest: rawResponseDigest });
    const response = database.prepare("SELECT invocation_id, attempt_id, envelope_digest FROM runtime_physical_responses WHERE response_id = ?").get(responseId) as Record<string, unknown> | undefined;
    if (response === undefined) {
      database.prepare(`INSERT INTO runtime_physical_responses (response_id, schema_version, invocation_id, attempt_id, envelope_digest, redacted_envelope_json, trusted_received_at, provider_received_at, replayable_response_json)
        VALUES (?, 'accord.runtime-physical-response/v1', ?, ?, ?, ?, ?, NULL, '{}')`).run(responseId, invocationId, attemptId, rawResponseDigest, rawResponseJson, recordedAt);
    } else if (response["invocation_id"] !== invocationId || response["attempt_id"] !== attemptId || response["envelope_digest"] !== rawResponseDigest) {
      throw new Error("legacy runtime Arrival physical Response is inconsistent");
    }
    database.prepare("UPDATE runtime_result_arrivals SET response_id = ? WHERE arrival_id = ? AND response_id IS NULL").run(responseId, arrivalId);
    if (row["outcome"] !== "WINNER") continue;
    const caseId = parseCaseId(row["case_id"]); const boardId = parseBoardId(row["board_id"]); const workflowRunId = parseWorkflowRunId(row["workflow_run_id"]);
    const boardEntries = exactLegacyWinnerEntries(database, invocationId, caseId, boardId, requireInteger(row, "board_revision") + 1, requireString(row, "output_json"), requireIsoInstant(row, "first_received_at"));
    if (database.prepare("SELECT 1 AS present FROM runtime_result_entries WHERE result_id = ?").get(resultId) !== undefined) throw new Error("legacy runtime Arrival already has an untrusted Board-entry link");
    for (const entryId of boardEntries) database.prepare("INSERT OR IGNORE INTO runtime_result_entries (result_id, board_entry_id) VALUES (?, ?)").run(resultId, entryId);
    const auditEventId = deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId]);
    const audit = database.prepare("SELECT correlation_id, event_kind FROM audit_events WHERE audit_event_id = ?").get(auditEventId) as Record<string, unknown> | undefined;
    const eventKind = `RUNTIME_RESULT:WINNER:${attemptId}:${arrivalNumber}`;
    if (audit === undefined) {
      database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at)
        VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`).run(auditEventId, deriveRuntimeAuditCorrelationId(invocationId), eventKind, caseId, boardId, workflowRunId, JSON.stringify({ arrivalId, attemptId, outcome: "WINNER", recoveredFromSchema: 3, resultId }), recordedAt);
    } else if (audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(invocationId) || audit["event_kind"] !== eventKind) {
      throw new Error("legacy runtime Arrival winner audit is inconsistent");
    }
  }
}

function sealLegacyRuntimeReconciliation(database: DatabaseSync): void {
  const row = database.prepare("SELECT state, sealed_at FROM runtime_legacy_reconciliation WHERE reconciliation_id = 'runtime_legacy_reconciliation_r003_v1'").get() as Record<string, unknown> | undefined;
  if (row?.["state"] === "SEALED") { sealLegacyDeliveryProvenance(database); validateLegacyRuntimeReconciliation(database); return; }
  if (row?.["state"] !== "OPEN") throw new Error("legacy runtime reconciliation has an invalid migration state");
  if (database.prepare("UPDATE runtime_legacy_reconciliation SET state = 'SEALED', sealed_at = ? WHERE reconciliation_id = 'runtime_legacy_reconciliation_r003_v1' AND state = 'OPEN'").run(new Date().toISOString()).changes !== 1) {
    throw new Error("legacy runtime reconciliation could not be sealed exactly once");
  }
  sealLegacyDeliveryProvenance(database);
}

function validateLegacyRuntimeReconciliation(database: DatabaseSync): void {
  const row = database.prepare("SELECT state, sealed_at FROM runtime_legacy_reconciliation WHERE reconciliation_id = 'runtime_legacy_reconciliation_r003_v1'").get() as Record<string, unknown> | undefined;
  if (row === undefined || row["state"] !== "SEALED" || typeof row["sealed_at"] !== "string") throw new Error("legacy runtime reconciliation is not sealed");
  requireIsoInstant(row, "sealed_at");
}

function validateLegacyRuntimeReconciliationIfSealed(database: DatabaseSync): void {
  const row = database.prepare("SELECT state FROM runtime_legacy_reconciliation WHERE reconciliation_id = 'runtime_legacy_reconciliation_r003_v1'").get() as Record<string, unknown> | undefined;
  if (row?.["state"] === "SEALED") validateLegacyRuntimeReconciliation(database);
}

function reconcileInterruptedRuntimeAttempts(database: DatabaseSync): void {
  const interrupted = database.prepare(`SELECT a.attempt_id, a.invocation_id, i.case_id, i.board_id, i.workflow_run_id, i.node_id, i.workflow_revision, i.board_revision, i.context_digest
    FROM runtime_attempts a JOIN runtime_invocations i ON i.invocation_id = a.invocation_id
    WHERE a.state = 'RUNNING' ORDER BY a.attempt_id`).all() as readonly Record<string, unknown>[];
  if (interrupted.length === 0) return;
  const recoveredAt = new Date().toISOString();
  runTransaction(database, () => {
    for (const raw of interrupted) {
      const row = parsePersistenceRow(raw, "interrupted Runtime Attempt");
      const attemptId = parseAttemptId(requireString(row, "attempt_id"));
      const invocationId = parseInvocationId(requireString(row, "invocation_id"));
      const caseId = parseCaseId(row["case_id"]);
      const boardId = parseBoardId(row["board_id"]);
      const workflowRunId = parseWorkflowRunId(row["workflow_run_id"]);
      const nodeId = requireString(row, "node_id");
      const workflowRevision = requireInteger(row, "workflow_revision");
      const boardRevision = requireInteger(row, "board_revision");
      const contextDigest = requireString(row, "context_digest");
      const count = database.prepare("SELECT count(*) AS count FROM runtime_attempts WHERE invocation_id = ?").get(invocationId) as Record<string, unknown>;
      const exhausted = count["count"] === 2;
      const attemptUpdate = database.prepare("UPDATE runtime_attempts SET state = 'UNKNOWN', finished_at = ? WHERE attempt_id = ? AND state = 'RUNNING'").run(recoveredAt, attemptId);
      const invocationUpdate = database.prepare("UPDATE runtime_invocations SET status = 'UNKNOWN' WHERE invocation_id = ? AND status = 'RUNNING'").run(invocationId);
      if (attemptUpdate.changes !== 1 || invocationUpdate.changes !== 1) throw new Error("interrupted Runtime recovery lost its paired Invocation/Attempt compare-and-set");
      recordUnknownRuntimeArrival(database, { invocationId, attemptId, caseId, boardId, workflowRunId, recordedAt: recoveredAt, eventKind: exhausted ? "RUNTIME_ATTEMPT_RECOVERED_UNKNOWN_EXHAUSTED" : "RUNTIME_ATTEMPT_RECOVERED_UNKNOWN", details: { operatorDecisionRequired: exhausted, recovery: "startup" } });
      if (exhausted) {
        database.prepare("UPDATE runtime_invocations SET status = 'FAILED' WHERE invocation_id = ? AND status <> 'RESULT_COMMITTED'").run(invocationId);
        const fresh = database.prepare("SELECT 1 AS present FROM runtime_invocations i JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id JOIN boards b ON b.board_id = i.board_id JOIN cases c ON c.case_id = i.case_id WHERE i.invocation_id = ? AND i.workflow_revision = ? AND i.board_revision = ? AND i.context_digest = ? AND w.state = ? AND w.revision = ? AND b.revision = ? AND c.status = 'OPEN'").get(invocationId, workflowRevision, boardRevision, contextDigest, nodeId, workflowRevision, boardRevision) as Record<string, unknown> | undefined;
        if (fresh !== undefined) { database.prepare("UPDATE workflow_runs SET state = 'FAILED', revision = revision + 1 WHERE workflow_run_id = ? AND state = ? AND revision = ?").run(workflowRunId, nodeId, workflowRevision); database.prepare("UPDATE cases SET status = 'FAILED' WHERE case_id = ? AND status = 'OPEN'").run(caseId); }
      }
    }
  });
}

function validatePersistedAuthorityState(database: DatabaseSync): void {
  const orphanCaseRow = parsePersistenceRow(
    database
      .prepare(
        `SELECT count(*) AS count
         FROM cases AS c
         WHERE NOT EXISTS (
           SELECT 1
           FROM inbox_receipts AS r
           WHERE r.case_id = c.case_id
             AND r.app_id = c.source_app_id
             AND r.source_conversation_id = c.source_conversation_id
             AND r.source_message_id = c.source_message_id
             AND r.processing_status = 'PROCESSED'
         )`,
      )
      .get(),
    "orphan Case count",
  );
  if (requireInteger(orphanCaseRow, "count") !== 0) {
    throw new Error("persisted authority integrity failed: a Case has no correlated intake receipt");
  }

  const receipts = database
    .prepare(
      `SELECT app_id, cursor
       FROM inbox_receipts
       WHERE processing_status = 'PROCESSED'
         AND NOT EXISTS (
           SELECT 1
           FROM magicchat_inbox_states AS s
           WHERE s.receipt_id = inbox_receipts.receipt_id
             AND s.event_role = 'CLARIFICATION_REPLY'
         )
       ORDER BY app_id, cursor`,
    )
    .all();
  for (const [index, value] of receipts.entries()) {
    const receipt = parsePersistenceRow(value, `processed receipt ${index}`);
    const appId = requireStableIdentifier(receipt, "app_id");
    const cursor = requireInteger(receipt, "cursor");
    const graph = queryPersistedIntake(database, appId, cursor);
    if (graph === undefined) {
      throw new Error("persisted authority integrity failed: a processed receipt has no complete correlated graph");
    }
    const persisted = parsePersistedIntake(graph);
    const deliveries = queryInboxDeliveriesByReceipt(database, persisted.receiptId);
    if (deliveries.length === 0) {
      throw new Error("persisted authority integrity failed: a processed receipt has no delivery audit history");
    }
    let firstDeliveryCount = 0;
    for (const [deliveryIndex, deliveryValue] of deliveries.entries()) {
      const delivery = parsePersistedInboxDelivery(
        parsePersistenceRow(deliveryValue, `processed receipt ${index} delivery ${deliveryIndex}`),
      );
      assertPersistedInboxDeliveryMatches(delivery, graph, persisted);
      if (
        delivery.envelopeEventId === persisted.firstEnvelopeEventId &&
        delivery.receivedAt === persisted.firstReceivedAt
      ) {
        firstDeliveryCount += 1;
      }
    }
    if (firstDeliveryCount !== 1) {
      throw new Error("persisted authority integrity failed: receipt first-delivery audit linkage is incomplete");
    }
  }

  const intakeAudits = database
    .prepare(
      `SELECT audit_event_id
       FROM audit_events
       WHERE event_kind = 'INTAKE_COMMITTED'
       ORDER BY audit_event_id`,
    )
    .all();
  for (const [index, value] of intakeAudits.entries()) {
    const audit = parsePersistenceRow(value, `intake-commit audit ${index}`);
    const auditEventId = requireString(audit, "audit_event_id");
    const graph = queryPersistedIntakeByAuditEventId(database, auditEventId);
    if (graph === undefined) {
      throw new Error("persisted authority integrity failed: an intake-commit audit has no complete correlated graph");
    }
    parsePersistedIntake(graph);
  }

  const allDeliveries = queryAllInboxDeliveries(database);
  for (const [index, value] of allDeliveries.entries()) {
    const delivery = parsePersistedInboxDelivery(parsePersistenceRow(value, `inbox delivery ${index}`));
    if (queryMagicChatEventRoleByReceipt(database, delivery.receiptId) === "CLARIFICATION_REPLY") {
      continue;
    }
    const graph = queryPersistedIntakeByReceiptId(database, delivery.receiptId);
    if (graph === undefined) {
      throw new Error("persisted authority integrity failed: a delivery audit has no complete processed receipt graph");
    }
    const persisted = parsePersistedIntake(graph);
    assertPersistedInboxDeliveryMatches(delivery, graph, persisted);
  }

  const magicChatStates = database
    .prepare("SELECT app_id, cursor FROM magicchat_inbox_states ORDER BY app_id, cursor")
    .all();
  for (const [index, value] of magicChatStates.entries()) {
    const identity = parsePersistenceRow(value, `MagicChat inbox state ${index}`);
    const appId = requireStableIdentifier(identity, "app_id");
    const cursor = requireInteger(identity, "cursor");
    const row = queryMagicChatProtocol(database, appId, cursor);
    if (row === undefined) {
      throw new Error("persisted MagicChat inbox state has no complete protocol graph");
    }
    const parsed = parseMagicChatProtocol(row);
    const deliveries = queryInboxDeliveriesByReceipt(database, parsed.snapshot.receiptId);
    if (deliveries.length === 0) {
      throw new Error("persisted MagicChat inbox state has no delivery audit history");
    }
    for (const [deliveryIndex, deliveryValue] of deliveries.entries()) {
      const delivery = parsePersistedInboxDelivery(
        parsePersistenceRow(deliveryValue, `MagicChat inbox state ${index} delivery ${deliveryIndex}`),
      );
      if (delivery.caseId !== parsed.snapshot.caseId || delivery.receiptId !== parsed.snapshot.receiptId) {
        throw new Error("persisted MagicChat delivery does not correlate its protocol receipt");
      }
    }
  }
  validatePersistedClarificationObservations(database);
  validatePersistedAgentBoardGraph(database);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(Reflect.get(value, key))]));
  return value;
}

function boardEntryDigest(row: PersistenceRow): string {
  const parse = (column: string): unknown => {
    try { return JSON.parse(requireString(row, column)); } catch { throw new Error(`persisted authority integrity failed: Agent Board entry ${column} is invalid JSON`); }
  };
  const immutable = {
    authorId: requireString(row, "author_id"), authorType: requireString(row, "author_type"), basedOn: parse("based_on_json"),
    contradicts: parse("contradicts_json"), entryType: requireString(row, "entry_type"), instructionAuthority: requireString(row, "instruction_authority"),
    payload: parse("payload_json"), sourceRefs: parse("source_refs_json"), status: requireString(row, "status"),
    supersedes: parse("supersedes_json"), trustLevel: requireString(row, "trust_level"), visibility: requireString(row, "visibility"),
  };
  return createHash("sha256").update(JSON.stringify(canonicalJson(immutable)), "utf8").digest("hex");
}

function validatePersistedAgentBoardGraph(database: DatabaseSync): void {
  const entries = database.prepare(`SELECT board_entry_id, board_id, case_id, entry_type, status, author_type, author_id, payload_json,
    source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level, instruction_authority, created_revision, content_digest
    FROM board_entries WHERE author_type = 'AGENT' ORDER BY board_entry_id`).all();
  for (const [index, raw] of entries.entries()) {
    const row = parsePersistenceRow(raw, `Agent Board entry ${index}`);
    if (requireHexDigest(row, "content_digest") !== boardEntryDigest(row)) throw new Error("persisted authority integrity failed: Agent Board entry digest drifted");
    const boardId = requireString(row, "board_id"); const caseId = requireString(row, "case_id");
    const board = database.prepare("SELECT revision FROM boards WHERE board_id = ? AND case_id = ?").get(boardId, caseId);
    if (board === undefined || requireInteger(row, "created_revision") > requireInteger(parsePersistenceRow(board, "Agent Board entry board"), "revision")) throw new Error("persisted authority integrity failed: Agent Board entry revision is invalid");
    for (const relationColumn of ["based_on_json", "contradicts_json", "supersedes_json"] as const) {
      let ids: unknown; try { ids = JSON.parse(requireString(row, relationColumn)); } catch { throw new Error("persisted authority integrity failed: Agent Board relation JSON is invalid"); }
      if (!Array.isArray(ids) || ids.some((entryId) => typeof entryId !== "string" || database.prepare("SELECT 1 FROM board_entries WHERE board_entry_id = ? AND board_id = ? AND case_id = ?").get(entryId, boardId, caseId) === undefined)) throw new Error("persisted authority integrity failed: Agent Board relation leaves its Case graph");
    }
  }
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain one JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function requireStableIdentifier(row: PersistenceRow, column: string): string {
  const value = requireString(row, column);
  if (
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    /[\p{White_Space}\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`${column} is not a valid persisted stable identifier`);
  }
  return value;
}

function validatePersistedClarificationObservations(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT
         ch.challenge_id,
         ch.case_id,
         ch.board_id,
         ch.workflow_run_id,
         ch.question_entry_id,
         ch.expected_app_id,
         ch.expected_conversation_id,
         ch.expected_actor_id,
         ch.expected_input_contract,
         ch.clarification_message_id,
         ch.clarification_message_sequence,
         ch.resolved_by_receipt_id,
         ch.resolved_at,
         r.schema_version AS reply_receipt_schema_version,
         r.app_id AS reply_app_id,
         r.cursor AS reply_cursor,
         r.envelope_event_id AS reply_envelope_event_id,
         r.event_type AS reply_event_type,
         r.payload_digest AS reply_payload_digest,
         r.source_conversation_id AS reply_conversation_id,
         r.source_message_id AS reply_message_id,
         r.source_message_sequence AS reply_message_sequence,
         r.source_actor_id AS reply_actor_id,
         r.processing_status AS reply_processing_status,
         r.received_at AS reply_received_at,
         s.schema_version AS reply_state_schema_version,
         s.correlation_id AS reply_correlation_id,
         s.event_role AS reply_event_role,
         s.normalized_body AS reply_normalized_body,
         s.reply_to_message_id AS reply_reply_to_message_id,
         s.message_created_at AS reply_message_created_at,
         s.business_outcome AS reply_business_outcome,
         s.business_stable AS reply_business_stable,
         a.audit_event_id AS resume_audit_event_id,
         a.schema_version AS resume_audit_schema_version,
         a.correlation_id AS resume_audit_correlation_id,
         a.details_json AS resume_audit_details_json,
         a.recorded_at AS resume_audit_recorded_at,
         o.board_entry_id AS observation_entry_id,
         o.schema_version AS observation_schema_version,
         o.board_id AS observation_board_id,
         o.case_id AS observation_case_id,
         o.entry_type AS observation_entry_type,
         o.status AS observation_status,
         o.author_type AS observation_author_type,
         o.author_id AS observation_author_id,
         o.payload_json AS observation_payload_json,
         o.source_refs_json AS observation_source_refs_json,
         o.based_on_json AS observation_based_on_json,
         o.contradicts_json AS observation_contradicts_json,
         o.supersedes_json AS observation_supersedes_json,
         o.visibility AS observation_visibility,
         o.trust_level AS observation_trust_level,
         o.instruction_authority AS observation_instruction_authority,
         o.created_revision AS observation_created_revision,
         o.content_digest AS observation_content_digest,
         o.created_at AS observation_created_at
       FROM wait_challenges AS ch
       LEFT JOIN inbox_receipts AS r
         ON r.receipt_id = ch.resolved_by_receipt_id AND r.case_id = ch.case_id
       LEFT JOIN magicchat_inbox_states AS s
         ON s.receipt_id = r.receipt_id AND s.case_id = ch.case_id
       LEFT JOIN audit_events AS a
         ON a.receipt_id = r.receipt_id AND a.case_id = ch.case_id
        AND a.event_kind = 'CLARIFICATION_RESUMED'
       LEFT JOIN board_entries AS o
         ON o.board_entry_id = json_extract(a.details_json, '$.observationEntryId')
        AND o.case_id = ch.case_id
       WHERE ch.state = 'RESUMED'
       ORDER BY ch.challenge_id`,
    )
    .all();

  for (const [index, value] of rows.entries()) {
    try {
      const row = parsePersistenceRow(value, `resumed clarification ${index}`);
      requireLiteral(row, "expected_input_contract", CLARIFICATION_EXPECTED_INPUT_CONTRACT);
      requireLiteral(row, "reply_receipt_schema_version", CONTRACT_VERSIONS.inboxReceipt);
      requireLiteral(row, "reply_event_type", "message.created");
      requireLiteral(row, "reply_processing_status", "PROCESSED");
      requireLiteral(row, "reply_state_schema_version", CONTRACT_VERSIONS.magicChatInboxState);
      requireLiteral(row, "reply_event_role", "CLARIFICATION_REPLY");
      requireLiteral(row, "reply_business_outcome", "RESEARCHER");
      if (requireInteger(row, "reply_business_stable") !== 1) {
        throw new TypeError("matching reply business state is not stable");
      }

      const reply = normalizeSyntheticIntake({
        actorId: requireStableIdentifier(row, "reply_actor_id"),
        appId: requireStableIdentifier(row, "reply_app_id"),
        conversationId: requireStableIdentifier(row, "reply_conversation_id"),
        cursor: requireInteger(row, "reply_cursor"),
        envelopeEventId: requireStableIdentifier(row, "reply_envelope_event_id"),
        eventType: "message.created",
        messageId: requireStableIdentifier(row, "reply_message_id"),
        messageSequence: requireInteger(row, "reply_message_sequence"),
        objective: requireString(row, "reply_normalized_body"),
        payloadDigest: requireHexDigest(row, "reply_payload_digest"),
        receivedAt: requireIsoInstant(row, "reply_received_at"),
        schemaVersion: NORMALIZED_INTAKE_CONTRACT,
        synthetic: true,
      });
      if (Date.parse(requireIsoInstant(row, "reply_message_created_at")) > Date.parse(reply.receivedAt)) {
        throw new TypeError("matching reply message follows its receipt time");
      }
      const receiptIds = deriveReceiptBusinessIds(reply);
      const receiptId = parseInboxReceiptId(row["resolved_by_receipt_id"]);
      const caseId = parseCaseId(row["case_id"]);
      const boardId = parseBoardId(row["board_id"]);
      const workflowRunId = parseWorkflowRunId(row["workflow_run_id"]);
      const challengeId = parseWaitChallengeId(row["challenge_id"]);
      const questionEntryId = parseBoardEntryId(row["question_entry_id"]);
      const clarificationMessageId = requireStableIdentifier(row, "clarification_message_id");
      const clarificationMessageSequence = requireInteger(row, "clarification_message_sequence");
      if (
        receiptId !== receiptIds.receiptId ||
        requireString(row, "reply_correlation_id") !== receiptIds.auditCorrelationId ||
        reply.appId !== requireStableIdentifier(row, "expected_app_id") ||
        reply.conversationId !== requireStableIdentifier(row, "expected_conversation_id") ||
        reply.actorId !== requireStableIdentifier(row, "expected_actor_id") ||
        requireStableIdentifier(row, "reply_reply_to_message_id") !== clarificationMessageId ||
        reply.messageSequence <= clarificationMessageSequence ||
        requireIsoInstant(row, "resolved_at") !== reply.receivedAt
      ) {
        throw new TypeError("matching reply does not satisfy its active challenge binding");
      }

      const observationEntryId = deriveObservationEntryId({
        caseId,
        messageId: reply.messageId,
        receiptId,
        workflowRunId,
      });
      const observationPayload = {
        answer: reply.objective,
        expectedInputContract: CLARIFICATION_EXPECTED_INPUT_CONTRACT,
        sourceMessageId: reply.messageId,
        sourceMessageSequence: reply.messageSequence,
      } as const;
      const observationSourceRefs = [`magicchat:message:${reply.messageId}`];
      const observationDigest = protocolDigest({
        authorId: reply.actorId,
        authorType: "HUMAN",
        basedOn: [questionEntryId],
        contradicts: [],
        entryType: "Observation",
        instructionAuthority: "NONE",
        payload: observationPayload,
        sourceRefs: observationSourceRefs,
        status: "ACCEPTED",
        supersedes: [],
        trustLevel: "UNTRUSTED",
        visibility: "CASE",
      });
      requireLiteral(row, "observation_schema_version", CONTRACT_VERSIONS.boardEntry);
      if (
        parseBoardEntryId(row["observation_entry_id"]) !== observationEntryId ||
        parseBoardId(row["observation_board_id"]) !== boardId ||
        parseCaseId(row["observation_case_id"]) !== caseId ||
        requireString(row, "observation_entry_type") !== "Observation" ||
        requireString(row, "observation_status") !== "ACCEPTED" ||
        requireString(row, "observation_author_type") !== "HUMAN" ||
        requireString(row, "observation_author_id") !== reply.actorId ||
        requireString(row, "observation_payload_json") !== JSON.stringify(observationPayload) ||
        requireString(row, "observation_source_refs_json") !== JSON.stringify(observationSourceRefs) ||
        requireString(row, "observation_based_on_json") !== JSON.stringify([questionEntryId]) ||
        requireString(row, "observation_contradicts_json") !== "[]" ||
        requireString(row, "observation_supersedes_json") !== "[]" ||
        requireString(row, "observation_visibility") !== "CASE" ||
        requireString(row, "observation_trust_level") !== "UNTRUSTED" ||
        requireString(row, "observation_instruction_authority") !== "NONE" ||
        requireInteger(row, "observation_created_revision") !== 2 ||
        requireHexDigest(row, "observation_content_digest") !== observationDigest ||
        requireIsoInstant(row, "observation_created_at") !== reply.receivedAt
      ) {
        throw new TypeError("matching reply Observation does not match its durable input");
      }

      requireLiteral(row, "resume_audit_schema_version", CONTRACT_VERSIONS.auditEvent);
      const auditDetails = parseJsonObject(requireString(row, "resume_audit_details_json"), "resume audit details");
      requireExactObjectKeys(
        auditDetails,
        ["challengeId", "clarificationMessageId", "observationEntryId", "replyToMessageId", "sourceMessageId"],
        "resume audit details",
      );
      if (
        parseAuditEventId(row["resume_audit_event_id"]) !==
          deriveProtocolAuditEventId(receiptIds.auditCorrelationId, "CLARIFICATION_RESUMED") ||
        requireString(row, "resume_audit_correlation_id") !== receiptIds.auditCorrelationId ||
        auditDetails["challengeId"] !== challengeId ||
        auditDetails["clarificationMessageId"] !== clarificationMessageId ||
        auditDetails["observationEntryId"] !== observationEntryId ||
        auditDetails["replyToMessageId"] !== clarificationMessageId ||
        auditDetails["sourceMessageId"] !== reply.messageId ||
        requireIsoInstant(row, "resume_audit_recorded_at") !== reply.receivedAt
      ) {
        throw new TypeError("matching reply resume audit is invalid");
      }
    } catch (error) {
      throw new TypeError("matching clarification Observation is invalid", { cause: error });
    }
  }
}

const PERSISTED_INTAKE_GRAPH_SELECT = `SELECT
         r.receipt_id,
         r.schema_version AS receipt_schema_version,
         r.app_id,
         r.cursor,
         r.envelope_event_id,
         r.event_type,
         r.payload_digest,
         r.source_conversation_id,
         r.source_message_id,
         r.source_message_sequence,
         r.source_actor_id,
         r.processing_status,
         r.received_at,
         c.case_id,
         c.schema_version AS case_schema_version,
         c.source_app_id AS case_source_app_id,
         c.source_conversation_id AS case_source_conversation_id,
         c.source_message_id AS case_source_message_id,
         c.objective,
         c.status AS case_status,
         b.board_id,
         b.schema_version AS board_schema_version,
         b.revision AS board_revision,
         w.workflow_run_id,
         w.schema_version AS workflow_schema_version,
         w.workflow_definition_id,
         wd.definition_version AS workflow_definition_version,
         w.state AS workflow_state,
         w.revision AS workflow_revision,
         a.audit_event_id,
         a.schema_version AS audit_schema_version,
         a.correlation_id,
         a.event_kind,
         a.details_json,
         a.recorded_at
       FROM inbox_receipts AS r
       JOIN cases AS c ON c.case_id = r.case_id
       JOIN boards AS b ON b.board_id = r.board_id AND b.case_id = c.case_id
       JOIN workflow_runs AS w ON w.workflow_run_id = r.workflow_run_id
         AND w.case_id = c.case_id AND w.board_id = b.board_id
       JOIN workflow_definitions AS wd ON wd.workflow_definition_id = w.workflow_definition_id
       JOIN audit_events AS a ON a.receipt_id = r.receipt_id
         AND a.case_id = c.case_id AND a.board_id = b.board_id
         AND a.workflow_run_id = w.workflow_run_id AND a.event_kind = 'INTAKE_COMMITTED'`;

function selectPersistedIntakeGraph(
  database: DatabaseSync,
  whereClause: string,
  parameters: readonly (number | string)[],
): PersistenceRow | undefined {
  const rows = database.prepare(`${PERSISTED_INTAKE_GRAPH_SELECT} WHERE ${whereClause}`).all(...parameters);
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw new Error("persisted intake authority must resolve to exactly one correlated graph");
  }
  return parsePersistenceRow(rows[0], "persisted intake authority");
}

function queryPersistedIntake(database: DatabaseSync, appId: string, cursor: number): PersistenceRow | undefined {
  return selectPersistedIntakeGraph(database, "r.app_id = ? AND r.cursor = ?", [appId, cursor]);
}

function queryPersistedIntakeByAuditEventId(
  database: DatabaseSync,
  auditEventId: string,
): PersistenceRow | undefined {
  return selectPersistedIntakeGraph(database, "a.audit_event_id = ?", [auditEventId]);
}

function queryPersistedIntakeByReceiptId(
  database: DatabaseSync,
  receiptId: InboxReceiptId,
): PersistenceRow | undefined {
  return selectPersistedIntakeGraph(database, "r.receipt_id = ?", [receiptId]);
}

const INBOX_DELIVERY_SELECT = `SELECT
  delivery_id,
  schema_version AS delivery_schema_version,
  receipt_id,
  case_id,
  envelope_event_id,
  received_at
FROM inbox_deliveries`;

function queryAllInboxDeliveries(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`${INBOX_DELIVERY_SELECT} ORDER BY delivery_id`).all();
}

function queryInboxDeliveriesByReceipt(database: DatabaseSync, receiptId: InboxReceiptId): readonly unknown[] {
  return database
    .prepare(`${INBOX_DELIVERY_SELECT} WHERE receipt_id = ? ORDER BY received_at, delivery_id`)
    .all(receiptId);
}

function queryInboxDeliveryById(database: DatabaseSync, deliveryId: InboxDeliveryId): PersistenceRow | undefined {
  const rows = database.prepare(`${INBOX_DELIVERY_SELECT} WHERE delivery_id = ?`).all(deliveryId);
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw new Error("persisted inbox delivery must resolve exactly once");
  }
  return parsePersistenceRow(rows[0], "persisted inbox delivery");
}

function parsePersistedInboxDelivery(row: PersistenceRow): PersistedInboxDelivery {
  requireLiteral(row, "delivery_schema_version", CONTRACT_VERSIONS.inboxDelivery);
  const deliveryId = parseInboxDeliveryId(row["delivery_id"]);
  const receiptId = parseInboxReceiptId(row["receipt_id"]);
  const caseId = parseCaseId(row["case_id"]);
  const envelopeEventId = requireStableIdentifier(row, "envelope_event_id");
  const receivedAt = requireIsoInstant(row, "received_at");
  const expectedDeliveryId = deriveInboxDeliveryId({ envelopeEventId, receiptId });
  if (deliveryId !== expectedDeliveryId) {
    throw new TypeError("persisted delivery ID does not match its receipt and envelope Event ID");
  }
  return { caseId, deliveryId, envelopeEventId, receiptId, receivedAt };
}

function assertPersistedInboxDeliveryMatches(
  delivery: PersistedInboxDelivery,
  intakeRow: PersistenceRow,
  persisted: PersistedIntakeAuthority,
): void {
  if (delivery.receiptId !== persisted.receiptId || delivery.caseId !== persisted.caseId) {
    throw new TypeError("delivery audit does not correlate the persisted receipt and Case");
  }
  const reconstructed = normalizeSyntheticIntake({
    schemaVersion: NORMALIZED_INTAKE_CONTRACT,
    synthetic: true,
    eventType: "message.created",
    appId: requireStableIdentifier(intakeRow, "app_id"),
    cursor: requireInteger(intakeRow, "cursor"),
    envelopeEventId: delivery.envelopeEventId,
    conversationId: requireStableIdentifier(intakeRow, "source_conversation_id"),
    messageId: requireStableIdentifier(intakeRow, "source_message_id"),
    messageSequence: requireInteger(intakeRow, "source_message_sequence"),
    actorId: requireStableIdentifier(intakeRow, "source_actor_id"),
    objective: requireString(intakeRow, "objective"),
    receivedAt: delivery.receivedAt,
  });
  if (reconstructed.payloadDigest !== persisted.payloadDigest) {
    throw new TypeError("delivery audit does not reconstruct the persisted intake contract");
  }
}

function parsePersistedIntake(row: PersistenceRow): PersistedIntakeAuthority {
  requireLiteral(row, "receipt_schema_version", CONTRACT_VERSIONS.inboxReceipt);
  requireLiteral(row, "case_schema_version", CONTRACT_VERSIONS.case);
  requireLiteral(row, "board_schema_version", CONTRACT_VERSIONS.board);
  requireLiteral(row, "workflow_schema_version", CONTRACT_VERSIONS.workflowRun);
  requireLiteral(row, "audit_schema_version", CONTRACT_VERSIONS.auditEvent);
  requireLiteral(row, "event_type", "message.created");
  requireLiteral(row, "processing_status", "PROCESSED");
  const caseStatus = requireOneOf(row, "case_status", CASE_STATUSES);
  const workflowState = requireOneOf(row, "workflow_state", WORKFLOW_STATES);
  requireLiteral(row, "event_kind", "INTAKE_COMMITTED");
  requireLiteral(row, "workflow_definition_version", FIXED_WORKFLOW_DEFINITION);
  if (requireString(row, "workflow_definition_id") !== FIXED_WORKFLOW_DEFINITION_ID) {
    throw new TypeError("workflow_definition_id does not reference the fixed R003 workflow");
  }

  const boardRevision = requireInteger(row, "board_revision");
  const workflowRevision = requireInteger(row, "workflow_revision");
  if (boardRevision < 0 || workflowRevision < 1) {
    throw new TypeError("persisted Board and Workflow revisions are invalid");
  }

  const appId = requireStableIdentifier(row, "app_id");
  const cursor = requireInteger(row, "cursor");
  const conversationId = requireStableIdentifier(row, "source_conversation_id");
  const messageId = requireStableIdentifier(row, "source_message_id");
  const messageSequence = requireInteger(row, "source_message_sequence");
  const actorId = requireStableIdentifier(row, "source_actor_id");
  const firstEnvelopeEventId = requireStableIdentifier(row, "envelope_event_id");
  if (cursor < 1 || messageSequence < 1) {
    throw new TypeError("persisted cursor and message sequence must be positive integers");
  }
  const objective = requireString(row, "objective");
  if (
    objective.length < 1 ||
    objective.length > 4_096 ||
    objective !== objective.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim()
  ) {
    throw new TypeError("persisted objective is not normalized");
  }
  const payloadDigest = requireHexDigest(row, "payload_digest");
  const firstReceivedAt = requireIsoInstant(row, "received_at");
  const recordedAt = requireIsoInstant(row, "recorded_at");
  if (recordedAt !== firstReceivedAt) {
    throw new TypeError("intake audit time does not match the persisted receipt time");
  }
  const reconstructed = normalizeSyntheticIntake({
    schemaVersion: NORMALIZED_INTAKE_CONTRACT,
    synthetic: true,
    eventType: "message.created",
    appId,
    cursor,
    envelopeEventId: firstEnvelopeEventId,
    conversationId,
    messageId,
    messageSequence,
    actorId,
    objective,
    receivedAt: firstReceivedAt,
  });
  if (reconstructed.payloadDigest !== payloadDigest) {
    throw new TypeError("persisted payload digest does not match the normalized intake fields");
  }

  const caseSourceAppId = requireStableIdentifier(row, "case_source_app_id");
  const caseSourceConversationId = requireStableIdentifier(row, "case_source_conversation_id");
  const caseSourceMessageId = requireStableIdentifier(row, "case_source_message_id");
  if (
    caseSourceAppId !== appId ||
    caseSourceConversationId !== conversationId ||
    caseSourceMessageId !== messageId
  ) {
    throw new TypeError("persisted Case source fields do not match the inbox receipt");
  }

  const expectedIds = deriveIntakeBusinessIds({
    appId,
    conversationId,
    cursor,
    messageId,
    payloadDigest,
    workflowDefinition: FIXED_WORKFLOW_DEFINITION,
  });
  const caseId = parseCaseId(row["case_id"]);
  const boardId = parseBoardId(row["board_id"]);
  const workflowRunId = parseWorkflowRunId(row["workflow_run_id"]);
  const receiptId = parseInboxReceiptId(row["receipt_id"]);
  const auditCorrelationId = parseAuditCorrelationId(row["correlation_id"]);
  const auditEventId = parseAuditEventId(row["audit_event_id"]);
  if (
    caseId !== expectedIds.caseId ||
    boardId !== expectedIds.boardId ||
    workflowRunId !== expectedIds.workflowRunId ||
    receiptId !== expectedIds.receiptId ||
    auditCorrelationId !== expectedIds.auditCorrelationId ||
    auditEventId !== expectedIds.auditEventId
  ) {
    throw new TypeError("persisted business IDs do not match the normalized intake identity");
  }

  const details = parseJsonObject(requireString(row, "details_json"), "audit details");
  const source = details["source"];
  if (
    details["contractVersion"] !== NORMALIZED_INTAKE_CONTRACT ||
    details["synthetic"] !== true ||
    details["payloadDigest"] !== payloadDigest ||
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source)
  ) {
    throw new TypeError("audit details do not correlate the normalized intake contract");
  }
  const auditSource = source as Record<string, unknown>;
  if (
    auditSource["appId"] !== appId ||
    auditSource["cursor"] !== cursor ||
    auditSource["conversationId"] !== conversationId ||
    auditSource["messageId"] !== messageId ||
    auditSource["messageSequence"] !== messageSequence
  ) {
    throw new TypeError("audit source does not correlate the persisted inbox receipt");
  }

  return {
    auditCorrelationId,
    auditEventId,
    boardId,
    boardRevision,
    caseId,
    caseStatus,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    firstEnvelopeEventId,
    firstReceivedAt,
    migrationId: MIGRATION_ID,
    payloadDigest,
    receiptId,
    receiptStatus: "PROCESSED",
    workflowDefinition: FIXED_WORKFLOW_DEFINITION,
    workflowRevision,
    workflowRunId,
    workflowState,
  };
}

function assertPersistedIntakeMatches(
  row: PersistenceRow,
  persisted: PersistedIntakeAuthority,
  input: NormalizedSyntheticIntake,
  ids: IntakeBusinessIds,
): void {
  const expectedPairs: ReadonlyArray<readonly [unknown, unknown, string]> = [
    [persisted.caseId, ids.caseId, "case ID"],
    [persisted.boardId, ids.boardId, "board ID"],
    [persisted.workflowRunId, ids.workflowRunId, "workflow Run ID"],
    [persisted.receiptId, ids.receiptId, "receipt ID"],
    [persisted.payloadDigest, input.payloadDigest, "payload digest"],
    [persisted.auditCorrelationId, ids.auditCorrelationId, "audit correlation ID"],
    [persisted.auditEventId, ids.auditEventId, "audit event ID"],
    [requireString(row, "app_id"), input.appId, "App ID"],
    [requireInteger(row, "cursor"), input.cursor, "cursor"],
    [requireString(row, "source_conversation_id"), input.conversationId, "conversation ID"],
    [requireString(row, "source_message_id"), input.messageId, "message ID"],
    [requireInteger(row, "source_message_sequence"), input.messageSequence, "message sequence"],
    [requireString(row, "source_actor_id"), input.actorId, "actor ID"],
    [requireString(row, "objective"), input.objective, "objective"],
  ];
  for (const [actual, expected, label] of expectedPairs) {
    if (actual !== expected) {
      throw new Error(`replayed intake conflicts with persisted ${label}`);
    }
  }
}

const MAGICCHAT_PROTOCOL_SELECT = `SELECT
  s.schema_version AS magicchat_inbox_schema_version,
  s.app_id,
  s.cursor,
  s.receipt_id,
  s.case_id,
  s.board_id,
  s.workflow_run_id,
  s.correlation_id,
  s.event_role,
  s.normalized_body,
  s.reply_to_message_id,
  s.message_created_at,
  s.business_outcome,
  s.business_stable,
  s.ack_state,
  s.ack_action_id,
  s.created_at AS inbox_state_created_at,
  s.stable_at,
  s.ack_confirmed_at,
  r.schema_version AS receipt_schema_version,
  r.envelope_event_id,
  r.event_type,
  r.payload_digest,
  r.source_conversation_id,
  r.source_message_id,
  r.source_message_sequence,
  r.source_actor_id,
  r.processing_status,
  r.received_at,
  b.revision AS board_revision,
  w.state AS workflow_state,
  w.revision AS workflow_revision,
  q.board_entry_id AS question_entry_id,
  q.schema_version AS question_schema_version,
  q.board_id AS question_board_id,
  q.case_id AS question_case_id,
  q.entry_type AS question_entry_type,
  q.status AS question_status,
  q.author_type AS question_author_type,
  q.author_id AS question_author_id,
  q.payload_json AS question_payload_json,
  q.source_refs_json AS question_source_refs_json,
  q.based_on_json AS question_based_on_json,
  q.contradicts_json AS question_contradicts_json,
  q.supersedes_json AS question_supersedes_json,
  q.visibility AS question_visibility,
  q.trust_level AS question_trust_level,
  q.instruction_authority AS question_instruction_authority,
  q.created_revision AS question_created_revision,
  q.content_digest AS question_content_digest,
  q.created_at AS question_created_at,
  ch.challenge_id,
  source_s.correlation_id AS challenge_correlation_id,
  ch.schema_version AS challenge_schema_version,
  ch.challenge_version,
  ch.state AS challenge_state,
  ch.expected_app_id,
  ch.expected_conversation_id,
  ch.expected_actor_id,
  ch.expected_input_contract,
  ch.source_receipt_id,
  ch.source_cursor,
  ch.source_message_id AS challenge_source_message_id,
  ch.source_message_sequence AS challenge_source_message_sequence,
  ch.clarification_action_id,
  ch.clarification_message_id,
  ch.clarification_message_sequence,
  ch.expires_at,
  ch.created_at AS challenge_created_at,
  ch.ready_at AS challenge_ready_at,
  ch.resolved_by_receipt_id,
  ch.resolved_at,
  source_s.event_role AS challenge_source_event_role,
  source_s.app_id AS challenge_source_state_app_id,
  source_s.cursor AS challenge_source_state_cursor,
  source_s.stable_at AS challenge_source_stable_at,
  p.state AS clarification_action_state,
  p.schema_version AS clarification_action_schema_version,
  p.receipt_id AS clarification_action_receipt_id,
  p.action_kind AS clarification_action_kind,
  p.idempotency_key AS clarification_idempotency_key,
  p.payload_digest AS clarification_action_payload_digest,
  p.created_at AS clarification_action_created_at,
  rpc.schema_version AS rpc_schema_version,
  rpc.receipt_id AS clarification_rpc_receipt_id,
  rpc.request_envelope_id AS clarification_request_envelope_id,
  rpc.rpc_method AS clarification_rpc_method,
  rpc.request_digest AS clarification_request_digest,
  rpc.request_json,
  rpc.confirmation_json AS clarification_confirmation_json,
  rpc.confirmed_external_id AS clarification_confirmed_external_id,
  rpc.created_at AS clarification_rpc_created_at,
  rpc.confirmed_at AS clarification_rpc_confirmed_at,
  clarification_message.message_record_id AS clarification_message_record_id,
  clarification_message.schema_version AS clarification_message_schema_version,
  clarification_message.receipt_id AS clarification_message_receipt_id,
  clarification_message.action_id AS clarification_message_action_id,
  clarification_message.challenge_id AS clarification_message_challenge_id,
  clarification_message.purpose AS clarification_message_purpose,
  clarification_message.conversation_id AS confirmed_message_conversation_id,
  clarification_message.message_id AS confirmed_message_id,
  clarification_message.message_sequence AS confirmed_message_sequence,
  clarification_message.confirmed_at AS clarification_message_confirmed_at,
  source_r.app_id AS challenge_source_app_id,
  source_r.cursor AS challenge_source_receipt_cursor,
  source_r.source_conversation_id AS challenge_source_conversation_id,
  source_r.source_message_id AS challenge_source_receipt_message_id,
  source_r.source_message_sequence AS challenge_source_receipt_message_sequence,
  source_r.source_actor_id AS challenge_source_actor_id,
  source_r.received_at AS challenge_source_received_at,
  ack.action_id AS selected_ack_action_id,
  ack.state AS ack_action_state,
  ack.schema_version AS ack_action_schema_version,
  ack.receipt_id AS ack_action_receipt_id,
  ack.action_kind AS ack_action_kind,
  ack.idempotency_key AS ack_idempotency_key,
  ack.payload_digest AS ack_action_payload_digest,
  ack.created_at AS ack_action_created_at,
  ack_rpc.schema_version AS ack_rpc_schema_version,
  ack_rpc.receipt_id AS ack_rpc_receipt_id,
  ack_rpc.request_envelope_id AS ack_request_envelope_id,
  ack_rpc.rpc_method AS ack_rpc_method,
  ack_rpc.request_json AS ack_request_json,
  ack_rpc.request_digest AS ack_request_digest,
  ack_rpc.confirmation_json AS ack_confirmation_json,
  ack_rpc.created_at AS ack_rpc_created_at,
  ack_rpc.confirmed_at AS ack_rpc_confirmed_at
FROM magicchat_inbox_states AS s
JOIN inbox_receipts AS r ON r.receipt_id = s.receipt_id AND r.case_id = s.case_id
JOIN boards AS b ON b.board_id = s.board_id AND b.case_id = s.case_id
JOIN workflow_runs AS w ON w.workflow_run_id = s.workflow_run_id AND w.case_id = s.case_id
JOIN wait_challenges AS ch ON ch.workflow_run_id = s.workflow_run_id AND ch.case_id = s.case_id
JOIN magicchat_inbox_states AS source_s ON source_s.receipt_id = ch.source_receipt_id
JOIN inbox_receipts AS source_r ON source_r.receipt_id = ch.source_receipt_id AND source_r.case_id = ch.case_id
JOIN board_entries AS q ON q.board_entry_id = ch.question_entry_id AND q.case_id = s.case_id
JOIN pending_side_effects AS p ON p.action_id = ch.clarification_action_id AND p.case_id = s.case_id
JOIN magicchat_rpc_actions AS rpc ON rpc.action_id = p.action_id AND rpc.case_id = s.case_id
LEFT JOIN magicchat_messages AS clarification_message
  ON clarification_message.action_id = p.action_id AND clarification_message.case_id = s.case_id
LEFT JOIN pending_side_effects AS ack ON ack.action_id = s.ack_action_id AND ack.case_id = s.case_id
LEFT JOIN magicchat_rpc_actions AS ack_rpc ON ack_rpc.action_id = ack.action_id AND ack_rpc.case_id = s.case_id`;

function queryMagicChatProtocol(
  database: DatabaseSync,
  appId: string,
  cursor: number,
): PersistenceRow | undefined {
  const rows = database
    .prepare(`${MAGICCHAT_PROTOCOL_SELECT} WHERE s.app_id = ? AND s.cursor = ?`)
    .all(appId, cursor);
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw new Error("MagicChat protocol receipt must resolve to exactly one durable state");
  }
  return parsePersistenceRow(rows[0], "MagicChat protocol state");
}

function queryMagicChatProtocols(database: DatabaseSync, appId: string): readonly PersistenceRow[] {
  return database
    .prepare(`${MAGICCHAT_PROTOCOL_SELECT} WHERE s.app_id = ? ORDER BY s.cursor`)
    .all(appId)
    .map((value, index) => parsePersistenceRow(value, `MagicChat protocol state ${index}`));
}

function queryMagicChatEventRoleByReceipt(
  database: DatabaseSync,
  receiptId: InboxReceiptId,
): "INTAKE" | "CLARIFICATION_REPLY" | undefined {
  const value = database
    .prepare("SELECT event_role FROM magicchat_inbox_states WHERE receipt_id = ?")
    .get(receiptId);
  if (value === undefined) {
    return undefined;
  }
  const row = parsePersistenceRow(value, "MagicChat inbox event role");
  return requireOneOf(row, "event_role", ["INTAKE", "CLARIFICATION_REPLY"] as const);
}

function parseOptionalString(row: PersistenceRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${column} must be a persisted string or null`);
  }
  return value;
}

function parseOptionalInteger(row: PersistenceRow, column: string): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${column} must be a persisted safe integer or null`);
  }
  return value;
}

function requireExactObjectKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} keys must be exactly ${sortedExpected.join(", ")}`);
  }
}

function requireAllowedObjectKeys(
  value: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  const missing = requiredKeys.find((key) => !Object.hasOwn(value, key));
  if (unexpected !== undefined || missing !== undefined) {
    throw new TypeError(`${label} does not match the pinned MagicChat struct`);
  }
}

function parseMessageSendRequest(value: string, expectedConversationId: string): MagicChatMessageSendRequest {
  const request = parseJsonObject(value, "MagicChat message.send request");
  requireExactObjectKeys(request, ["v", "id", "kind", "method", "payload"], "MagicChat message.send request");
  if (request["v"] !== 1 || request["kind"] !== "request") {
    throw new TypeError("persisted MagicChat RPC must be a request envelope");
  }
  const id = requireStableIdentifier({ value: request["id"] }, "value");
  if (!/^request_[0-9a-f]{64}$/u.test(id)) {
    throw new TypeError("persisted MagicChat request Envelope ID is invalid");
  }
  if (request["method"] !== "message.send") {
    throw new TypeError("persisted clarification RPC must be message.send");
  }
  const payload = asProtocolObject(request["payload"], "MagicChat message.send payload");
  const target = asProtocolObject(payload["target"], "MagicChat message.send target");
  const message = asProtocolObject(payload["message"], "MagicChat message.send message");
  requireExactObjectKeys(payload, ["target", "message"], "MagicChat message.send payload");
  requireExactObjectKeys(target, ["type", "conversation_id"], "MagicChat message.send target");
  requireExactObjectKeys(message, ["type", "content"], "MagicChat message.send message");
  if (
    target["type"] !== "conversation" ||
    target["conversation_id"] !== expectedConversationId ||
    message["type"] !== "text" ||
    message["content"] !== CLARIFICATION_PROMPT
  ) {
    throw new TypeError("persisted clarification request does not match the active challenge");
  }
  return Object.freeze({
    id,
    kind: "request",
    method: "message.send",
    payload: Object.freeze({
      message: Object.freeze({ content: CLARIFICATION_PROMPT, type: "text" }),
      target: Object.freeze({ conversation_id: expectedConversationId, type: "conversation" }),
    }),
    v: 1,
  });
}

function parseAckRequest(value: string, expectedCursor: number): MagicChatAckRequest {
  const request = parseJsonObject(value, "MagicChat ACK request");
  requireExactObjectKeys(request, ["v", "id", "kind", "method", "payload"], "MagicChat ACK request");
  if (request["v"] !== 1 || request["kind"] !== "request") {
    throw new TypeError("persisted MagicChat ACK must be a request envelope");
  }
  const id = requireStableIdentifier({ value: request["id"] }, "value");
  if (!/^request_[0-9a-f]{64}$/u.test(id)) {
    throw new TypeError("persisted MagicChat ACK request Envelope ID is invalid");
  }
  if (request["method"] !== "events.ack") {
    throw new TypeError("persisted MagicChat ACK request must use events.ack");
  }
  const payload = asProtocolObject(request["payload"], "MagicChat ACK payload");
  if (payload["cursor"] !== expectedCursor || Object.keys(payload).length !== 1) {
    throw new TypeError("persisted MagicChat ACK request does not match its receipt cursor");
  }
  return Object.freeze({
    id,
    kind: "request",
    method: "events.ack",
    payload: Object.freeze({ cursor: expectedCursor }),
    v: 1,
  });
}

function asProtocolObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseValidatedAckRequest(
  row: PersistenceRow,
  snapshot: MagicChatProtocolSnapshot,
  auditCorrelationId: AuditCorrelationId,
): MagicChatAckRequest {
  requireLiteral(row, "ack_action_schema_version", CONTRACT_VERSIONS.pendingSideEffect);
  requireLiteral(row, "ack_rpc_schema_version", CONTRACT_VERSIONS.magicChatRpcAction);
  requireLiteral(row, "ack_action_kind", "ACK");
  requireLiteral(row, "ack_rpc_method", "events.ack");
  const request = parseAckRequest(requireString(row, "ack_request_json"), snapshot.cursor);
  const requestDigest = protocolDigest(request);
  const expectedIds = deriveAckBusinessIds({
    auditCorrelationId,
    caseId: snapshot.caseId,
    cursor: snapshot.cursor,
    receiptId: snapshot.receiptId,
    workflowRunId: snapshot.workflowRunId,
  });
  const actionCreatedAt = requireIsoInstant(row, "ack_action_created_at");
  const rpcCreatedAt = requireIsoInstant(row, "ack_rpc_created_at");
  if (
    parsePendingActionId(row["ack_action_id"]) !== expectedIds.actionId ||
    parsePendingActionId(row["selected_ack_action_id"]) !== expectedIds.actionId ||
    requireString(row, "ack_action_receipt_id") !== snapshot.receiptId ||
    requireString(row, "ack_rpc_receipt_id") !== snapshot.receiptId ||
    request.id !== expectedIds.requestEnvelopeId ||
    requireString(row, "ack_request_envelope_id") !== request.id ||
    requireString(row, "ack_idempotency_key") !== request.id ||
    requireHexDigest(row, "ack_action_payload_digest") !== requestDigest ||
    requireHexDigest(row, "ack_request_digest") !== requestDigest ||
    actionCreatedAt !== rpcCreatedAt ||
    actionCreatedAt !== requireIsoInstant(row, "stable_at")
  ) {
    throw new TypeError("persisted ACK request identity or digest is invalid");
  }
  return request;
}

interface ParsedMagicChatProtocol {
  readonly snapshot: MagicChatProtocolSnapshot;
  readonly nextRequest?: MagicChatRequestEnvelope;
}

function parseMagicChatProtocol(row: PersistenceRow): ParsedMagicChatProtocol {
  requireLiteral(row, "magicchat_inbox_schema_version", CONTRACT_VERSIONS.magicChatInboxState);
  requireLiteral(row, "question_schema_version", CONTRACT_VERSIONS.boardEntry);
  requireLiteral(row, "question_entry_type", "Question");
  requireLiteral(row, "challenge_schema_version", CONTRACT_VERSIONS.waitChallenge);
  requireLiteral(row, "rpc_schema_version", CONTRACT_VERSIONS.magicChatRpcAction);
  const eventRole = requireOneOf(row, "event_role", ["INTAKE", "CLARIFICATION_REPLY"] as const);
  const phase = requireOneOf(row, "business_outcome", [
    "CLARIFICATION_PENDING",
    "WAIT_FOR_INPUT",
    "UNMATCHED_INPUT",
    "EXPIRED_INPUT",
    "RESEARCHER",
  ] as const);
  const workflowState = requireOneOf(row, "workflow_state", WORKFLOW_STATES);
  const ackState = requireOneOf(row, "ack_state", ["NONE", "ACK_INTENT", "ACK_CONFIRMED"] as const);
  const challengeState = requireOneOf(row, "challenge_state", ["ACTIVE", "RESUMED", "EXPIRED"] as const);
  const challengeVersion = requireInteger(row, "challenge_version");
  if (challengeVersion !== CLARIFICATION_CHALLENGE_VERSION) {
    throw new TypeError("persisted clarification challenge version is unsupported");
  }
  const questionPayload = parseJsonObject(requireString(row, "question_payload_json"), "Question payload");
  if (
    questionPayload["expectedInputContract"] !== CLARIFICATION_EXPECTED_INPUT_CONTRACT ||
    questionPayload["missingInformation"] !== "decision_constraint" ||
    questionPayload["prompt"] !== CLARIFICATION_PROMPT ||
    Object.keys(questionPayload).length !== 3
  ) {
    throw new TypeError("persisted clarification Question payload is invalid");
  }

  const appId = requireStableIdentifier(row, "app_id");
  const expectedAppId = requireStableIdentifier(row, "expected_app_id");
  const expectedConversationId = requireStableIdentifier(row, "expected_conversation_id");
  const expectedActorId = requireStableIdentifier(row, "expected_actor_id");
  const sourceReceiptId = parseInboxReceiptId(row["source_receipt_id"]);
  const sourceReceivedAt = requireIsoInstant(row, "challenge_source_received_at");
  requireLiteral(row, "challenge_source_event_role", "INTAKE");
  if (
    expectedAppId !== appId ||
    requireStableIdentifier(row, "challenge_source_state_app_id") !== appId ||
    requireStableIdentifier(row, "challenge_source_app_id") !== appId ||
    requireInteger(row, "challenge_source_state_cursor") !== requireInteger(row, "source_cursor") ||
    requireInteger(row, "challenge_source_receipt_cursor") !== requireInteger(row, "source_cursor") ||
    requireStableIdentifier(row, "challenge_source_conversation_id") !== expectedConversationId ||
    requireStableIdentifier(row, "challenge_source_actor_id") !== expectedActorId ||
    requireStableIdentifier(row, "challenge_source_receipt_message_id") !==
      requireStableIdentifier(row, "challenge_source_message_id") ||
    requireInteger(row, "challenge_source_receipt_message_sequence") !==
      requireInteger(row, "challenge_source_message_sequence") ||
    requireIsoInstant(row, "challenge_created_at") !== sourceReceivedAt ||
    requireIsoInstant(row, "expires_at") !== clarificationExpiry(sourceReceivedAt)
  ) {
    throw new TypeError("persisted challenge binding does not match its source receipt");
  }
  const question: MagicChatQuestionSnapshot = Object.freeze({
    entryType: "Question",
    payload: CLARIFICATION_QUESTION_PAYLOAD,
    questionId: parseBoardEntryId(row["question_entry_id"]),
  });
  const clarificationMessageId = parseOptionalString(row, "clarification_message_id");
  const clarificationMessageSequence = parseOptionalInteger(row, "clarification_message_sequence");
  const challengeBase = {
    challengeId: parseWaitChallengeId(row["challenge_id"]),
    clarificationActionId: parsePendingActionId(row["clarification_action_id"]),
    expectedActorId,
    expectedConversationId,
    expectedInputContract: CLARIFICATION_EXPECTED_INPUT_CONTRACT,
    expiresAt: requireIsoInstant(row, "expires_at"),
    sourceCursor: requireInteger(row, "source_cursor"),
    sourceMessageId: requireStableIdentifier(row, "challenge_source_message_id"),
    state: challengeState,
    version: CLARIFICATION_CHALLENGE_VERSION,
  } as const;
  const challenge: MagicChatChallengeSnapshot = Object.freeze(
    clarificationMessageId === undefined && clarificationMessageSequence === undefined
      ? challengeBase
      : clarificationMessageId !== undefined && clarificationMessageSequence !== undefined
        ? {
            ...challengeBase,
            clarificationMessageId: requireStableIdentifier({ value: clarificationMessageId }, "value"),
            clarificationMessageSequence,
          }
        : (() => {
            throw new TypeError("persisted clarification message identity is partial");
          })(),
  );
  const snapshot: MagicChatProtocolSnapshot = Object.freeze({
    ackState,
    appId,
    boardId: parseBoardId(row["board_id"]),
    boardRevision: requireInteger(row, "board_revision"),
    caseId: parseCaseId(row["case_id"]),
    challenge,
    cursor: requireInteger(row, "cursor"),
    phase,
    question,
    receiptId: parseInboxReceiptId(row["receipt_id"]),
    workflowRevision: requireInteger(row, "workflow_revision"),
    workflowRunId: parseWorkflowRunId(row["workflow_run_id"]),
    workflowState,
  });
  if (
    (eventRole === "INTAKE" && phase !== "CLARIFICATION_PENDING" && phase !== "WAIT_FOR_INPUT") ||
    (eventRole === "CLARIFICATION_REPLY" &&
      phase !== "UNMATCHED_INPUT" &&
      phase !== "EXPIRED_INPUT" &&
      phase !== "RESEARCHER")
  ) {
    throw new TypeError("MagicChat receipt role and business outcome are inconsistent");
  }
  if (phase === "CLARIFICATION_PENDING") {
    if (
      challengeState !== "ACTIVE" ||
      workflowState !== "INTAKE" ||
      snapshot.workflowRevision !== 1 ||
      snapshot.boardRevision !== 1
    ) {
      throw new TypeError("pending clarification state is inconsistent with its active challenge");
    }
  } else if (challengeState === "ACTIVE") {
    if (
      workflowState !== "WAIT_FOR_INPUT" ||
      snapshot.workflowRevision !== 2 ||
      snapshot.boardRevision !== 1
    ) {
      throw new TypeError("active clarification challenge cannot coexist with the current Workflow or Board state");
    }
  } else if (challengeState === "RESUMED") {
    if (
      workflowState === "INTAKE" ||
      workflowState === "WAIT_FOR_INPUT" ||
      snapshot.workflowRevision < 3 ||
      snapshot.boardRevision < 2 ||
      phase === "EXPIRED_INPUT"
    ) {
      throw new TypeError("resumed clarification challenge is inconsistent with the downstream handoff");
    }
  } else if (
    workflowState !== "FAILED" ||
    snapshot.workflowRevision !== 3 ||
    snapshot.boardRevision !== 1 ||
    phase === "RESEARCHER"
  ) {
    throw new TypeError("expired clarification challenge is inconsistent with terminal failure");
  }

  requireLiteral(row, "receipt_schema_version", CONTRACT_VERSIONS.inboxReceipt);
  requireLiteral(row, "event_type", "message.created");
  requireLiteral(row, "processing_status", "PROCESSED");
  const reconstructedInput = normalizeSyntheticIntake({
    actorId: requireStableIdentifier(row, "source_actor_id"),
    appId: snapshot.appId,
    conversationId: requireStableIdentifier(row, "source_conversation_id"),
    cursor: snapshot.cursor,
    envelopeEventId: requireStableIdentifier(row, "envelope_event_id"),
    eventType: "message.created",
    messageId: requireStableIdentifier(row, "source_message_id"),
    messageSequence: requireInteger(row, "source_message_sequence"),
    objective: requireString(row, "normalized_body"),
    receivedAt: requireIsoInstant(row, "received_at"),
    schemaVersion: NORMALIZED_INTAKE_CONTRACT,
    synthetic: true,
  });
  if (reconstructedInput.payloadDigest !== requireHexDigest(row, "payload_digest")) {
    throw new TypeError("persisted MagicChat receipt payload digest is invalid");
  }
  const messageCreatedAt = requireIsoInstant(row, "message_created_at");
  if (Date.parse(messageCreatedAt) > Date.parse(reconstructedInput.receivedAt)) {
    throw new TypeError("persisted MagicChat message created_at follows its receipt time");
  }
  const replyToMessageId = parseOptionalString(row, "reply_to_message_id");
  if (replyToMessageId !== undefined) requireStableIdentifier({ value: replyToMessageId }, "value");
  if (eventRole === "CLARIFICATION_REPLY") {
    const matchesChallenge =
      reconstructedInput.conversationId === expectedConversationId &&
      reconstructedInput.actorId === expectedActorId &&
      replyToMessageId === clarificationMessageId &&
      reconstructedInput.messageSequence > requireInteger(row, "clarification_message_sequence");
    const expectedReplyPhase = !matchesChallenge
      ? "UNMATCHED_INPUT"
      : Date.parse(reconstructedInput.receivedAt) > Date.parse(requireIsoInstant(row, "expires_at"))
        ? "EXPIRED_INPUT"
        : "RESEARCHER";
    if (phase !== expectedReplyPhase) {
      throw new TypeError("persisted clarification reply business outcome does not match its durable challenge");
    }
  }

  const receiptIds = deriveReceiptBusinessIds({
    appId: snapshot.appId,
    cursor: snapshot.cursor,
    payloadDigest: requireHexDigest(row, "payload_digest"),
  });
  if (snapshot.receiptId !== receiptIds.receiptId || requireString(row, "correlation_id") !== receiptIds.auditCorrelationId) {
    throw new TypeError("persisted MagicChat receipt identity does not match (app_id, cursor) and payload");
  }
  const expectedClarificationIds = deriveClarificationBusinessIds({
    auditCorrelationId: parseAuditCorrelationId(row["challenge_correlation_id"]),
    caseId: snapshot.caseId,
    challengeVersion: CLARIFICATION_CHALLENGE_VERSION,
    workflowRunId: snapshot.workflowRunId,
  });
  const questionSourceRefs = [
    `magicchat:message:${requireStableIdentifier(row, "challenge_source_receipt_message_id")}`,
  ];
  const questionDigest = protocolDigest({
    authorId: "accord.ingress",
    authorType: "SYSTEM",
    basedOn: [],
    contradicts: [],
    entryType: "Question",
    instructionAuthority: "NONE",
    payload: CLARIFICATION_QUESTION_PAYLOAD,
    sourceRefs: questionSourceRefs,
    status: "ACCEPTED",
    supersedes: [],
    trustLevel: "CANDIDATE",
    visibility: "CASE",
  });
  if (
    parseBoardId(row["question_board_id"]) !== snapshot.boardId ||
    parseCaseId(row["question_case_id"]) !== snapshot.caseId ||
    requireString(row, "question_status") !== "ACCEPTED" ||
    requireString(row, "question_author_type") !== "SYSTEM" ||
    requireString(row, "question_author_id") !== "accord.ingress" ||
    requireString(row, "question_source_refs_json") !== JSON.stringify(questionSourceRefs) ||
    requireString(row, "question_based_on_json") !== "[]" ||
    requireString(row, "question_contradicts_json") !== "[]" ||
    requireString(row, "question_supersedes_json") !== "[]" ||
    requireString(row, "question_visibility") !== "CASE" ||
    requireString(row, "question_trust_level") !== "CANDIDATE" ||
    requireString(row, "question_instruction_authority") !== "NONE" ||
    requireInteger(row, "question_created_revision") !== 1 ||
    requireHexDigest(row, "question_content_digest") !== questionDigest ||
    requireIsoInstant(row, "question_created_at") !== sourceReceivedAt
  ) {
    throw new TypeError("clarification Question metadata is invalid");
  }
  const clarificationRequest = parseMessageSendRequest(requireString(row, "request_json"), expectedConversationId);
  const clarificationRequestDigest = protocolDigest(clarificationRequest);
  requireLiteral(row, "clarification_action_schema_version", CONTRACT_VERSIONS.pendingSideEffect);
  requireLiteral(row, "clarification_action_kind", "CLARIFICATION");
  requireLiteral(row, "clarification_rpc_method", "message.send");
  const clarificationActionCreatedAt = requireIsoInstant(row, "clarification_action_created_at");
  const clarificationRpcCreatedAt = requireIsoInstant(row, "clarification_rpc_created_at");
  if (
    challenge.challengeId !== expectedClarificationIds.challengeId ||
    question.questionId !== expectedClarificationIds.questionEntryId ||
    challenge.clarificationActionId !== expectedClarificationIds.actionId ||
    requireString(row, "clarification_action_receipt_id") !== sourceReceiptId ||
    requireString(row, "clarification_rpc_receipt_id") !== sourceReceiptId ||
    clarificationRequest.id !== expectedClarificationIds.requestEnvelopeId ||
    requireString(row, "clarification_request_envelope_id") !== clarificationRequest.id ||
    requireString(row, "clarification_idempotency_key") !== clarificationRequest.id ||
    requireHexDigest(row, "clarification_request_digest") !== clarificationRequestDigest ||
    requireHexDigest(row, "clarification_action_payload_digest") !== clarificationRequestDigest ||
    clarificationActionCreatedAt !== sourceReceivedAt ||
    clarificationRpcCreatedAt !== sourceReceivedAt
  ) {
    throw new TypeError("persisted clarification request identity or digest is invalid");
  }

  const clarificationActionState = requireOneOf(row, "clarification_action_state", [
    "PENDING",
    "CONFIRMED",
    "UNKNOWN",
    "FAILED",
  ] as const);
  if (phase === "CLARIFICATION_PENDING") {
    if (
      clarificationActionState !== "PENDING" ||
      ackState !== "NONE" ||
      requireInteger(row, "business_stable") !== 0 ||
      parseOptionalString(row, "clarification_confirmation_json") !== undefined ||
      parseOptionalString(row, "clarification_confirmed_external_id") !== undefined ||
      parseOptionalString(row, "clarification_rpc_confirmed_at") !== undefined ||
      parseOptionalString(row, "clarification_message_record_id") !== undefined ||
      parseOptionalString(row, "challenge_ready_at") !== undefined ||
      parseOptionalString(row, "challenge_source_stable_at") !== undefined
    ) {
      throw new TypeError("pending clarification state contains a premature confirmation");
    }
    return { nextRequest: clarificationRequest, snapshot };
  }
  if (clarificationActionState !== "CONFIRMED") {
    throw new TypeError("stable MagicChat protocol state requires a confirmed clarification action");
  }
  const persistedMessageRecordId = parseOptionalString(row, "clarification_message_record_id");
  if (persistedMessageRecordId === undefined) {
    throw new TypeError("confirmed clarification message record is invalid");
  }
  const confirmation = parseJsonObject(
    requireString(row, "clarification_confirmation_json"),
    "MagicChat clarification confirmation",
  );
  requireExactObjectKeys(
    confirmation,
    ["conversation_id", "created_at", "id", "sender_app_id", "sequence"],
    "MagicChat clarification confirmation",
  );
  const confirmedMessageId = requireStableIdentifier({ value: confirmation["id"] }, "value");
  const confirmedConversationId = requireStableIdentifier({ value: confirmation["conversation_id"] }, "value");
  const confirmedSenderAppId = requireStableIdentifier({ value: confirmation["sender_app_id"] }, "value");
  const confirmedMessageSequence = confirmation["sequence"];
  if (
    typeof confirmedMessageSequence !== "number" ||
    !Number.isSafeInteger(confirmedMessageSequence) ||
    confirmedMessageSequence < 1
  ) {
    throw new TypeError("confirmed clarification message record is invalid");
  }
  const confirmedMessageCreatedAt = parseCanonicalInstant(
    confirmation["created_at"],
    "persisted clarification message created_at",
  );
  const clarificationConfirmedAt = requireIsoInstant(row, "clarification_rpc_confirmed_at");
  const expectedMessageRecordId = deriveMagicChatMessageRecordId({
    actionId: challenge.clarificationActionId,
    messageId: confirmedMessageId,
  });
  requireLiteral(row, "clarification_message_schema_version", CONTRACT_VERSIONS.magicChatMessage);
  if (
    parseMagicChatMessageRecordId(persistedMessageRecordId) !== expectedMessageRecordId ||
    requireString(row, "clarification_message_receipt_id") !== sourceReceiptId ||
    parsePendingActionId(row["clarification_message_action_id"]) !== challenge.clarificationActionId ||
    parseWaitChallengeId(row["clarification_message_challenge_id"]) !== challenge.challengeId ||
    requireString(row, "clarification_message_purpose") !== "CLARIFICATION" ||
    confirmedConversationId !== expectedConversationId ||
    confirmedSenderAppId !== snapshot.appId ||
    requireString(row, "confirmed_message_conversation_id") !== confirmedConversationId ||
    confirmedMessageId !== clarificationMessageId ||
    requireString(row, "clarification_confirmed_external_id") !== confirmedMessageId ||
    requireString(row, "confirmed_message_id") !== confirmedMessageId ||
    confirmedMessageSequence !== clarificationMessageSequence ||
    requireInteger(row, "confirmed_message_sequence") !== confirmedMessageSequence ||
    requireIsoInstant(row, "clarification_message_confirmed_at") !== clarificationConfirmedAt ||
    requireIsoInstant(row, "challenge_ready_at") !== clarificationConfirmedAt ||
    requireIsoInstant(row, "challenge_source_stable_at") !== clarificationConfirmedAt ||
    Date.parse(confirmedMessageCreatedAt) > Date.parse(clarificationConfirmedAt) ||
    Date.parse(clarificationConfirmedAt) < Date.parse(clarificationRpcCreatedAt)
  ) {
    throw new TypeError("confirmed clarification message record is invalid");
  }
  if (ackState === "ACK_INTENT") {
    requireLiteral(row, "ack_action_state", "PENDING");
    const ackRequest = parseValidatedAckRequest(row, snapshot, receiptIds.auditCorrelationId);
    if (
      parseOptionalString(row, "ack_confirmation_json") !== undefined ||
      parseOptionalString(row, "ack_rpc_confirmed_at") !== undefined ||
      parseOptionalString(row, "ack_confirmed_at") !== undefined
    ) {
      throw new TypeError("persisted ACK intent cannot contain a confirmation");
    }
    return {
      nextRequest: ackRequest,
      snapshot,
    };
  }
  if (ackState === "ACK_CONFIRMED") {
    requireLiteral(row, "ack_action_state", "CONFIRMED");
    parseValidatedAckRequest(row, snapshot, receiptIds.auditCorrelationId);
    const confirmation = parseJsonObject(requireString(row, "ack_confirmation_json"), "MagicChat ACK confirmation");
    requireExactObjectKeys(confirmation, ["cursor"], "MagicChat ACK confirmation");
    const rpcConfirmedAt = requireIsoInstant(row, "ack_rpc_confirmed_at");
    if (
      confirmation["cursor"] !== snapshot.cursor ||
      requireIsoInstant(row, "ack_confirmed_at") !== rpcConfirmedAt ||
      Date.parse(rpcConfirmedAt) < Date.parse(requireIsoInstant(row, "ack_rpc_created_at"))
    ) {
      throw new TypeError("persisted ACK confirmation is invalid");
    }
    return { snapshot };
  }
  throw new TypeError("stable MagicChat protocol state requires a durable ACK intent or confirmation");
}

function protocolDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function clarificationExpiry(receivedAt: string): string {
  return new Date(Date.parse(receivedAt) + CLARIFICATION_TTL_MILLISECONDS).toISOString();
}

function createClarificationRequest(
  requestEnvelopeId: string,
  conversationId: string,
): MagicChatMessageSendRequest {
  return Object.freeze({
    id: requestEnvelopeId,
    kind: "request",
    method: "message.send",
    payload: Object.freeze({
      message: Object.freeze({ content: CLARIFICATION_PROMPT, type: "text" }),
      target: Object.freeze({ conversation_id: conversationId, type: "conversation" }),
    }),
    v: 1,
  });
}

function createAckRequest(requestEnvelopeId: string, cursor: number): MagicChatAckRequest {
  return Object.freeze({
    id: requestEnvelopeId,
    kind: "request",
    method: "events.ack",
    payload: Object.freeze({ cursor }),
    v: 1,
  });
}

const MAGICCHAT_ACTION_SELECT = `SELECT
  rpc.action_id,
  rpc.rpc_method,
  rpc.request_json,
  rpc.confirmation_json,
  rpc.confirmed_external_id,
  rpc.confirmed_at,
  rpc.created_at AS rpc_created_at,
  p.state AS action_state,
  p.created_at AS action_created_at,
  s.app_id,
  s.cursor,
  s.receipt_id,
  s.case_id,
  s.board_id,
  s.workflow_run_id,
  s.correlation_id,
  s.business_outcome,
  s.ack_state,
  w.state AS workflow_state,
  w.revision AS workflow_revision,
  ch.challenge_id,
  ch.state AS challenge_state,
  ch.expected_conversation_id,
  ch.expected_actor_id,
  ch.source_message_sequence,
  ch.clarification_message_id,
  ch.clarification_message_sequence
FROM magicchat_rpc_actions AS rpc
JOIN pending_side_effects AS p ON p.action_id = rpc.action_id AND p.case_id = rpc.case_id
JOIN magicchat_inbox_states AS s ON s.receipt_id = rpc.receipt_id AND s.case_id = rpc.case_id
JOIN workflow_runs AS w ON w.workflow_run_id = s.workflow_run_id AND w.case_id = s.case_id
JOIN wait_challenges AS ch ON ch.workflow_run_id = s.workflow_run_id AND ch.case_id = s.case_id`;

function queryMagicChatAction(
  database: DatabaseSync,
  appId: string,
  requestEnvelopeId: string,
): PersistenceRow | undefined {
  const rows = database
    .prepare(`${MAGICCHAT_ACTION_SELECT} WHERE s.app_id = ? AND rpc.request_envelope_id = ?`)
    .all(appId, requestEnvelopeId);
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw new Error("MagicChat response must resolve to exactly one pending RPC action");
  }
  return parsePersistenceRow(rows[0], "MagicChat RPC action");
}

interface ClarificationConfirmation {
  readonly messageId: string;
  readonly conversationId: string;
  readonly messageSequence: number;
  readonly messageCreatedAt: string;
  readonly senderAppId: string;
}

function parseClarificationConfirmation(
  data: Readonly<Record<string, unknown>>,
  receivedAt: string,
): ClarificationConfirmation {
  requireExactObjectKeys(data, ["conversation", "created", "message"], "MagicChat message.send confirmation");
  if (typeof data["created"] !== "boolean") {
    throw new TypeError("MagicChat message.send confirmation created must be a boolean");
  }
  const conversation = asProtocolObject(data["conversation"], "MagicChat message.send confirmation conversation");
  requireAllowedObjectKeys(
    conversation,
    ["id", "name", "type"],
    ["created_by_app_id", "parent", "source_message"],
    "MagicChat message.send confirmation conversation",
  );
  const message = asProtocolObject(data["message"], "MagicChat message.send confirmation message");
  requireAllowedObjectKeys(
    message,
    ["body", "created_at", "id", "sender", "seq", "summary"],
    ["reply_to_message_id"],
    "MagicChat message.send confirmation message",
  );
  const body = asProtocolObject(message["body"], "MagicChat message.send confirmation body");
  requireExactObjectKeys(body, ["type", "content"], "MagicChat message.send confirmation body");
  if (body["type"] !== "text" || body["content"] !== CLARIFICATION_PROMPT) {
    throw new TypeError("MagicChat message.send confirmation body does not match the clarification request");
  }
  const sender = asProtocolObject(message["sender"], "MagicChat message.send confirmation sender");
  requireAllowedObjectKeys(
    sender,
    ["id", "type"],
    ["email", "name", "nickname"],
    "MagicChat message.send confirmation sender",
  );
  const senderAppId = requireStableIdentifier({ value: sender["id"] }, "value");
  if (sender["type"] !== "app") {
    throw new TypeError("MagicChat clarified message sender must be an app");
  }
  if (typeof message["summary"] !== "string") {
    throw new TypeError("MagicChat confirmed message summary must be text");
  }
  const messageId = requireStableIdentifier({ value: message["id"] }, "value");
  const conversationId = requireStableIdentifier({ value: conversation["id"] }, "value");
  const messageSequence = message["seq"];
  if (typeof messageSequence !== "number" || !Number.isSafeInteger(messageSequence) || messageSequence < 1) {
    throw new TypeError("MagicChat confirmed message sequence must be a positive safe integer");
  }
  const messageCreatedAt = parseMagicChatInstant(message["created_at"], "MagicChat confirmed message created_at");
  if (Date.parse(receivedAt) < Date.parse(messageCreatedAt)) {
    throw new TypeError("MagicChat confirmation receivedAt cannot precede the confirmed message created_at");
  }
  return { conversationId, messageCreatedAt, messageId, messageSequence, senderAppId };
}

function assertConfirmationFollowsDurableRpcIntent(actionRow: PersistenceRow, receivedAt: string): void {
  const actionCreatedAt = requireIsoInstant(actionRow, "action_created_at");
  const rpcCreatedAt = requireIsoInstant(actionRow, "rpc_created_at");
  if (actionCreatedAt !== rpcCreatedAt) {
    throw new TypeError("MagicChat pending action and RPC request intent timestamps do not match");
  }
  if (Date.parse(receivedAt) < Date.parse(rpcCreatedAt)) {
    throw new TypeError("MagicChat RPC confirmation receivedAt cannot precede its durable request intent");
  }
}

function insertProtocolAudit(
  database: DatabaseSync,
  input: {
    readonly auditEventId: AuditEventId;
    readonly correlationId: AuditCorrelationId;
    readonly eventKind: string;
    readonly caseId: CaseId;
    readonly boardId: BoardId;
    readonly workflowRunId: WorkflowRunId;
    readonly receiptId: InboxReceiptId;
    readonly details: Readonly<Record<string, unknown>>;
    readonly recordedAt: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO audit_events (
         audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id,
         workflow_run_id, receipt_id, details_json, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.auditEventId,
      CONTRACT_VERSIONS.auditEvent,
      input.correlationId,
      input.eventKind,
      input.caseId,
      input.boardId,
      input.workflowRunId,
      input.receiptId,
      JSON.stringify(input.details),
      input.recordedAt,
    );
}

function confirmClarificationAction(
  database: DatabaseSync,
  actionRow: PersistenceRow,
  data: Readonly<Record<string, unknown>>,
  receivedAt: string,
): readonly [string, number] {
  requireLiteral(actionRow, "rpc_method", "message.send");
  assertConfirmationFollowsDurableRpcIntent(actionRow, receivedAt);
  const appId = requireStableIdentifier(actionRow, "app_id");
  const cursor = requireInteger(actionRow, "cursor");
  const receiptId = parseInboxReceiptId(actionRow["receipt_id"]);
  const caseId = parseCaseId(actionRow["case_id"]);
  const boardId = parseBoardId(actionRow["board_id"]);
  const workflowRunId = parseWorkflowRunId(actionRow["workflow_run_id"]);
  const correlationId = parseAuditCorrelationId(actionRow["correlation_id"]);
  const actionId = parsePendingActionId(actionRow["action_id"]);
  const challengeId = parseWaitChallengeId(actionRow["challenge_id"]);
  const confirmation = parseClarificationConfirmation(data, receivedAt);
  const expectedConversationId = requireStableIdentifier(actionRow, "expected_conversation_id");
  const sourceMessageSequence = requireInteger(actionRow, "source_message_sequence");
  if (confirmation.conversationId !== expectedConversationId) {
    throw new Error("MagicChat clarification confirmation has the wrong conversation");
  }
  if (confirmation.senderAppId !== appId) {
    throw new Error("MagicChat clarification confirmation has the wrong App sender");
  }
  if (confirmation.messageSequence <= sourceMessageSequence) {
    throw new Error("MagicChat clarification message must follow the source message sequence");
  }
  const canonicalConfirmation = JSON.stringify({
    conversation_id: confirmation.conversationId,
    created_at: confirmation.messageCreatedAt,
    id: confirmation.messageId,
    sender_app_id: confirmation.senderAppId,
    sequence: confirmation.messageSequence,
  });
  const actionState = requireOneOf(actionRow, "action_state", ["PENDING", "CONFIRMED", "UNKNOWN", "FAILED"] as const);
  if (actionState === "CONFIRMED") {
    if (
      requireString(actionRow, "confirmation_json") !== canonicalConfirmation ||
      requireString(actionRow, "confirmed_external_id") !== confirmation.messageId
    ) {
      throw new Error("replayed MagicChat clarification confirmation conflicts with durable confirmation");
    }
    return [appId, cursor];
  }
  if (actionState !== "PENDING") {
    throw new Error(`MagicChat clarification action cannot be confirmed from ${actionState}`);
  }
  requireLiteral(actionRow, "business_outcome", "CLARIFICATION_PENDING");
  requireLiteral(actionRow, "ack_state", "NONE");
  requireLiteral(actionRow, "workflow_state", "INTAKE");
  requireLiteral(actionRow, "challenge_state", "ACTIVE");
  if (
    parseOptionalString(actionRow, "clarification_message_id") !== undefined ||
    parseOptionalInteger(actionRow, "clarification_message_sequence") !== undefined
  ) {
    throw new Error("active clarification challenge already contains a confirmed message");
  }

  const ackIds = deriveAckBusinessIds({
    auditCorrelationId: correlationId,
    caseId,
    cursor,
    receiptId,
    workflowRunId,
  });
  const ackRequest = createAckRequest(ackIds.requestEnvelopeId, cursor);
  const ackRequestJson = JSON.stringify(ackRequest);
  const ackRequestDigest = protocolDigest(ackRequest);
  const messageRecordId = deriveMagicChatMessageRecordId({ actionId, messageId: confirmation.messageId });

  const sideEffectUpdate = database
    .prepare("UPDATE pending_side_effects SET state = 'CONFIRMED' WHERE action_id = ? AND state = 'PENDING'")
    .run(actionId);
  const rpcUpdate = database
    .prepare(
      `UPDATE magicchat_rpc_actions
       SET confirmation_json = ?, confirmed_external_id = ?, confirmed_at = ?
       WHERE action_id = ? AND confirmation_json IS NULL AND confirmed_at IS NULL`,
    )
    .run(canonicalConfirmation, confirmation.messageId, receivedAt, actionId);
  if (sideEffectUpdate.changes !== 1 || rpcUpdate.changes !== 1) {
    throw new Error("clarification confirmation lost its pending-action compare-and-set");
  }
  database
    .prepare(
      `INSERT INTO magicchat_messages (
         message_record_id, schema_version, case_id, workflow_run_id, receipt_id, action_id,
         challenge_id, purpose, conversation_id, message_id, message_sequence, confirmed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CLARIFICATION', ?, ?, ?, ?)`,
    )
    .run(
      messageRecordId,
      CONTRACT_VERSIONS.magicChatMessage,
      caseId,
      workflowRunId,
      receiptId,
      actionId,
      challengeId,
      confirmation.conversationId,
      confirmation.messageId,
      confirmation.messageSequence,
      receivedAt,
    );
  const challengeUpdate = database
    .prepare(
      `UPDATE wait_challenges
       SET clarification_message_id = ?, clarification_message_sequence = ?, ready_at = ?
       WHERE challenge_id = ? AND state = 'ACTIVE' AND clarification_message_id IS NULL`,
    )
    .run(confirmation.messageId, confirmation.messageSequence, receivedAt, challengeId);
  const workflowUpdate = database
    .prepare(
      `UPDATE workflow_runs
       SET state = 'WAIT_FOR_INPUT', revision = revision + 1
       WHERE workflow_run_id = ? AND case_id = ? AND state = 'INTAKE' AND revision = 1`,
    )
    .run(workflowRunId, caseId);
  if (challengeUpdate.changes !== 1 || workflowUpdate.changes !== 1) {
    throw new Error("clarification confirmation could not establish the durable wait state");
  }

  database
    .prepare(
      `INSERT INTO pending_side_effects (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, action_kind,
         idempotency_key, payload_digest, state, created_at
       ) VALUES (?, ?, ?, ?, ?, 'ACK', ?, ?, 'PENDING', ?)`,
    )
    .run(
      ackIds.actionId,
      CONTRACT_VERSIONS.pendingSideEffect,
      caseId,
      workflowRunId,
      receiptId,
      ackIds.requestEnvelopeId,
      ackRequestDigest,
      receivedAt,
    );
  database
    .prepare(
      `INSERT INTO magicchat_rpc_actions (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, request_envelope_id,
         rpc_method, request_json, request_digest, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'events.ack', ?, ?, ?)`,
    )
    .run(
      ackIds.actionId,
      CONTRACT_VERSIONS.magicChatRpcAction,
      caseId,
      workflowRunId,
      receiptId,
      ackIds.requestEnvelopeId,
      ackRequestJson,
      ackRequestDigest,
      receivedAt,
    );
  const inboxUpdate = database
    .prepare(
      `UPDATE magicchat_inbox_states
       SET business_outcome = 'WAIT_FOR_INPUT', business_stable = 1, stable_at = ?,
           ack_state = 'ACK_INTENT', ack_action_id = ?
       WHERE receipt_id = ? AND business_outcome = 'CLARIFICATION_PENDING'
         AND business_stable = 0 AND ack_state = 'NONE'`,
    )
    .run(receivedAt, ackIds.actionId, receiptId);
  if (inboxUpdate.changes !== 1) {
    throw new Error("clarification confirmation could not establish durable ACK intent");
  }

  insertProtocolAudit(database, {
    auditEventId: deriveProtocolAuditEventId(correlationId, "CLARIFICATION_CONFIRMED"),
    boardId,
    caseId,
    correlationId,
    details: {
      actionId,
      challengeId,
      messageId: confirmation.messageId,
      messageSequence: confirmation.messageSequence,
      senderAppId: confirmation.senderAppId,
    },
    eventKind: "CLARIFICATION_CONFIRMED",
    receiptId,
    recordedAt: receivedAt,
    workflowRunId,
  });
  insertProtocolAudit(database, {
    auditEventId: ackIds.auditEventId,
    boardId,
    caseId,
    correlationId,
    details: { actionId: ackIds.actionId, cursor, requestEnvelopeId: ackIds.requestEnvelopeId },
    eventKind: "ACK_INTENT",
    receiptId,
    recordedAt: receivedAt,
    workflowRunId,
  });
  return [appId, cursor];
}

function confirmAckAction(
  database: DatabaseSync,
  actionRow: PersistenceRow,
  data: Readonly<Record<string, unknown>>,
  receivedAt: string,
): readonly [string, number] {
  requireLiteral(actionRow, "rpc_method", "events.ack");
  assertConfirmationFollowsDurableRpcIntent(actionRow, receivedAt);
  const appId = requireStableIdentifier(actionRow, "app_id");
  const cursor = requireInteger(actionRow, "cursor");
  if (data["cursor"] !== cursor || Object.keys(data).length !== 1) {
    throw new Error("MagicChat cumulative ACK confirmation does not match the intended cursor");
  }
  const receiptId = parseInboxReceiptId(actionRow["receipt_id"]);
  const caseId = parseCaseId(actionRow["case_id"]);
  const boardId = parseBoardId(actionRow["board_id"]);
  const workflowRunId = parseWorkflowRunId(actionRow["workflow_run_id"]);
  const correlationId = parseAuditCorrelationId(actionRow["correlation_id"]);
  const actionId = parsePendingActionId(actionRow["action_id"]);
  const canonicalConfirmation = JSON.stringify({ cursor });
  const actionState = requireOneOf(actionRow, "action_state", ["PENDING", "CONFIRMED", "UNKNOWN", "FAILED"] as const);
  if (actionState === "CONFIRMED") {
    if (requireString(actionRow, "confirmation_json") !== canonicalConfirmation) {
      throw new Error("replayed MagicChat ACK confirmation conflicts with durable confirmation");
    }
    requireLiteral(actionRow, "ack_state", "ACK_CONFIRMED");
    return [appId, cursor];
  }
  if (actionState !== "PENDING") {
    throw new Error(`MagicChat ACK action cannot be confirmed from ${actionState}`);
  }
  requireLiteral(actionRow, "ack_state", "ACK_INTENT");
  if (requireString(actionRow, "business_outcome") === "CLARIFICATION_PENDING") {
    throw new Error("MagicChat ACK cannot confirm before business state is stable");
  }

  const sideEffectUpdate = database
    .prepare("UPDATE pending_side_effects SET state = 'CONFIRMED' WHERE action_id = ? AND state = 'PENDING'")
    .run(actionId);
  const rpcUpdate = database
    .prepare(
      `UPDATE magicchat_rpc_actions
       SET confirmation_json = ?, confirmed_at = ?
       WHERE action_id = ? AND confirmation_json IS NULL AND confirmed_at IS NULL`,
    )
    .run(canonicalConfirmation, receivedAt, actionId);
  const inboxUpdate = database
    .prepare(
      `UPDATE magicchat_inbox_states
       SET ack_state = 'ACK_CONFIRMED', ack_confirmed_at = ?
       WHERE receipt_id = ? AND ack_state = 'ACK_INTENT' AND ack_action_id = ? AND business_stable = 1`,
    )
    .run(receivedAt, receiptId, actionId);
  if (sideEffectUpdate.changes !== 1 || rpcUpdate.changes !== 1 || inboxUpdate.changes !== 1) {
    throw new Error("MagicChat ACK confirmation lost its durable intent compare-and-set");
  }
  insertProtocolAudit(database, {
    auditEventId: deriveProtocolAuditEventId(correlationId, "ACK_CONFIRMED"),
    boardId,
    caseId,
    correlationId,
    details: { actionId, cursor },
    eventKind: "ACK_CONFIRMED",
    receiptId,
    recordedAt: receivedAt,
    workflowRunId,
  });
  return [appId, cursor];
}

const ACTIVE_WAIT_CHALLENGE_SELECT = `SELECT
  ch.challenge_id,
  ch.case_id,
  ch.board_id,
  ch.workflow_run_id,
  ch.question_entry_id,
  ch.expected_app_id,
  ch.expected_conversation_id,
  ch.expected_actor_id,
  ch.expected_input_contract,
  ch.source_receipt_id,
  ch.source_cursor,
  ch.source_message_id,
  ch.source_message_sequence,
  ch.clarification_message_id,
  ch.clarification_message_sequence,
  ch.expires_at,
  ch.state AS challenge_state,
  w.state AS workflow_state,
  w.revision AS workflow_revision,
  b.revision AS board_revision
FROM wait_challenges AS ch
JOIN workflow_runs AS w ON w.workflow_run_id = ch.workflow_run_id AND w.case_id = ch.case_id
JOIN boards AS b ON b.board_id = ch.board_id AND b.case_id = ch.case_id`;

function queryActiveWaitChallenge(database: DatabaseSync, appId: string): PersistenceRow | undefined {
  const rows = database
    .prepare(`${ACTIVE_WAIT_CHALLENGE_SELECT} WHERE ch.expected_app_id = ? AND ch.state = 'ACTIVE'`)
    .all(appId);
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    throw new Error("one App must not have more than one active R003 wait challenge");
  }
  return parsePersistenceRow(rows[0], "active wait challenge");
}

function insertAckIntent(
  database: DatabaseSync,
  input: {
    readonly auditCorrelationId: AuditCorrelationId;
    readonly caseId: CaseId;
    readonly workflowRunId: WorkflowRunId;
    readonly receiptId: InboxReceiptId;
    readonly cursor: number;
    readonly createdAt: string;
  },
): ReturnType<typeof deriveAckBusinessIds> {
  const ackIds = deriveAckBusinessIds(input);
  const ackRequest = createAckRequest(ackIds.requestEnvelopeId, input.cursor);
  const ackRequestJson = JSON.stringify(ackRequest);
  const ackRequestDigest = protocolDigest(ackRequest);
  database
    .prepare(
      `INSERT INTO pending_side_effects (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, action_kind,
         idempotency_key, payload_digest, state, created_at
       ) VALUES (?, ?, ?, ?, ?, 'ACK', ?, ?, 'PENDING', ?)`,
    )
    .run(
      ackIds.actionId,
      CONTRACT_VERSIONS.pendingSideEffect,
      input.caseId,
      input.workflowRunId,
      input.receiptId,
      ackIds.requestEnvelopeId,
      ackRequestDigest,
      input.createdAt,
    );
  database
    .prepare(
      `INSERT INTO magicchat_rpc_actions (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, request_envelope_id,
         rpc_method, request_json, request_digest, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'events.ack', ?, ?, ?)`,
    )
    .run(
      ackIds.actionId,
      CONTRACT_VERSIONS.magicChatRpcAction,
      input.caseId,
      input.workflowRunId,
      input.receiptId,
      ackIds.requestEnvelopeId,
      ackRequestJson,
      ackRequestDigest,
      input.createdAt,
    );
  return ackIds;
}

function insertMatchingClarificationReply(
  database: DatabaseSync,
  input: NormalizedSyntheticIntake,
  message: NormalizedMagicChatMessageCreated,
  challengeRow: PersistenceRow,
): void {
  requireLiteral(challengeRow, "challenge_state", "ACTIVE");
  requireLiteral(challengeRow, "workflow_state", "WAIT_FOR_INPUT");
  requireLiteral(challengeRow, "expected_input_contract", CLARIFICATION_EXPECTED_INPUT_CONTRACT);
  const expectedAppId = requireStableIdentifier(challengeRow, "expected_app_id");
  const expectedConversationId = requireStableIdentifier(challengeRow, "expected_conversation_id");
  const expectedActorId = requireStableIdentifier(challengeRow, "expected_actor_id");
  const clarificationMessageId = requireStableIdentifier(challengeRow, "clarification_message_id");
  const clarificationMessageSequence = requireInteger(challengeRow, "clarification_message_sequence");
  const expiresAt = requireIsoInstant(challengeRow, "expires_at");
  if (
    input.appId !== expectedAppId ||
    input.conversationId !== expectedConversationId ||
    input.actorId !== expectedActorId ||
    message.replyToMessageId !== clarificationMessageId
  ) {
    throw new Error("MagicChat reply does not match the active challenge App, actor, conversation, and reply-to identity");
  }
  if (Date.parse(input.receivedAt) > Date.parse(expiresAt)) {
    throw new Error("MagicChat reply cannot resume an expired clarification challenge");
  }
  if (input.messageSequence <= clarificationMessageSequence) {
    throw new Error("MagicChat reply must follow the confirmed clarification message sequence");
  }

  const caseId = parseCaseId(challengeRow["case_id"]);
  const boardId = parseBoardId(challengeRow["board_id"]);
  const workflowRunId = parseWorkflowRunId(challengeRow["workflow_run_id"]);
  const challengeId = parseWaitChallengeId(challengeRow["challenge_id"]);
  const questionEntryId = parseBoardEntryId(challengeRow["question_entry_id"]);
  const receiptIds = deriveReceiptBusinessIds(input);
  const receiptId = receiptIds.receiptId;
  const resumedAuditEventId = deriveProtocolAuditEventId(receiptIds.auditCorrelationId, "CLARIFICATION_RESUMED");
  const deliveryIds: IntakeBusinessIds = {
    auditCorrelationId: receiptIds.auditCorrelationId,
    auditEventId: resumedAuditEventId,
    boardId,
    caseId,
    receiptId,
    workflowRunId,
  };
  database
    .prepare(
      `INSERT INTO inbox_receipts (
         receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type,
         payload_digest, source_conversation_id, source_message_id, source_message_sequence,
         source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at
       ) VALUES (?, ?, ?, ?, ?, 'message.created', ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.inboxReceipt,
      input.appId,
      input.cursor,
      input.envelopeEventId,
      input.payloadDigest,
      input.conversationId,
      input.messageId,
      input.messageSequence,
      input.actorId,
      caseId,
      boardId,
      workflowRunId,
      input.receivedAt,
    );
  recordInboxDelivery(database, input, deliveryIds);

  const observationEntryId = deriveObservationEntryId({
    caseId,
    messageId: input.messageId,
    receiptId,
    workflowRunId,
  });
  const observationPayload = {
    answer: input.objective,
    expectedInputContract: CLARIFICATION_EXPECTED_INPUT_CONTRACT,
    sourceMessageId: input.messageId,
    sourceMessageSequence: input.messageSequence,
  } as const;
  const observationSourceRefs = [`magicchat:message:${input.messageId}`];
  const observationDigest = protocolDigest({
    authorId: input.actorId,
    authorType: "HUMAN",
    basedOn: [questionEntryId],
    contradicts: [],
    entryType: "Observation",
    instructionAuthority: "NONE",
    payload: observationPayload,
    sourceRefs: observationSourceRefs,
    status: "ACCEPTED",
    supersedes: [],
    trustLevel: "UNTRUSTED",
    visibility: "CASE",
  });
  const boardUpdate = database
    .prepare("UPDATE boards SET revision = revision + 1 WHERE board_id = ? AND case_id = ? AND revision = 1")
    .run(boardId, caseId);
  if (boardUpdate.changes !== 1) {
    throw new Error("matching clarification reply could not acquire Board revision 2");
  }
  database
    .prepare(
      `INSERT INTO board_entries (
         board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type,
         author_id, payload_json, source_refs_json, based_on_json, contradicts_json,
         supersedes_json, visibility, trust_level, instruction_authority, created_revision,
         content_digest, created_at
       ) VALUES (?, ?, ?, ?, 'Observation', 'ACCEPTED', 'HUMAN', ?, ?, ?, ?, '[]', '[]',
         'CASE', 'UNTRUSTED', 'NONE', 2, ?, ?)`,
    )
    .run(
      observationEntryId,
      CONTRACT_VERSIONS.boardEntry,
      boardId,
      caseId,
      input.actorId,
      JSON.stringify(observationPayload),
      JSON.stringify(observationSourceRefs),
      JSON.stringify([questionEntryId]),
      observationDigest,
      input.receivedAt,
    );

  const challengeUpdate = database
    .prepare(
      `UPDATE wait_challenges
       SET state = 'RESUMED', resolved_by_receipt_id = ?, resolved_at = ?
       WHERE challenge_id = ? AND state = 'ACTIVE' AND clarification_message_id = ?`,
    )
    .run(receiptId, input.receivedAt, challengeId, clarificationMessageId);
  const workflowUpdate = database
    .prepare(
      `UPDATE workflow_runs
       SET state = 'RESEARCHER', revision = revision + 1
       WHERE workflow_run_id = ? AND case_id = ? AND state = 'WAIT_FOR_INPUT' AND revision = 2`,
    )
    .run(workflowRunId, caseId);
  if (challengeUpdate.changes !== 1 || workflowUpdate.changes !== 1) {
    throw new Error("matching clarification reply lost the active wait compare-and-set");
  }

  const ackIds = insertAckIntent(database, {
    auditCorrelationId: receiptIds.auditCorrelationId,
    caseId,
    createdAt: input.receivedAt,
    cursor: input.cursor,
    receiptId,
    workflowRunId,
  });
  database
    .prepare(
      `INSERT INTO magicchat_inbox_states (
         receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id,
         correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome,
         business_stable, ack_state, ack_action_id, created_at, stable_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLARIFICATION_REPLY', ?, ?, ?, 'RESEARCHER',
         1, 'ACK_INTENT', ?, ?, ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.magicChatInboxState,
      input.appId,
      input.cursor,
      caseId,
      boardId,
      workflowRunId,
      receiptIds.auditCorrelationId,
      input.objective, message.replyToMessageId ?? null, message.messageCreatedAt,
      ackIds.actionId,
      input.receivedAt,
      input.receivedAt,
    );
  insertProtocolAudit(database, {
    auditEventId: resumedAuditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: {
      challengeId,
      clarificationMessageId,
      observationEntryId,
      replyToMessageId: message.replyToMessageId,
      sourceMessageId: input.messageId,
    },
    eventKind: "CLARIFICATION_RESUMED",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
  insertProtocolAudit(database, {
    auditEventId: ackIds.auditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: { actionId: ackIds.actionId, cursor: input.cursor, requestEnvelopeId: ackIds.requestEnvelopeId },
    eventKind: "ACK_INTENT",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
}

function insertUnmatchedClarificationReply(
  database: DatabaseSync,
  input: NormalizedSyntheticIntake,
  message: NormalizedMagicChatMessageCreated,
  challengeRow: PersistenceRow,
): void {
  requireLiteral(challengeRow, "challenge_state", "ACTIVE");
  requireLiteral(challengeRow, "workflow_state", "WAIT_FOR_INPUT");
  const caseId = parseCaseId(challengeRow["case_id"]);
  const boardId = parseBoardId(challengeRow["board_id"]);
  const workflowRunId = parseWorkflowRunId(challengeRow["workflow_run_id"]);
  const challengeId = parseWaitChallengeId(challengeRow["challenge_id"]);
  const receiptIds = deriveReceiptBusinessIds(input);
  const receiptId = receiptIds.receiptId;
  const unmatchedAuditEventId = deriveProtocolAuditEventId(receiptIds.auditCorrelationId, "UNMATCHED_INPUT");
  const deliveryIds: IntakeBusinessIds = {
    auditCorrelationId: receiptIds.auditCorrelationId,
    auditEventId: unmatchedAuditEventId,
    boardId,
    caseId,
    receiptId,
    workflowRunId,
  };
  database
    .prepare(
      `INSERT INTO inbox_receipts (
         receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type,
         payload_digest, source_conversation_id, source_message_id, source_message_sequence,
         source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at
       ) VALUES (?, ?, ?, ?, ?, 'message.created', ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.inboxReceipt,
      input.appId,
      input.cursor,
      input.envelopeEventId,
      input.payloadDigest,
      input.conversationId,
      input.messageId,
      input.messageSequence,
      input.actorId,
      caseId,
      boardId,
      workflowRunId,
      input.receivedAt,
    );
  recordInboxDelivery(database, input, deliveryIds);
  const ackIds = insertAckIntent(database, {
    auditCorrelationId: receiptIds.auditCorrelationId,
    caseId,
    createdAt: input.receivedAt,
    cursor: input.cursor,
    receiptId,
    workflowRunId,
  });
  database
    .prepare(
      `INSERT INTO magicchat_inbox_states (
         receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id,
         correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome,
         business_stable, ack_state, ack_action_id, created_at, stable_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLARIFICATION_REPLY', ?, ?, ?, 'UNMATCHED_INPUT',
         1, 'ACK_INTENT', ?, ?, ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.magicChatInboxState,
      input.appId,
      input.cursor,
      caseId,
      boardId,
      workflowRunId,
      receiptIds.auditCorrelationId,
      input.objective, message.replyToMessageId ?? null, message.messageCreatedAt,
      ackIds.actionId,
      input.receivedAt,
      input.receivedAt,
    );
  insertProtocolAudit(database, {
    auditEventId: unmatchedAuditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: {
      actualActorId: input.actorId,
      actualConversationId: input.conversationId,
      replyToMessageId: message.replyToMessageId ?? null,
      challengeId,
      expectedActorId: requireStableIdentifier(challengeRow, "expected_actor_id"),
      expectedConversationId: requireStableIdentifier(challengeRow, "expected_conversation_id"),
      expectedReplyToMessageId: requireStableIdentifier(challengeRow, "clarification_message_id"),
      sourceMessageId: input.messageId,
    },
    eventKind: "UNMATCHED_INPUT",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
  insertProtocolAudit(database, {
    auditEventId: ackIds.auditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: { actionId: ackIds.actionId, cursor: input.cursor, requestEnvelopeId: ackIds.requestEnvelopeId },
    eventKind: "ACK_INTENT",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
}

function insertExpiredClarificationReply(
  database: DatabaseSync,
  input: NormalizedSyntheticIntake,
  message: NormalizedMagicChatMessageCreated,
  challengeRow: PersistenceRow,
): void {
  requireLiteral(challengeRow, "challenge_state", "ACTIVE");
  requireLiteral(challengeRow, "workflow_state", "WAIT_FOR_INPUT");
  const expiresAt = requireIsoInstant(challengeRow, "expires_at");
  if (Date.parse(input.receivedAt) <= Date.parse(expiresAt)) {
    throw new Error("clarification challenge is not expired at the reply receipt time");
  }
  const caseId = parseCaseId(challengeRow["case_id"]);
  const boardId = parseBoardId(challengeRow["board_id"]);
  const workflowRunId = parseWorkflowRunId(challengeRow["workflow_run_id"]);
  const challengeId = parseWaitChallengeId(challengeRow["challenge_id"]);
  const receiptIds = deriveReceiptBusinessIds(input);
  const receiptId = receiptIds.receiptId;
  const expiredAuditEventId = deriveProtocolAuditEventId(receiptIds.auditCorrelationId, "CHALLENGE_EXPIRED");
  const deliveryIds: IntakeBusinessIds = {
    auditCorrelationId: receiptIds.auditCorrelationId,
    auditEventId: expiredAuditEventId,
    boardId,
    caseId,
    receiptId,
    workflowRunId,
  };
  database
    .prepare(
      `INSERT INTO inbox_receipts (
         receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type,
         payload_digest, source_conversation_id, source_message_id, source_message_sequence,
         source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at
       ) VALUES (?, ?, ?, ?, ?, 'message.created', ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.inboxReceipt,
      input.appId,
      input.cursor,
      input.envelopeEventId,
      input.payloadDigest,
      input.conversationId,
      input.messageId,
      input.messageSequence,
      input.actorId,
      caseId,
      boardId,
      workflowRunId,
      input.receivedAt,
    );
  recordInboxDelivery(database, input, deliveryIds);
  const challengeUpdate = database
    .prepare(
      `UPDATE wait_challenges
       SET state = 'EXPIRED', resolved_by_receipt_id = ?, resolved_at = ?
       WHERE challenge_id = ? AND state = 'ACTIVE'`,
    )
    .run(receiptId, input.receivedAt, challengeId);
  const workflowUpdate = database
    .prepare(
      `UPDATE workflow_runs
       SET state = 'FAILED', revision = revision + 1
       WHERE workflow_run_id = ? AND case_id = ? AND state = 'WAIT_FOR_INPUT' AND revision = 2`,
    )
    .run(workflowRunId, caseId);
  const caseUpdate = database
    .prepare("UPDATE cases SET status = 'FAILED' WHERE case_id = ? AND status = 'OPEN'")
    .run(caseId);
  if (challengeUpdate.changes !== 1 || workflowUpdate.changes !== 1 || caseUpdate.changes !== 1) {
    throw new Error("expired clarification reply lost the active wait compare-and-set");
  }
  const ackIds = insertAckIntent(database, {
    auditCorrelationId: receiptIds.auditCorrelationId,
    caseId,
    createdAt: input.receivedAt,
    cursor: input.cursor,
    receiptId,
    workflowRunId,
  });
  database
    .prepare(
      `INSERT INTO magicchat_inbox_states (
         receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id,
         correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome,
         business_stable, ack_state, ack_action_id, created_at, stable_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLARIFICATION_REPLY', ?, ?, ?, 'EXPIRED_INPUT',
         1, 'ACK_INTENT', ?, ?, ?)`,
    )
    .run(
      receiptId,
      CONTRACT_VERSIONS.magicChatInboxState,
      input.appId,
      input.cursor,
      caseId,
      boardId,
      workflowRunId,
      receiptIds.auditCorrelationId,
      input.objective, message.replyToMessageId ?? null, message.messageCreatedAt,
      ackIds.actionId,
      input.receivedAt,
      input.receivedAt,
    );
  insertProtocolAudit(database, {
    auditEventId: expiredAuditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: { challengeId, expiresAt, replyToMessageId: message.replyToMessageId, sourceMessageId: input.messageId },
    eventKind: "CHALLENGE_EXPIRED",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
  insertProtocolAudit(database, {
    auditEventId: ackIds.auditEventId,
    boardId,
    caseId,
    correlationId: receiptIds.auditCorrelationId,
    details: { actionId: ackIds.actionId, cursor: input.cursor, requestEnvelopeId: ackIds.requestEnvelopeId },
    eventKind: "ACK_INTENT",
    receiptId,
    recordedAt: input.receivedAt,
    workflowRunId,
  });
}

function insertClarificationBoundary(
  database: DatabaseSync,
  input: NormalizedSyntheticIntake,
  message: NormalizedMagicChatMessageCreated,
  ids: IntakeBusinessIds,
): void {
  const clarificationIds = deriveClarificationBusinessIds({
    auditCorrelationId: ids.auditCorrelationId,
    caseId: ids.caseId,
    challengeVersion: CLARIFICATION_CHALLENGE_VERSION,
    workflowRunId: ids.workflowRunId,
  });
  const request = createClarificationRequest(clarificationIds.requestEnvelopeId, input.conversationId);
  const requestJson = JSON.stringify(request);
  const requestDigest = protocolDigest(request);
  const questionPayloadJson = JSON.stringify(CLARIFICATION_QUESTION_PAYLOAD);
  const questionSourceRefs = [`magicchat:message:${input.messageId}`];
  const questionDigest = protocolDigest({
    authorId: "accord.ingress",
    authorType: "SYSTEM",
    basedOn: [],
    contradicts: [],
    entryType: "Question",
    instructionAuthority: "NONE",
    payload: CLARIFICATION_QUESTION_PAYLOAD,
    sourceRefs: questionSourceRefs,
    status: "ACCEPTED",
    supersedes: [],
    trustLevel: "CANDIDATE",
    visibility: "CASE",
  });

  const boardUpdate = database
    .prepare("UPDATE boards SET revision = 1 WHERE board_id = ? AND case_id = ? AND revision = 0")
    .run(ids.boardId, ids.caseId);
  if (boardUpdate.changes !== 1) {
    throw new Error("clarification Question could not acquire Board revision 1");
  }
  database
    .prepare(
      `INSERT INTO board_entries (
         board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type,
         author_id, payload_json, source_refs_json, based_on_json, contradicts_json,
         supersedes_json, visibility, trust_level, instruction_authority, created_revision,
         content_digest, created_at
       ) VALUES (?, ?, ?, ?, 'Question', 'ACCEPTED', 'SYSTEM', 'accord.ingress', ?, ?, '[]', '[]',
         '[]', 'CASE', 'CANDIDATE', 'NONE', 1, ?, ?)`,
    )
    .run(
      clarificationIds.questionEntryId,
      CONTRACT_VERSIONS.boardEntry,
      ids.boardId,
      ids.caseId,
      questionPayloadJson,
      JSON.stringify(questionSourceRefs),
      questionDigest,
      input.receivedAt,
    );

  database
    .prepare(
      `INSERT INTO pending_side_effects (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, action_kind,
         idempotency_key, payload_digest, state, created_at
       ) VALUES (?, ?, ?, ?, ?, 'CLARIFICATION', ?, ?, 'PENDING', ?)`,
    )
    .run(
      clarificationIds.actionId,
      CONTRACT_VERSIONS.pendingSideEffect,
      ids.caseId,
      ids.workflowRunId,
      ids.receiptId,
      clarificationIds.requestEnvelopeId,
      requestDigest,
      input.receivedAt,
    );
  database
    .prepare(
      `INSERT INTO magicchat_rpc_actions (
         action_id, schema_version, case_id, workflow_run_id, receipt_id, request_envelope_id,
         rpc_method, request_json, request_digest, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'message.send', ?, ?, ?)`,
    )
    .run(
      clarificationIds.actionId,
      CONTRACT_VERSIONS.magicChatRpcAction,
      ids.caseId,
      ids.workflowRunId,
      ids.receiptId,
      clarificationIds.requestEnvelopeId,
      requestJson,
      requestDigest,
      input.receivedAt,
    );
  database
    .prepare(
      `INSERT INTO wait_challenges (
         challenge_id, schema_version, case_id, board_id, workflow_run_id, question_entry_id,
         challenge_version, expected_app_id, expected_conversation_id, expected_actor_id,
         expected_input_contract, source_receipt_id, source_cursor, source_message_id,
         source_message_sequence, clarification_action_id, expires_at, state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    )
    .run(
      clarificationIds.challengeId,
      CONTRACT_VERSIONS.waitChallenge,
      ids.caseId,
      ids.boardId,
      ids.workflowRunId,
      clarificationIds.questionEntryId,
      CLARIFICATION_CHALLENGE_VERSION,
      input.appId,
      input.conversationId,
      input.actorId,
      CLARIFICATION_EXPECTED_INPUT_CONTRACT,
      ids.receiptId,
      input.cursor,
      input.messageId,
      input.messageSequence,
      clarificationIds.actionId,
      clarificationExpiry(input.receivedAt),
      input.receivedAt,
    );
  database
    .prepare(
      `INSERT INTO magicchat_inbox_states (
         receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id,
         correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome,
         business_stable, ack_state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INTAKE', ?, ?, ?, 'CLARIFICATION_PENDING', 0, 'NONE', ?)`,
    )
    .run(
      ids.receiptId,
      CONTRACT_VERSIONS.magicChatInboxState,
      input.appId,
      input.cursor,
      ids.caseId,
      ids.boardId,
      ids.workflowRunId,
      ids.auditCorrelationId,
      input.objective, message.replyToMessageId ?? null, message.messageCreatedAt,
      input.receivedAt,
    );

  const details = JSON.stringify({
    challengeId: clarificationIds.challengeId,
    challengeVersion: CLARIFICATION_CHALLENGE_VERSION,
    expectedInputContract: CLARIFICATION_EXPECTED_INPUT_CONTRACT,
    messageCreatedAt: message.messageCreatedAt,
    questionEntryId: clarificationIds.questionEntryId,
    requestEnvelopeId: clarificationIds.requestEnvelopeId,
  });
  database
    .prepare(
      `INSERT INTO audit_events (
         audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id,
         workflow_run_id, receipt_id, details_json, recorded_at
       ) VALUES (?, ?, ?, 'CLARIFICATION_REQUIRED', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clarificationIds.auditEventId,
      CONTRACT_VERSIONS.auditEvent,
      ids.auditCorrelationId,
      ids.caseId,
      ids.boardId,
      ids.workflowRunId,
      ids.receiptId,
      details,
      input.receivedAt,
    );
}

function assertMagicChatReplayMatches(
  row: PersistenceRow,
  input: NormalizedSyntheticIntake,
  message: NormalizedMagicChatMessageCreated,
): void {
  const receiptIds = deriveReceiptBusinessIds(input);
  const expectedPairs: ReadonlyArray<readonly [unknown, unknown, string]> = [
    [requireString(row, "app_id"), input.appId, "App ID"],
    [requireInteger(row, "cursor"), message.cursor, "cursor"],
    [requireString(row, "source_conversation_id"), message.conversationId, "conversation ID"],
    [requireString(row, "source_message_id"), message.messageId, "message ID"],
    [requireInteger(row, "source_message_sequence"), message.messageSequence, "message sequence"],
    [requireString(row, "source_actor_id"), message.actorId, "actor ID"],
    [requireString(row, "normalized_body"), message.body, "message body"],
    [requireString(row, "message_created_at"), message.messageCreatedAt, "message created_at"],
    [parseOptionalString(row, "reply_to_message_id"), message.replyToMessageId, "reply-to message ID"],
    [requireString(row, "payload_digest"), input.payloadDigest, "payload digest"],
    [requireString(row, "receipt_id"), receiptIds.receiptId, "receipt ID"],
    [requireString(row, "correlation_id"), receiptIds.auditCorrelationId, "audit correlation ID"],
  ];
  for (const [actual, expected, label] of expectedPairs) {
    if (actual !== expected) {
      throw new Error(`replayed MagicChat event conflicts with persisted ${label}`);
    }
  }
}

function recordInboxDelivery(
  database: DatabaseSync,
  input: NormalizedSyntheticIntake,
  ids: IntakeBusinessIds,
): PersistedInboxDelivery {
  const deliveryId = deriveInboxDeliveryId({
    envelopeEventId: input.envelopeEventId,
    receiptId: ids.receiptId,
  });
  database
    .prepare(
      `INSERT INTO inbox_deliveries (
         delivery_id, schema_version, receipt_id, case_id, envelope_event_id, received_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(delivery_id) DO NOTHING`,
    )
    .run(
      deliveryId,
      CONTRACT_VERSIONS.inboxDelivery,
      ids.receiptId,
      ids.caseId,
      input.envelopeEventId,
      input.receivedAt,
    );

  const persistedRow = queryInboxDeliveryById(database, deliveryId);
  if (persistedRow === undefined) {
    throw new Error("delivery audit insert did not produce a queryable record");
  }
  const persisted = parsePersistedInboxDelivery(persistedRow);
  if (
    persisted.receiptId !== ids.receiptId ||
    persisted.caseId !== ids.caseId ||
    persisted.envelopeEventId !== input.envelopeEventId ||
    persisted.receivedAt !== input.receivedAt
  ) {
    throw new Error("replayed delivery conflicts with the immutable delivery audit");
  }
  return persisted;
}

function insertIntakeGraph(database: DatabaseSync, input: NormalizedSyntheticIntake, ids: IntakeBusinessIds): void {
  database
    .prepare(
      `INSERT INTO inbox_receipts (
         receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type,
         payload_digest, source_conversation_id, source_message_id, source_message_sequence,
         source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at
       ) VALUES (?, ?, ?, ?, ?, 'message.created', ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?)`,
    )
    .run(
      ids.receiptId,
      CONTRACT_VERSIONS.inboxReceipt,
      input.appId,
      input.cursor,
      input.envelopeEventId,
      input.payloadDigest,
      input.conversationId,
      input.messageId,
      input.messageSequence,
      input.actorId,
      ids.caseId,
      ids.boardId,
      ids.workflowRunId,
      input.receivedAt,
    );

  database
    .prepare(
      `INSERT INTO cases (
         case_id, schema_version, source_app_id, source_conversation_id, source_message_id,
         objective, status, board_id, workflow_run_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
    )
    .run(
      ids.caseId,
      CONTRACT_VERSIONS.case,
      input.appId,
      input.conversationId,
      input.messageId,
      input.objective,
      ids.boardId,
      ids.workflowRunId,
      input.receivedAt,
    );

  database
    .prepare(
      `INSERT INTO boards (board_id, schema_version, case_id, revision, created_at)
       VALUES (?, ?, ?, 0, ?)`,
    )
    .run(ids.boardId, CONTRACT_VERSIONS.board, ids.caseId, input.receivedAt);

  database
    .prepare(
      `INSERT INTO workflow_runs (
         workflow_run_id, schema_version, case_id, board_id, workflow_definition_id,
         state, revision, created_at
       ) VALUES (?, ?, ?, ?, ?, 'INTAKE', 1, ?)`,
    )
    .run(
      ids.workflowRunId,
      CONTRACT_VERSIONS.workflowRun,
      ids.caseId,
      ids.boardId,
      FIXED_WORKFLOW_DEFINITION_ID,
      input.receivedAt,
    );

  const details = JSON.stringify({
    contractVersion: NORMALIZED_INTAKE_CONTRACT,
    synthetic: true,
    payloadDigest: input.payloadDigest,
    source: {
      appId: input.appId,
      cursor: input.cursor,
      conversationId: input.conversationId,
      messageId: input.messageId,
      messageSequence: input.messageSequence,
    },
  });
  database
    .prepare(
      `INSERT INTO audit_events (
         audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id,
         workflow_run_id, receipt_id, details_json, recorded_at
       ) VALUES (?, ?, ?, 'INTAKE_COMMITTED', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ids.auditEventId,
      CONTRACT_VERSIONS.auditEvent,
      ids.auditCorrelationId,
      ids.caseId,
      ids.boardId,
      ids.workflowRunId,
      ids.receiptId,
      details,
      input.receivedAt,
    );
}

let authoritySavepointSequence = 0;
function runTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  const nested = (database as unknown as { readonly isTransaction?: boolean }).isTransaction === true;
  const savepoint = `authority_${authoritySavepointSequence += 1}`;
  database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (nested) {
      try { database.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); } catch (rollbackError) { throw new AggregateError([error, rollbackError], "SQLite transaction and rollback both failed"); }
      throw error;
    }
    rollbackAfterFailure(database, error);
  }
}

function validateInspectionKey(appId: unknown, cursor: unknown): readonly [string, number] {
  if (
    typeof appId !== "string" ||
    appId.length < 1 ||
    appId.length > 160 ||
    appId.trim() !== appId ||
    /[\p{White_Space}\p{Cc}]/u.test(appId)
  ) {
    throw new TypeError("appId must be a stable identifier");
  }
  if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 1) {
    throw new TypeError("cursor must be a positive safe integer");
  }
  return [appId, cursor];
}

export class AuthorityDatabase {
  readonly #database: DatabaseSync;
  #closed = false;

  private constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public static open(location: unknown): AuthorityDatabase {
    const databasePath = parseDatabaseLocation(location);
    assertDatabasePathIsNotSymlink(databasePath);
    mkdirSync(dirname(databasePath), { mode: 0o700, recursive: true });

    let database: DatabaseSync | undefined;
    try {
      const migrations = loadAuthorityMigrations();
      assertDatabasePathIsNotSymlink(databasePath);
      database = new DatabaseSync(databasePath);
      assertDatabasePathIsNotSymlink(databasePath);
      if (process.platform !== "win32") {
        chmodSync(databasePath, 0o600);
      }
      configureAndReadPragmas(database);
      migrateAndValidate(database, migrations);
      configureAndReadPragmas(database);
      return new AuthorityDatabase(database);
    } catch (error) {
      if (database !== undefined) {
        try {
          database.close();
        } catch {
          // Preserve the startup failure, which is the actionable refusal reason.
        }
      }
      if (error instanceof AuthorityStartupError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AuthorityStartupError(`refused SQLite authority startup: ${message}`, { cause: error });
    }
  }

  public close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  public readPragmas(): SqlitePragmaState {
    this.#assertOpen();
    return configureAndReadPragmas(this.#database);
  }

  public installTrustedSyntheticSourceManifest(installedAt: string) {
    this.#assertOpen();
    return installTrustedSyntheticSourceManifest(this.#database, installedAt);
  }

  public inspectSyntheticIntake(appId: unknown, cursor: unknown): PersistedIntakeAuthority | undefined {
    this.#assertOpen();
    const [validatedAppId, validatedCursor] = validateInspectionKey(appId, cursor);
    const row = queryPersistedIntake(this.#database, validatedAppId, validatedCursor);
    return row === undefined ? undefined : parsePersistedIntake(row);
  }

  public processSyntheticIntake(value: unknown): IntakeTransactionResult {
    this.#assertOpen();
    const input = normalizeSyntheticIntake(value);
    const ids = deriveIntakeBusinessIds({
      appId: input.appId,
      conversationId: input.conversationId,
      cursor: input.cursor,
      messageId: input.messageId,
      payloadDigest: input.payloadDigest,
      workflowDefinition: FIXED_WORKFLOW_DEFINITION,
    });

    const transaction = runTransaction(this.#database, () => {
      const existingRow = queryPersistedIntake(this.#database, input.appId, input.cursor);
      if (existingRow !== undefined) {
        const existing = parsePersistedIntake(existingRow);
        assertPersistedIntakeMatches(existingRow, existing, input, ids);
        return {
          delivery: recordInboxDelivery(this.#database, input, ids),
          outcome: "REPLAYED" as const,
        };
      }
      insertIntakeGraph(this.#database, input, ids);
      const delivery = recordInboxDelivery(this.#database, input, ids);
      const insertedRow = queryPersistedIntake(this.#database, input.appId, input.cursor);
      if (insertedRow === undefined) {
        throw new Error("intake transaction did not produce a queryable authority graph");
      }
      const inserted = parsePersistedIntake(insertedRow);
      assertPersistedIntakeMatches(insertedRow, inserted, input, ids);
      return { delivery, outcome: "CREATED" as const };
    });

    const persisted = this.inspectSyntheticIntake(input.appId, input.cursor);
    if (persisted === undefined) {
      throw new Error("committed intake is absent from persisted authority state");
    }
    const persistedRow = queryPersistedIntake(this.#database, input.appId, input.cursor);
    if (persistedRow === undefined) {
      throw new Error("committed intake disappeared during persisted readback");
    }
    assertPersistedIntakeMatches(persistedRow, persisted, input, ids);
    const persistedDeliveryRow = queryInboxDeliveryById(this.#database, transaction.delivery.deliveryId);
    if (persistedDeliveryRow === undefined) {
      throw new Error("committed delivery audit is absent from persisted authority state");
    }
    const persistedDelivery = parsePersistedInboxDelivery(persistedDeliveryRow);
    assertPersistedInboxDeliveryMatches(persistedDelivery, persistedRow, persisted);
    return { ...persisted, delivery: persistedDelivery, outcome: transaction.outcome };
  }

  public inspectMagicChatProtocol(appId: unknown, cursor: unknown): MagicChatProtocolSnapshot | undefined {
    this.#assertOpen();
    const [validatedAppId, validatedCursor] = validateInspectionKey(appId, cursor);
    const row = queryMagicChatProtocol(this.#database, validatedAppId, validatedCursor);
    return row === undefined ? undefined : parseMagicChatProtocol(row).snapshot;
  }

  public inspectPendingMagicChatRequests(appId: unknown): readonly MagicChatPendingRequest[] {
    this.#assertOpen();
    const [validatedAppId] = validateInspectionKey(appId, 1);
    const pending = queryMagicChatProtocols(this.#database, validatedAppId).flatMap((row) => {
      const parsed = parseMagicChatProtocol(row);
      return parsed.nextRequest === undefined
        ? []
        : [Object.freeze({ cursor: parsed.snapshot.cursor, request: parsed.nextRequest })];
    });
    return Object.freeze(pending);
  }

  /**
   * Persists the exact, least-privilege Profile context and its first READY
   * Attempt. This method performs no provider I/O.
   */
  public prepareProfileInvocation(input: ProfileInvocationRequest): PreparedProfileInvocation {
    this.#assertOpen();
    return prepareProfileInvocation(this.#database, input);
  }

  /** Atomically claims one persisted Attempt; callers invoke a port only after this returns. */
  public beginPreparedAttempt(invocationId: InvocationId, now: string): PreparedAttempt {
    this.#assertOpen();
    return beginPreparedAttempt(this.#database, invocationId, now);
  }

  /** Stores and arbitrates a provider response; only the fresh schema-valid response can append Board entries. */
  public commitProviderResult(
    invocation: PreparedProfileInvocation,
    attempt: PreparedAttempt,
    result: ProviderWire,
    recoveredTrustedReceivedAt?: string,
  ): ProviderResultArbitration {
    this.#assertOpen();
    return commitProviderResult(this.#database, invocation, attempt, result, recoveredTrustedReceivedAt);
  }

  /** Executes exactly one provider-port call. SDK retry and fallback are intentionally absent. */
  public executePreparedAttempt(
    invocation: PreparedProfileInvocation,
    port: ProviderPort,
    now: string,
  ): Promise<ProviderResultArbitration> {
    this.#assertOpen();
    return executePreparedAttempt(this.#database, invocation, port, now);
  }

  public processMagicChatEnvelope(
    appId: unknown,
    envelope: unknown,
    receivedAt: unknown,
  ): MagicChatProtocolResult {
    this.#assertOpen();
    const [validatedAppId] = validateInspectionKey(appId, 1);
    const validatedReceivedAt = parseCanonicalInstant(receivedAt, "MagicChat delivery receivedAt");
    const normalizedEnvelope = normalizeMagicChatEnvelope(envelope);
    if (normalizedEnvelope.kind === "RESPONSE") {
      if (!normalizedEnvelope.ok) {
        throw new Error(
          `MagicChat RPC ${normalizedEnvelope.requestEnvelopeId} failed with ${normalizedEnvelope.error.code}: ${normalizedEnvelope.error.message}`,
        );
      }
      const [responseAppId, responseCursor] = runTransaction(this.#database, () => {
        const action = queryMagicChatAction(
          this.#database,
          validatedAppId,
          normalizedEnvelope.requestEnvelopeId,
        );
        if (action === undefined) {
          throw new Error("MagicChat response does not match a durable pending RPC action");
        }
        const method = requireString(action, "rpc_method");
        if (method === "message.send") {
          return confirmClarificationAction(this.#database, action, normalizedEnvelope.payload, validatedReceivedAt);
        }
        if (method === "events.ack") {
          return confirmAckAction(this.#database, action, normalizedEnvelope.payload, validatedReceivedAt);
        }
        throw new Error(`unsupported durable MagicChat RPC method ${method}`);
      });
      const responseState = queryMagicChatProtocol(this.#database, responseAppId, responseCursor);
      if (responseState === undefined) {
        throw new Error("confirmed MagicChat RPC has no durable protocol receipt");
      }
      const persisted = parseMagicChatProtocol(responseState);
      return persisted.nextRequest === undefined
        ? { outcome: "CONFIRMED", snapshot: persisted.snapshot }
        : { nextRequest: persisted.nextRequest, outcome: "CONFIRMED", snapshot: persisted.snapshot };
    }
    const message = normalizedEnvelope;
    if (Date.parse(validatedReceivedAt) < Date.parse(message.messageCreatedAt)) {
      throw new TypeError("MagicChat delivery receivedAt cannot precede message created_at");
    }
    const input = normalizeSyntheticIntake({
      actorId: message.actorId,
      appId: validatedAppId,
      conversationId: message.conversationId,
      cursor: message.cursor,
      envelopeEventId: message.envelopeEventId,
      eventType: "message.created",
      messageId: message.messageId,
      messageSequence: message.messageSequence,
      objective: message.body,
      receivedAt: validatedReceivedAt,
      schemaVersion: NORMALIZED_INTAKE_CONTRACT,
      synthetic: true,
    });
    const intakeIds = deriveIntakeBusinessIds({
      appId: input.appId,
      conversationId: input.conversationId,
      cursor: input.cursor,
      messageId: input.messageId,
      payloadDigest: input.payloadDigest,
      workflowDefinition: FIXED_WORKFLOW_DEFINITION,
    });

    const outcome = runTransaction(this.#database, () => {
      const existingProtocol = queryMagicChatProtocol(this.#database, input.appId, input.cursor);
      if (existingProtocol !== undefined) {
        assertMagicChatReplayMatches(existingProtocol, input, message);
        const eventRole = requireOneOf(existingProtocol, "event_role", ["INTAKE", "CLARIFICATION_REPLY"] as const);
        if (eventRole === "INTAKE") {
          const existingIntakeRow = queryPersistedIntake(this.#database, input.appId, input.cursor);
          if (existingIntakeRow === undefined) {
            throw new Error("MagicChat intake replay has no correlated Issue 10 authority graph");
          }
          const existingIntake = parsePersistedIntake(existingIntakeRow);
          assertPersistedIntakeMatches(existingIntakeRow, existingIntake, input, intakeIds);
          recordInboxDelivery(this.#database, input, intakeIds);
        } else {
          const receiptIds = deriveReceiptBusinessIds(input);
          const replayIds: IntakeBusinessIds = {
            auditCorrelationId: receiptIds.auditCorrelationId,
            auditEventId: deriveProtocolAuditEventId(receiptIds.auditCorrelationId, "MESSAGE_REPLAYED"),
            boardId: parseBoardId(existingProtocol["board_id"]),
            caseId: parseCaseId(existingProtocol["case_id"]),
            receiptId: receiptIds.receiptId,
            workflowRunId: parseWorkflowRunId(existingProtocol["workflow_run_id"]),
          };
          recordInboxDelivery(this.#database, input, replayIds);
        }
        return "REPLAYED" as const;
      }
      if (queryPersistedIntake(this.#database, input.appId, input.cursor) !== undefined) {
        throw new Error("MagicChat receipt collides with a non-protocol synthetic intake");
      }
      const incompleteLower = this.#database
        .prepare(
          `SELECT cursor
           FROM magicchat_inbox_states
           WHERE app_id = ? AND cursor < ? AND ack_state <> 'ACK_CONFIRMED'
           ORDER BY cursor
           LIMIT 1`,
        )
        .get(input.appId, input.cursor);
      if (incompleteLower !== undefined) {
        const row = parsePersistenceRow(incompleteLower, "incomplete lower MagicChat cursor");
        throw new Error(
          `MagicChat cursor ${input.cursor} is blocked by incomplete lower cursor ${requireInteger(row, "cursor")}`,
        );
      }
      const processedHigher = this.#database
        .prepare(
          `SELECT cursor
           FROM magicchat_inbox_states
           WHERE app_id = ? AND cursor > ?
           ORDER BY cursor
           LIMIT 1`,
        )
        .get(input.appId, input.cursor);
      if (processedHigher !== undefined) {
        throw new Error("a previously unseen lower MagicChat cursor cannot arrive after a higher cursor");
      }

      const activeChallenge = queryActiveWaitChallenge(this.#database, input.appId);
      if (activeChallenge !== undefined) {
        const challengeExpired =
          Date.parse(input.receivedAt) > Date.parse(requireIsoInstant(activeChallenge, "expires_at"));
        const matchesChallenge =
          requireString(activeChallenge, "expected_conversation_id") === input.conversationId &&
          requireString(activeChallenge, "expected_actor_id") === input.actorId &&
          requireString(activeChallenge, "clarification_message_id") === message.replyToMessageId &&
          requireInteger(activeChallenge, "clarification_message_sequence") < input.messageSequence;
        if (!matchesChallenge) {
          insertUnmatchedClarificationReply(this.#database, input, message, activeChallenge);
        } else if (challengeExpired) {
          insertExpiredClarificationReply(this.#database, input, message, activeChallenge);
        } else {
          insertMatchingClarificationReply(this.#database, input, message, activeChallenge);
        }
        return "CREATED" as const;
      }
      const existingAppState = this.#database
        .prepare("SELECT cursor FROM magicchat_inbox_states WHERE app_id = ? ORDER BY cursor LIMIT 1")
        .get(input.appId);
      if (existingAppState !== undefined) {
        throw new Error("the fixed R003 App has no active clarification challenge for a new message");
      }

      insertIntakeGraph(this.#database, input, intakeIds);
      recordInboxDelivery(this.#database, input, intakeIds);
      insertClarificationBoundary(this.#database, input, message, intakeIds);
      return "CREATED" as const;
    });

    const persistedRow = queryMagicChatProtocol(this.#database, input.appId, input.cursor);
    if (persistedRow === undefined) {
      throw new Error("committed MagicChat intake has no durable protocol state");
    }
    const persisted = parseMagicChatProtocol(persistedRow);
    return persisted.nextRequest === undefined
      ? { outcome, snapshot: persisted.snapshot }
      : { nextRequest: persisted.nextRequest, outcome, snapshot: persisted.snapshot };
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("authority database is closed");
    }
  }
}

export function openAuthorityDatabase(location: unknown): AuthorityDatabase {
  return AuthorityDatabase.open(location);
}
