import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { existsSync, lstatSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DATABASE_SCHEMA_VERSION, MIGRATION_FILE, SQLITE_PRAGMAS } from "../src/contracts/versions.js";
import { AuthorityStartupError, openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { SYNTHETIC_INTAKE, temporaryDatabase } from "./fixture.js";

const EXPECTED_SCHEMA_OBJECT_IDENTITIES = [
  "index:idx_audit_events_correlation",
  "index:idx_audit_events_intake_receipt",
  "index:idx_board_entries_case_revision",
  "index:idx_inbox_deliveries_receipt",
  "index:idx_inbox_receipts_case",
  "index:idx_pending_side_effects_state",
  "index:idx_runtime_invocations_run_status",
  "table:accord_schema_migrations",
  "table:approvals",
  "table:audit_events",
  "table:board_entries",
  "table:boards",
  "table:cases",
  "table:inbox_deliveries",
  "table:inbox_receipts",
  "table:pending_side_effects",
  "table:response_claims",
  "table:runtime_invocations",
  "table:workflow_definitions",
  "table:workflow_runs",
  "trigger:inbox_deliveries_immutable_collision",
  "trigger:inbox_deliveries_immutable_delete",
  "trigger:inbox_deliveries_immutable_update",
] as const;

function schemaObjectIdentities(path: string): readonly string[] {
  const database = new DatabaseSync(path);
  try {
    return database
      .prepare(
        `SELECT type, name
         FROM sqlite_schema
         WHERE substr(name, 1, 7) <> 'sqlite_' AND sql IS NOT NULL
         ORDER BY type, name`,
      )
      .all()
      .map((value) => {
        const row = value as Record<string, unknown>;
        assert.equal(typeof row["type"], "string");
        assert.equal(typeof row["name"], "string");
        return `${String(row["type"])}:${String(row["name"])}`;
      });
  } finally {
    database.close();
  }
}

function currentSchemaFingerprint(database: DatabaseSync): string {
  const objects = database
    .prepare(
      `SELECT type, name, tbl_name AS table_name, sql
       FROM sqlite_schema
       WHERE substr(name, 1, 7) <> 'sqlite_' AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all()
    .map((value) => {
      const row = value as Record<string, unknown>;
      return {
        type: row["type"],
        name: row["name"],
        tableName: row["table_name"],
        sql: row["sql"],
      };
    });
  return createHash("sha256").update(JSON.stringify(objects), "utf8").digest("hex");
}

test("startup applies and rechecks the pinned migration and durability PRAGMAs", () => {
  const temporary = temporaryDatabase("startup");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    assert.deepEqual(authority.readPragmas(), SQLITE_PRAGMAS);
    authority.close();
    assert.deepEqual(schemaObjectIdentities(temporary.path), EXPECTED_SCHEMA_OBJECT_IDENTITIES);

    if (process.platform !== "win32") {
      assert.equal(statSync(temporary.path).mode & 0o777, 0o600);
    }

    const raw = new DatabaseSync(temporary.path);
    const userVersion = raw.prepare("PRAGMA user_version").get() as Record<string, unknown>;
    const migrationCount = raw.prepare("SELECT count(*) AS count FROM accord_schema_migrations").get() as Record<
      string,
      unknown
    >;
    assert.equal(Object.values(userVersion)[0], DATABASE_SCHEMA_VERSION);
    assert.equal(migrationCount["count"], 1);
    raw.close();

    const reopened = openAuthorityDatabase(temporary.path);
    assert.deepEqual(reopened.readPragmas(), SQLITE_PRAGMAS);
    reopened.close();
    assert.deepEqual(schemaObjectIdentities(temporary.path), EXPECTED_SCHEMA_OBJECT_IDENTITIES);
  } finally {
    temporary.cleanup();
  }
});

test("schema discovery treats the sqlite_ internal prefix literally for tables, indexes, and triggers", () => {
  const nearPrefixTable = temporaryDatabase("near-prefix-table");
  const nearPrefixIndex = temporaryDatabase("near-prefix-index");
  const nearPrefixTrigger = temporaryDatabase("near-prefix-trigger");
  try {
    const unversioned = new DatabaseSync(nearPrefixTable.path);
    unversioned.exec("CREATE TABLE sqlitex_unversioned_table (id INTEGER PRIMARY KEY) STRICT");
    unversioned.close();
    assert.throws(
      () => openAuthorityDatabase(nearPrefixTable.path),
      (error: unknown) => error instanceof AuthorityStartupError && /unversioned SQLite database/u.test(error.message),
    );

    const indexedAuthority = openAuthorityDatabase(nearPrefixIndex.path);
    indexedAuthority.close();
    const indexed = new DatabaseSync(nearPrefixIndex.path);
    indexed.exec("CREATE INDEX sqliteX_unexpected_index ON cases (status)");
    indexed.close();
    assert.throws(
      () => openAuthorityDatabase(nearPrefixIndex.path),
      (error: unknown) => error instanceof AuthorityStartupError && /schema drifted/u.test(error.message),
    );

    const triggeredAuthority = openAuthorityDatabase(nearPrefixTrigger.path);
    triggeredAuthority.close();
    const triggered = new DatabaseSync(nearPrefixTrigger.path);
    triggered.exec(`
      CREATE TRIGGER sqlite9_unexpected_trigger
      AFTER INSERT ON cases
      BEGIN
        SELECT NEW.case_id;
      END;
    `);
    triggered.close();
    assert.throws(
      () => openAuthorityDatabase(nearPrefixTrigger.path),
      (error: unknown) => error instanceof AuthorityStartupError && /schema drifted/u.test(error.message),
    );
  } finally {
    nearPrefixTable.cleanup();
    nearPrefixIndex.cleanup();
    nearPrefixTrigger.cleanup();
  }
});

test("database constraints enforce ownership and stable identity", () => {
  const temporary = temporaryDatabase("constraints");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    authority.close();

    const raw = new DatabaseSync(temporary.path);
    raw.exec("PRAGMA foreign_keys = ON");
    assert.throws(
      () =>
        raw
          .prepare(
            `INSERT INTO boards (board_id, schema_version, case_id, revision, created_at)
             VALUES (?, 'accord.board/v1', ?, 0, ?)`,
          )
          .run(
            `board_${"0".repeat(64)}`,
            `case_${"0".repeat(64)}`,
            "2026-08-26T00:00:00.000Z",
          ),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(
      () =>
        raw
          .prepare(
            `INSERT INTO boards (board_id, schema_version, case_id, revision, created_at)
             VALUES ('not-a-board-id', 'accord.board/v1', ?, 0, ?)`,
          )
          .run(`case_${"0".repeat(64)}`, "2026-08-26T00:00:00.000Z"),
      /CHECK constraint failed/,
    );
    raw.close();
  } finally {
    temporary.cleanup();
  }
});

test("composite foreign keys reject cross-Case audit correlation", () => {
  const temporary = temporaryDatabase("audit-correlation");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const first = authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    const second = authority.processSyntheticIntake({
      ...SYNTHETIC_INTAKE,
      cursor: 2,
      envelopeEventId: "event-2",
      conversationId: "conversation-2",
      messageId: "message-2",
      messageSequence: 2,
      objective: "Second synthetic objective",
    });
    authority.close();

    const raw = new DatabaseSync(temporary.path);
    raw.exec("PRAGMA foreign_keys = ON");
    assert.throws(
      () =>
        raw
          .prepare("UPDATE audit_events SET board_id = ? WHERE audit_event_id = ?")
          .run(second.boardId, first.auditEventId),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(
      () =>
        raw
          .prepare("UPDATE audit_events SET workflow_run_id = ? WHERE audit_event_id = ?")
          .run(second.workflowRunId, first.auditEventId),
      /FOREIGN KEY constraint failed/,
    );
    raw.close();
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses unsupported and drifted schemas", () => {
  const versioned = temporaryDatabase("future-schema");
  const drifted = temporaryDatabase("drifted-schema");
  const unversioned = temporaryDatabase("unversioned-schema");
  try {
    const first = openAuthorityDatabase(versioned.path);
    first.close();
    const future = new DatabaseSync(versioned.path);
    future.exec("PRAGMA user_version = 2");
    future.close();
    assert.throws(
      () => openAuthorityDatabase(versioned.path),
      (error: unknown) => error instanceof AuthorityStartupError && /unsupported database schema version 2/u.test(error.message),
    );

    const second = openAuthorityDatabase(drifted.path);
    second.close();
    const changed = new DatabaseSync(drifted.path);
    changed.exec("DROP INDEX idx_inbox_receipts_case");
    changed.close();
    assert.throws(
      () => openAuthorityDatabase(drifted.path),
      (error: unknown) => error instanceof AuthorityStartupError && /schema drifted/u.test(error.message),
    );

    const unknown = new DatabaseSync(unversioned.path);
    unknown.exec("CREATE TABLE unexpected (id INTEGER PRIMARY KEY) STRICT");
    unknown.close();
    assert.throws(
      () => openAuthorityDatabase(unversioned.path),
      (error: unknown) => error instanceof AuthorityStartupError && /unversioned SQLite database/u.test(error.message),
    );
  } finally {
    versioned.cleanup();
    drifted.cleanup();
    unversioned.cleanup();
  }
});

test("startup compares schema integrity with the pinned migration rather than mutable database metadata", () => {
  const temporary = temporaryDatabase("forged-schema-fingerprint");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    authority.close();

    const changed = new DatabaseSync(temporary.path);
    changed.exec("DROP INDEX idx_inbox_receipts_case");
    changed
      .prepare("UPDATE accord_schema_migrations SET schema_fingerprint = ?")
      .run(currentSchemaFingerprint(changed));
    changed.close();

    let startupError: unknown;
    try {
      const unexpectedlyOpened = openAuthorityDatabase(temporary.path);
      unexpectedlyOpened.close();
    } catch (error) {
      startupError = error;
    }
    assert.ok(startupError instanceof AuthorityStartupError);
    assert.match(startupError.message, /schema drifted/u);
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses persisted foreign-key violations", () => {
  const temporary = temporaryDatabase("foreign-key-corrupt");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    authority.close();

    const unchecked = new DatabaseSync(temporary.path);
    unchecked.exec("PRAGMA foreign_keys = OFF");
    unchecked.prepare("UPDATE boards SET case_id = ?").run(`case_${"0".repeat(64)}`);
    unchecked.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) => error instanceof AuthorityStartupError && /foreign-key check failed/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a semantically partial persisted authority graph", () => {
  const temporary = temporaryDatabase("partial-authority");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    authority.close();

    const partial = new DatabaseSync(temporary.path);
    partial.exec("PRAGMA foreign_keys = ON; DELETE FROM audit_events");
    partial.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /processed receipt has no complete correlated graph/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup validates every processed receipt before graph correlation", () => {
  const temporary = temporaryDatabase("malformed-extra-receipt");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const persisted = authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    authority.close();

    const malformed = new DatabaseSync(temporary.path);
    malformed.exec("PRAGMA foreign_keys = ON");
    malformed
      .prepare(
        `INSERT INTO inbox_receipts (
           receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type,
           payload_digest, source_conversation_id, source_message_id, source_message_sequence,
           source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at
         ) VALUES (?, 'accord.inbox-receipt/v1', ?, 2, ?, 'message.created', ?, ?, ?, 2, ?, ?, ?, ?,
           'PROCESSED', ?)`,
      )
      .run(
        `receipt_${"f".repeat(64)}`,
        SYNTHETIC_INTAKE.appId,
        "event-malformed-extra-receipt",
        persisted.payloadDigest,
        "conversation-mismatched-to-case",
        "message-malformed-extra-receipt",
        SYNTHETIC_INTAKE.actorId,
        persisted.caseId,
        persisted.boardId,
        persisted.workflowRunId,
        "2026-08-26T00:01:00.000Z",
      );
    malformed.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError &&
        /processed receipt has no complete correlated graph/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup independently validates every intake-commit audit row", () => {
  const temporary = temporaryDatabase("orphan-intake-audit");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const persisted = authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    authority.close();

    const orphaned = new DatabaseSync(temporary.path);
    orphaned.exec("PRAGMA foreign_keys = ON");
    orphaned
      .prepare(
        `INSERT INTO audit_events (
           audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id,
           workflow_run_id, receipt_id, details_json, recorded_at
         ) VALUES (?, 'accord.audit-event/v1', ?, 'INTAKE_COMMITTED', ?, ?, ?, NULL, '{}', ?)`,
      )
      .run(
        `audit_${"f".repeat(64)}`,
        `corr_${"f".repeat(64)}`,
        persisted.caseId,
        persisted.boardId,
        persisted.workflowRunId,
        "2026-08-26T00:01:00.000Z",
      );
    orphaned.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError &&
        /intake-commit audit has no complete correlated graph/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup recomputes persisted contract digests and stable identity", () => {
  const temporary = temporaryDatabase("tampered-contract");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered.prepare("UPDATE cases SET objective = 'Tampered synthetic objective'").run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /payload digest does not match the normalized intake fields/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a corrupt SQLite file, a symlink path, and a dangling symlink path", () => {
  const corrupt = temporaryDatabase("corrupt");
  const target = temporaryDatabase("symlink-target");
  try {
    writeFileSync(corrupt.path, "not a SQLite database");
    assert.throws(() => openAuthorityDatabase(corrupt.path), AuthorityStartupError);

    if (process.platform !== "win32") {
      const permissionBoundary = Reflect.get(process, "permission");
      const permissionBoundaryEnabled = typeof permissionBoundary === "object" && permissionBoundary !== null;
      const linkPath = permissionBoundaryEnabled
        ? join(tmpdir(), "synthetic-authority-symlink")
        : `${target.path}.link`;
      const danglingLinkPath = permissionBoundaryEnabled
        ? join(tmpdir(), "synthetic-authority-dangling-symlink")
        : `${target.path}.dangling-link`;
      if (!permissionBoundaryEnabled) {
        writeFileSync(target.path, "target");
        symlinkSync(target.path, linkPath);
        symlinkSync(`${target.path}.missing`, danglingLinkPath);
      } else {
        assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
        assert.equal(lstatSync(danglingLinkPath).isSymbolicLink(), true);
      }
      assert.throws(
        () => openAuthorityDatabase(linkPath),
        (error: unknown) => error instanceof AuthorityStartupError && /symbolic link/u.test(error.message),
      );
      assert.throws(
        () => openAuthorityDatabase(danglingLinkPath),
        (error: unknown) => error instanceof AuthorityStartupError && /symbolic link/u.test(error.message),
      );
    }
  } finally {
    corrupt.cleanup();
    target.cleanup();
  }
});

test("startup rechecks the database path immediately before SQLite opens it", () => {
  const temporary = temporaryDatabase("pre-open-path-replacement");
  const permissionBoundary = Reflect.get(process, "permission");
  const permissionBoundaryEnabled = typeof permissionBoundary === "object" && permissionBoundary !== null;
  const replacementTarget = permissionBoundaryEnabled
    ? join(tmpdir(), "synthetic-missing-symlink-target")
    : join(temporary.directory, "replacement-target.sqlite");
  const precreatedReplacementLink = join(tmpdir(), "synthetic-authority-dangling-symlink");
  const originalReadFileSync = fs.readFileSync;
  let replacementInjected = false;

  try {
    assert.equal(existsSync(replacementTarget), false);
    if (permissionBoundaryEnabled) {
      assert.equal(lstatSync(precreatedReplacementLink).isSymbolicLink(), true);
    }

    fs.readFileSync = ((...arguments_: unknown[]) => {
      const result = Reflect.apply(originalReadFileSync, fs, arguments_) as unknown;
      if (!replacementInjected && String(arguments_[0]).endsWith(`/${MIGRATION_FILE}`)) {
        if (permissionBoundaryEnabled) {
          renameSync(precreatedReplacementLink, temporary.path);
        } else {
          symlinkSync(replacementTarget, temporary.path);
        }
        replacementInjected = true;
      }
      return result;
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();

    try {
      assert.throws(
        () => openAuthorityDatabase(temporary.path),
        (error: unknown) => error instanceof AuthorityStartupError && /symbolic link/u.test(error.message),
      );
    } finally {
      fs.readFileSync = originalReadFileSync;
      syncBuiltinESMExports();
    }

    assert.equal(replacementInjected, true);
    assert.equal(lstatSync(temporary.path).isSymbolicLink(), true);
    assert.equal(existsSync(replacementTarget), false, "startup opened and created the replacement target");
  } finally {
    if (fs.readFileSync !== originalReadFileSync) {
      fs.readFileSync = originalReadFileSync;
      syncBuiltinESMExports();
    }
    temporary.cleanup();
  }
});
