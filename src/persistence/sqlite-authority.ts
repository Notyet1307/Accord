import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { normalizeSyntheticIntake, type NormalizedSyntheticIntake } from "../contracts/intake.js";
import {
  CONTRACT_VERSIONS,
  DATABASE_SCHEMA_VERSION,
  FIXED_WORKFLOW_DEFINITION,
  FIXED_WORKFLOW_DEFINITION_ID,
  MIGRATION_ID,
  NORMALIZED_INTAKE_CONTRACT,
  SQLITE_PRAGMAS,
  TRANSACTION_AUTHORITY_TABLES,
} from "../contracts/versions.js";
import {
  deriveInboxDeliveryId,
  deriveIntakeBusinessIds,
  parseAuditCorrelationId,
  parseAuditEventId,
  parseBoardId,
  parseCaseId,
  parseInboxDeliveryId,
  parseInboxReceiptId,
  parseWorkflowRunId,
  type AuditCorrelationId,
  type AuditEventId,
  type BoardId,
  type CaseId,
  type InboxDeliveryId,
  type InboxReceiptId,
  type IntakeBusinessIds,
  type WorkflowRunId,
} from "../core/ids.js";
import { loadAuthorityMigration, type AuthorityMigration } from "./migration.js";
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

const REQUIRED_SCHEMA_OBJECTS = [
  "accord_schema_migrations",
  "workflow_definitions",
  ...TRANSACTION_AUTHORITY_TABLES,
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

function applyMigration(database: DatabaseSync, migration: AuthorityMigration): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migration.sql);
    const fingerprint = schemaFingerprint(database);
    if (fingerprint !== migration.schemaFingerprint) {
      throw new Error(`database schema drifted from ${migration.id} while applying the pinned migration`);
    }
    database
      .prepare(
        `INSERT INTO accord_schema_migrations (
           version, migration_id, migration_sha256, schema_fingerprint, applied_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(migration.version, migration.id, migration.sha256, migration.schemaFingerprint, new Date().toISOString());
    database.exec(`PRAGMA user_version = ${migration.version}`);
    database.exec("COMMIT");
  } catch (error) {
    rollbackAfterFailure(database, error);
  }
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

function validateAppliedSchema(database: DatabaseSync, migration: AuthorityMigration): void {
  const version = readUserVersion(database);
  if (version !== migration.version) {
    throw new Error(`unsupported database schema version ${version}; expected ${migration.version}`);
  }

  const migrationRows = database
    .prepare(
      `SELECT version, migration_id, migration_sha256, schema_fingerprint, applied_at
       FROM accord_schema_migrations`,
    )
    .all();
  if (migrationRows.length !== 1) {
    throw new Error("database must contain exactly one R003 migration record");
  }
  const row = parsePersistenceRow(migrationRows[0], "migration record");
  if (
    requireInteger(row, "version") !== migration.version ||
    requireString(row, "migration_id") !== migration.id ||
    requireHexDigest(row, "migration_sha256") !== migration.sha256
  ) {
    throw new Error("database migration identity does not match the pinned migration");
  }
  requireIsoInstant(row, "applied_at");

  const recordedFingerprint = requireHexDigest(row, "schema_fingerprint");
  const actualFingerprint = schemaFingerprint(database);
  if (recordedFingerprint !== migration.schemaFingerprint || actualFingerprint !== migration.schemaFingerprint) {
    throw new Error(`database schema drifted from ${migration.id}`);
  }

  const names = new Set(readSchemaObjects(database).filter((item) => item.type === "table").map((item) => item.name));
  for (const required of REQUIRED_SCHEMA_OBJECTS) {
    if (!names.has(required)) {
      throw new Error(`database schema is missing required table ${required}`);
    }
  }
  validateWorkflowDefinition(database);
}

function migrateAndValidate(database: DatabaseSync, migration: AuthorityMigration): void {
  checkDatabaseHealth(database);
  const version = readUserVersion(database);
  if (version === 0) {
    ensureFreshDatabaseHasNoSchema(database);
    applyMigration(database, migration);
  } else if (version !== migration.version) {
    throw new Error(`unsupported database schema version ${version}; expected ${migration.version}`);
  }
  validateAppliedSchema(database, migration);
  checkDatabaseHealth(database);
  validatePersistedAuthorityState(database);
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
    const graph = queryPersistedIntakeByReceiptId(database, delivery.receiptId);
    if (graph === undefined) {
      throw new Error("persisted authority integrity failed: a delivery audit has no complete processed receipt graph");
    }
    const persisted = parsePersistedIntake(graph);
    assertPersistedInboxDeliveryMatches(delivery, graph, persisted);
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

function runTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
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
      const migration = loadAuthorityMigration();
      assertDatabasePathIsNotSymlink(databasePath);
      database = new DatabaseSync(databasePath);
      assertDatabasePathIsNotSymlink(databasePath);
      if (process.platform !== "win32") {
        chmodSync(databasePath, 0o600);
      }
      configureAndReadPragmas(database);
      migrateAndValidate(database, migration);
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

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("authority database is closed");
    }
  }
}

export function openAuthorityDatabase(location: unknown): AuthorityDatabase {
  return AuthorityDatabase.open(location);
}
