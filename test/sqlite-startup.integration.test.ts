import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { existsSync, lstatSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { MIGRATION_SCHEMA_FINGERPRINT, MIGRATION_SHA256 } from "../src/contracts/handoff.js";
import {
  CORE_DATABASE_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  MIGRATION_FILE,
  MIGRATION_ID,
  SQLITE_PRAGMAS,
} from "../src/contracts/versions.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { DeterministicMagicChatSimulator } from "../src/magicchat/simulator.js";
import { AuthorityStartupError, openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import {
  MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
  SYNTHETIC_INTAKE,
  magicChatAckSuccessResponse,
  magicChatMessageCreatedEnvelope,
  magicChatMessageSendSuccessResponse,
  temporaryDatabase,
} from "./fixture.js";

const EXPECTED_SCHEMA_OBJECT_IDENTITIES = [
  "index:idx_audit_events_correlation",
  "index:idx_audit_events_intake_receipt",
  "index:idx_board_entries_case_revision",
  "index:idx_inbox_deliveries_receipt",
  "index:idx_inbox_receipts_case",
  "index:idx_magicchat_inbox_app_cursor",
  "index:idx_magicchat_rpc_request",
  "index:idx_pending_side_effects_state",
  "index:idx_runtime_invocations_run_status",
  "index:idx_wait_challenges_active_app",
  "index:idx_wait_challenges_run_version",
  "table:accord_schema_migrations",
  "table:approvals",
  "table:audit_events",
  "table:board_entries",
  "table:boards",
  "table:cases",
  "table:inbox_deliveries",
  "table:inbox_receipts",
  "table:magicchat_inbox_states",
  "table:magicchat_messages",
  "table:magicchat_rpc_actions",
  "table:pending_side_effects",
  "table:response_claims",
  "table:runtime_invocations",
  "table:wait_challenges",
  "table:workflow_definitions",
  "table:workflow_runs",
  "trigger:inbox_deliveries_immutable_collision",
  "trigger:inbox_deliveries_immutable_delete",
  "trigger:inbox_deliveries_immutable_update",
] as const;
const repositoryRoot = new URL("../../", import.meta.url);

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
    assert.equal(migrationCount["count"], 2);
    raw.close();

    const reopened = openAuthorityDatabase(temporary.path);
    assert.deepEqual(reopened.readPragmas(), SQLITE_PRAGMAS);
    reopened.close();
    assert.deepEqual(schemaObjectIdentities(temporary.path), EXPECTED_SCHEMA_OBJECT_IDENTITIES);
  } finally {
    temporary.cleanup();
  }
});

test("startup upgrades an exact Issue 10 authority database through the additive ingress migration", () => {
  const temporary = temporaryDatabase("issue-10-upgrade");
  try {
    const issue10 = new DatabaseSync(temporary.path);
    issue10.exec(fs.readFileSync(new URL(MIGRATION_FILE, repositoryRoot), "utf8"));
    issue10
      .prepare(
        `INSERT INTO accord_schema_migrations (
           version, migration_id, migration_sha256, schema_fingerprint, applied_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        CORE_DATABASE_SCHEMA_VERSION,
        MIGRATION_ID,
        MIGRATION_SHA256,
        MIGRATION_SCHEMA_FINGERPRINT,
        "2026-08-26T00:00:00.000Z",
      );
    issue10.exec(`PRAGMA user_version = ${CORE_DATABASE_SCHEMA_VERSION}`);
    issue10.close();

    const upgraded = openAuthorityDatabase(temporary.path);
    upgraded.close();

    const inspected = new DatabaseSync(temporary.path);
    const versions = inspected
      .prepare("SELECT version, migration_id FROM accord_schema_migrations ORDER BY version")
      .all()
      .map((value) => {
        const row = value as Record<string, unknown>;
        return { migration_id: row["migration_id"], version: row["version"] };
      });
    const userVersion = inspected.prepare("PRAGMA user_version").get() as Record<string, unknown>;
    inspected.close();
    assert.deepEqual(versions, [
      { version: 1, migration_id: "001_r003_authority_core" },
      { version: 2, migration_id: "002_r003_magicchat_ingress" },
    ]);
    assert.equal(Object.values(userVersion)[0], DATABASE_SCHEMA_VERSION);
  } finally {
    temporary.cleanup();
  }
});

test("startup preserves MagicChat receipt inspection after the downstream same-Run handoff advances", () => {
  const temporary = temporaryDatabase("downstream-workflow-compatibility");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    const researcher = protocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "Preserve a two-week decision window.",
        cursor: 2,
        envelopeEventId: "event-matching-reply",
        messageCreatedAt: "2026-08-26T00:01:00Z",
        messageId: "message-matching-reply",
        messageSequence: 3,
        replyToMessageId: "clarification-message-1",
      }),
      "2026-08-26T00:01:01.000Z",
    );
    assert.ok(researcher.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(researcher.nextRequest.id, 2),
      "2026-08-26T00:01:02.000Z",
    );
    authority.close();

    const downstream = new DatabaseSync(temporary.path);
    downstream
      .prepare("UPDATE workflow_runs SET state = 'ANALYST', revision = 4 WHERE state = 'RESEARCHER' AND revision = 3")
      .run();
    downstream.close();

    const reopened = openAuthorityDatabase(temporary.path);
    const inspected = new MagicChatProtocolAdapter(reopened, "synthetic-app").inspect(2);
    assert.ok(inspected);
    assert.equal(inspected.workflowRunId, created.snapshot.workflowRunId);
    assert.equal(inspected.workflowState, "ANALYST");
    assert.equal(inspected.workflowRevision, 4);
    reopened.close();
  } finally {
    temporary.cleanup();
  }
});

test("startup recovers an ACK_INTENT after remote acceptance without replaying the deleted event", () => {
  const temporary = temporaryDatabase("accepted-ack-reconnect");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app", firstMessageSequence: 2 });
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      simulator.respond(created.nextRequest, "2026-08-26T00:00:02.000Z"),
      "2026-08-26T00:00:03.000Z",
    );
    assert.equal(waiting.snapshot.ackState, "ACK_INTENT");
    assert.ok(waiting.nextRequest);

    const acceptedAckResponse = simulator.respond(waiting.nextRequest, "2026-08-26T00:00:04.000Z");
    assert.deepEqual(simulator.acknowledgedCursors, [1]);
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const reopenedProtocol = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app");
    const recovered = reopenedProtocol.pendingRequests();
    assert.deepEqual(recovered, [{ cursor: 1, request: waiting.nextRequest }]);

    const reconciledAckResponse = simulator.respond(recovered[0]!.request!, "2026-08-26T00:00:05.000Z");
    assert.deepEqual(reconciledAckResponse, acceptedAckResponse);
    const acknowledged = reopenedProtocol.receive(reconciledAckResponse, "2026-08-26T00:00:06.000Z");
    assert.equal(acknowledged.snapshot.ackState, "ACK_CONFIRMED");

    const next = reopenedProtocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "Preserve a two-week decision window.",
        cursor: 2,
        envelopeEventId: "event-after-accepted-ack",
        messageCreatedAt: "2026-08-26T00:01:00Z",
        messageId: "message-after-accepted-ack",
        messageSequence: 3,
        replyToMessageId: waiting.snapshot.challenge.clarificationMessageId!,
      }),
      "2026-08-26T00:01:01.000Z",
    );
    assert.equal(next.snapshot.workflowState, "RESEARCHER");
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a downstream node while the actor-bound clarification challenge is still active", () => {
  const temporary = temporaryDatabase("active-challenge-downstream-bypass");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered
      .prepare("UPDATE workflow_runs SET state = 'ANALYST', revision = 3 WHERE state = 'WAIT_FOR_INPUT'")
      .run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /active clarification challenge cannot coexist/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup recomputes whether a matching clarification reply was expired", () => {
  const temporary = temporaryDatabase("tampered-expired-reply-outcome");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    protocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "This answer arrived after the challenge expired.",
        cursor: 2,
        envelopeEventId: "event-expired-reply",
        messageCreatedAt: "2026-08-27T00:00:02Z",
        messageId: "message-expired-reply",
        messageSequence: 3,
        replyToMessageId: "clarification-message-1",
      }),
      "2026-08-27T00:00:03.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered
      .prepare("UPDATE magicchat_inbox_states SET business_outcome = 'UNMATCHED_INPUT' WHERE cursor = 2")
      .run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /reply business outcome does not match/u.test(error.message),
    );
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
    future.exec("PRAGMA user_version = 3");
    future.close();
    assert.throws(
      () => openAuthorityDatabase(versioned.path),
      (error: unknown) => error instanceof AuthorityStartupError && /unsupported database schema version 3/u.test(error.message),
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

test("startup refuses a tampered durable MagicChat request instead of replaying changed visible-message intent", () => {
  const temporary = temporaryDatabase("tampered-magicchat-request");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    new MagicChatProtocolAdapter(authority, "synthetic-app").receive(
      MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
      "2026-08-26T00:00:01.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered
      .prepare("UPDATE magicchat_rpc_actions SET request_json = ? WHERE rpc_method = 'message.send'")
      .run(
        JSON.stringify({
          v: 1,
          id: `request_${"0".repeat(64)}`,
          kind: "request",
          method: "message.send",
          payload: {
            target: { type: "conversation", conversation_id: "conversation-1" },
            message: { type: "text", content: "Tampered visible message intent" },
          },
        }),
      );
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /persisted clarification request/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup recomputes the deterministic clarification Question metadata", () => {
  const temporary = temporaryDatabase("tampered-clarification-question");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    new MagicChatProtocolAdapter(authority, "synthetic-app").receive(
      MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
      "2026-08-26T00:00:01.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered
      .prepare("UPDATE board_entries SET content_digest = ? WHERE entry_type = 'Question'")
      .run("0".repeat(64));
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /clarification Question metadata is invalid/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a stable wait whose confirmed clarification message record is missing", () => {
  const temporary = temporaryDatabase("missing-clarification-message-record");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered.prepare("DELETE FROM magicchat_messages WHERE purpose = 'CLARIFICATION'").run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /confirmed clarification message record is invalid/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a RESEARCHER handoff whose matching clarification Observation is missing", () => {
  const temporary = temporaryDatabase("missing-clarification-observation");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    protocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "Preserve a two-week decision window.",
        cursor: 2,
        envelopeEventId: "event-matching-reply",
        messageCreatedAt: "2026-08-26T00:01:00Z",
        messageId: "message-matching-reply",
        messageSequence: 3,
        replyToMessageId: "clarification-message-1",
      }),
      "2026-08-26T00:01:01.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered.prepare("DELETE FROM board_entries WHERE entry_type = 'Observation'").run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /matching clarification Observation is invalid/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a tampered cumulative ACK request identity", () => {
  const temporary = temporaryDatabase("tampered-magicchat-ack-request");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    const row = tampered
      .prepare("SELECT request_json FROM magicchat_rpc_actions WHERE rpc_method = 'events.ack'")
      .get() as Record<string, unknown>;
    const request = JSON.parse(String(row["request_json"])) as Record<string, unknown>;
    request["id"] = `request_${"0".repeat(64)}`;
    tampered
      .prepare("UPDATE magicchat_rpc_actions SET request_json = ? WHERE rpc_method = 'events.ack'")
      .run(JSON.stringify(request));
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /persisted ACK request identity or digest is invalid/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a stable MagicChat receipt whose durable ACK intent was erased", () => {
  const temporary = temporaryDatabase("missing-magicchat-ack-intent");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered
      .prepare(
        `UPDATE magicchat_inbox_states
         SET ack_state = 'NONE', ack_action_id = NULL
         WHERE cursor = 1`,
      )
      .run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /stable MagicChat protocol state requires a durable ACK/u.test(error.message),
    );
  } finally {
    temporary.cleanup();
  }
});

test("startup refuses a challenge whose expected actor no longer matches its source receipt", () => {
  const temporary = temporaryDatabase("tampered-magicchat-challenge-actor");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    new MagicChatProtocolAdapter(authority, "synthetic-app").receive(
      MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
      "2026-08-26T00:00:01.000Z",
    );
    authority.close();

    const tampered = new DatabaseSync(temporary.path);
    tampered.prepare("UPDATE wait_challenges SET expected_actor_id = 'actor-attacker'").run();
    tampered.close();

    assert.throws(
      () => openAuthorityDatabase(temporary.path),
      (error: unknown) =>
        error instanceof AuthorityStartupError && /challenge binding does not match its source receipt/u.test(error.message),
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
