import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeSyntheticIntake } from "../src/contracts/intake.js";
import { deriveInboxDeliveryId } from "../src/core/ids.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { EXPECTED_INTAKE_AUTHORITY, SYNTHETIC_INTAKE, temporaryDatabase } from "./fixture.js";

interface DeliveryAuditRow {
  readonly deliveryId: string;
  readonly envelopeEventId: string;
  readonly receivedAt: string;
  readonly schemaVersion: string;
}

type CrashBarrier = "after-intake-commit" | "before-intake-commit";

function killIntakeAtCommitBarrier(path: string, barrier: CrashBarrier): void {
  const childPath = fileURLToPath(new URL("helpers/intake-crash-child.js", import.meta.url));
  const inheritedCapabilityArguments = process.execArgv.filter(
    (argument) =>
      argument === "--permission" ||
      argument.startsWith("--allow-fs-read=") ||
      argument.startsWith("--allow-fs-write=") ||
      argument.startsWith("--import="),
  );
  const result = spawnSync(process.execPath, [...inheritedCapabilityArguments, childPath, path, barrier], {
    encoding: "utf8",
    env: {},
    timeout: 10_000,
  });
  const diagnostic = JSON.stringify({
    error: result.error?.message,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  });
  assert.equal(result.error, undefined, diagnostic);
  assert.equal(result.status, null, diagnostic);
  assert.equal(result.signal, "SIGKILL", diagnostic);
}

function deliveryHistory(path: string, receiptId: string): readonly DeliveryAuditRow[] {
  const raw = new DatabaseSync(path);
  try {
    return raw
      .prepare(
        `SELECT
           delivery_id AS deliveryId,
           schema_version AS schemaVersion,
           envelope_event_id AS envelopeEventId,
           received_at AS receivedAt
         FROM inbox_deliveries
         WHERE receipt_id = ?
         ORDER BY received_at, delivery_id`,
      )
      .all(receiptId) as unknown as readonly DeliveryAuditRow[];
  } finally {
    raw.close();
  }
}

function authorityCounts(path: string): Record<string, number> {
  const raw = new DatabaseSync(path);
  try {
    return Object.fromEntries(
      ["cases", "boards", "workflow_runs", "inbox_receipts", "inbox_deliveries", "audit_events"].map((table) => {
        const row = raw.prepare(`SELECT count(*) AS count FROM ${table}`).get() as Record<string, unknown>;
        const count = row["count"];
        if (typeof count !== "number") {
          throw new TypeError(`${table} count is not numeric`);
        }
        return [table, count] as const;
      }),
    );
  } finally {
    raw.close();
  }
}

test("one normalized intake and replay resolve one stable persisted Case, Run, and Board", () => {
  const temporary = temporaryDatabase("replay");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const created = authority.processSyntheticIntake(normalizeSyntheticIntake(SYNTHETIC_INTAKE));
    assert.equal(created.outcome, "CREATED");
    assert.deepEqual(
      {
        auditCorrelationId: created.auditCorrelationId,
        auditEventId: created.auditEventId,
        boardId: created.boardId,
        caseId: created.caseId,
        payloadDigest: created.payloadDigest,
        receiptId: created.receiptId,
        workflowRunId: created.workflowRunId,
      },
      EXPECTED_INTAKE_AUTHORITY,
    );

    const replayed = authority.processSyntheticIntake({
      ...SYNTHETIC_INTAKE,
      envelopeEventId: "event-replayed-with-new-delivery-id",
      receivedAt: "2026-08-26T00:05:00.000Z",
    });
    assert.equal(replayed.outcome, "REPLAYED");
    assert.equal(replayed.caseId, created.caseId);
    assert.equal(replayed.boardId, created.boardId);
    assert.equal(replayed.workflowRunId, created.workflowRunId);
    assert.equal(replayed.receiptId, created.receiptId);
    assert.equal(replayed.auditCorrelationId, created.auditCorrelationId);
    assert.equal(replayed.firstEnvelopeEventId, SYNTHETIC_INTAKE.envelopeEventId);
    assert.equal(replayed.firstReceivedAt, SYNTHETIC_INTAKE.receivedAt);
    assert.deepEqual(replayed.delivery, {
      caseId: created.caseId,
      deliveryId: deriveInboxDeliveryId({
        envelopeEventId: "event-replayed-with-new-delivery-id",
        receiptId: created.receiptId,
      }),
      envelopeEventId: "event-replayed-with-new-delivery-id",
      receiptId: created.receiptId,
      receivedAt: "2026-08-26T00:05:00.000Z",
    });
    const firstReplayHistory = deliveryHistory(temporary.path, created.receiptId);
    assert.deepEqual(
      firstReplayHistory.map(({ envelopeEventId, receivedAt, schemaVersion }) => ({
        envelopeEventId,
        receivedAt,
        schemaVersion,
      })),
      [
        {
          envelopeEventId: SYNTHETIC_INTAKE.envelopeEventId,
          receivedAt: SYNTHETIC_INTAKE.receivedAt,
          schemaVersion: "accord.inbox-delivery/v1",
        },
        {
          envelopeEventId: "event-replayed-with-new-delivery-id",
          receivedAt: "2026-08-26T00:05:00.000Z",
          schemaVersion: "accord.inbox-delivery/v1",
        },
      ],
    );
    assert.equal(firstReplayHistory.every(({ deliveryId }) => /^delivery_[0-9a-f]{64}$/u.test(deliveryId)), true);

    const duplicateDelivery = authority.processSyntheticIntake({
      ...SYNTHETIC_INTAKE,
      envelopeEventId: "event-replayed-with-new-delivery-id",
      receivedAt: "2026-08-26T00:05:00.000Z",
    });
    assert.equal(duplicateDelivery.outcome, "REPLAYED");
    assert.deepEqual(duplicateDelivery.delivery, replayed.delivery);
    assert.deepEqual(deliveryHistory(temporary.path, created.receiptId), firstReplayHistory);
    assert.throws(
      () =>
        authority.processSyntheticIntake({
          ...SYNTHETIC_INTAKE,
          envelopeEventId: "event-replayed-with-new-delivery-id",
          receivedAt: "2026-08-26T00:06:00.000Z",
        }),
      /replayed delivery conflicts with the immutable delivery audit/u,
    );
    assert.deepEqual(deliveryHistory(temporary.path, created.receiptId), firstReplayHistory);

    const progressed = new DatabaseSync(temporary.path);
    progressed.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    progressed.prepare("UPDATE boards SET revision = 4 WHERE board_id = ?").run(created.boardId);
    progressed
      .prepare("UPDATE workflow_runs SET state = 'COMPLETE', revision = 9 WHERE workflow_run_id = ?")
      .run(created.workflowRunId);
    progressed.prepare("UPDATE cases SET status = 'COMPLETE' WHERE case_id = ?").run(created.caseId);
    progressed.exec("COMMIT");
    progressed.close();

    const completedReplay = authority.processSyntheticIntake({
      ...SYNTHETIC_INTAKE,
      envelopeEventId: "event-replayed-after-workflow-completion",
      receivedAt: "2026-08-26T00:10:00.000Z",
    });
    assert.equal(completedReplay.outcome, "REPLAYED");
    assert.equal(completedReplay.caseId, created.caseId);
    assert.equal(completedReplay.caseStatus, "COMPLETE");
    assert.equal(completedReplay.boardRevision, 4);
    assert.equal(completedReplay.workflowState, "COMPLETE");
    assert.equal(completedReplay.workflowRevision, 9);
    assert.equal(deliveryHistory(temporary.path, created.receiptId).length, 3);
    const immutable = new DatabaseSync(temporary.path);
    assert.throws(
      () =>
        immutable
          .prepare("UPDATE inbox_deliveries SET received_at = ? WHERE delivery_id = ?")
          .run("2026-08-26T00:11:00.000Z", completedReplay.delivery.deliveryId),
      /inbox delivery audit records are immutable/u,
    );
    assert.throws(
      () => immutable.prepare("DELETE FROM inbox_deliveries WHERE delivery_id = ?").run(completedReplay.delivery.deliveryId),
      /inbox delivery audit records are immutable/u,
    );
    assert.throws(
      () =>
        immutable
          .prepare(
            `INSERT OR REPLACE INTO inbox_deliveries (
               delivery_id, schema_version, receipt_id, case_id, envelope_event_id, received_at
             ) SELECT delivery_id, schema_version, receipt_id, case_id, envelope_event_id, ?
               FROM inbox_deliveries
               WHERE delivery_id = ?`,
          )
          .run("2026-08-26T00:11:00.000Z", completedReplay.delivery.deliveryId),
      /replayed delivery conflicts with the immutable delivery audit/u,
    );
    immutable.close();
    assert.deepEqual(authorityCounts(temporary.path), {
      audit_events: 1,
      boards: 1,
      cases: 1,
      inbox_deliveries: 3,
      inbox_receipts: 1,
      workflow_runs: 1,
    });
    authority.close();

    const recovered = openAuthorityDatabase(temporary.path);
    const inspected = recovered.inspectSyntheticIntake(SYNTHETIC_INTAKE.appId, SYNTHETIC_INTAKE.cursor);
    assert.ok(inspected);
    assert.equal(inspected.caseId, EXPECTED_INTAKE_AUTHORITY.caseId);
    assert.equal(inspected.boardId, EXPECTED_INTAKE_AUTHORITY.boardId);
    assert.equal(inspected.workflowRunId, EXPECTED_INTAKE_AUTHORITY.workflowRunId);
    assert.equal(inspected.caseStatus, "COMPLETE");
    assert.equal(inspected.boardRevision, 4);
    assert.equal(inspected.workflowState, "COMPLETE");
    assert.equal(inspected.workflowRevision, 9);
    recovered.close();
  } finally {
    temporary.cleanup();
  }
});

test("an injected SQLite exception rolls back receipt, Case, Board, Run, delivery, and audit together", () => {
  const temporary = temporaryDatabase("interruption");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const faultInstaller = new DatabaseSync(temporary.path);
    faultInstaller.exec(`
      CREATE TRIGGER test_interrupt_intake_audit
      BEFORE INSERT ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'synthetic transaction interruption');
      END;
    `);
    faultInstaller.close();

    assert.throws(
      () => authority.processSyntheticIntake(SYNTHETIC_INTAKE),
      /synthetic transaction interruption/,
    );
    assert.equal(authority.inspectSyntheticIntake(SYNTHETIC_INTAKE.appId, SYNTHETIC_INTAKE.cursor), undefined);
    assert.deepEqual(authorityCounts(temporary.path), {
      audit_events: 0,
      boards: 0,
      cases: 0,
      inbox_deliveries: 0,
      inbox_receipts: 0,
      workflow_runs: 0,
    });

    const faultRemover = new DatabaseSync(temporary.path);
    faultRemover.exec("DROP TRIGGER test_interrupt_intake_audit");
    faultRemover.close();

    const recovered = authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    assert.equal(recovered.outcome, "CREATED");
    assert.equal(recovered.caseId, EXPECTED_INTAKE_AUTHORITY.caseId);
    authority.close();

    const restarted = openAuthorityDatabase(temporary.path);
    assert.ok(restarted.inspectSyntheticIntake(SYNTHETIC_INTAKE.appId, SYNTHETIC_INTAKE.cursor));
    restarted.close();
  } finally {
    temporary.cleanup();
  }
});

test(
  "a killed process before intake commit recovers with no partial authority rows",
  { skip: process.platform === "win32" ? "the deterministic SIGKILL barrier requires POSIX signals" : false },
  () => {
    const temporary = temporaryDatabase("killed-before-commit");
    try {
      killIntakeAtCommitBarrier(temporary.path, "before-intake-commit");

      const recovered = openAuthorityDatabase(temporary.path);
      assert.equal(recovered.inspectSyntheticIntake(SYNTHETIC_INTAKE.appId, SYNTHETIC_INTAKE.cursor), undefined);
      assert.deepEqual(authorityCounts(temporary.path), {
        audit_events: 0,
        boards: 0,
        cases: 0,
        inbox_deliveries: 0,
        inbox_receipts: 0,
        workflow_runs: 0,
      });

      const created = recovered.processSyntheticIntake(SYNTHETIC_INTAKE);
      assert.equal(created.outcome, "CREATED");
      assert.equal(created.caseId, EXPECTED_INTAKE_AUTHORITY.caseId);
      recovered.close();
    } finally {
      temporary.cleanup();
    }
  },
);

test(
  "a killed process after intake commit reopens one graph and resolves replay with stable identities",
  { skip: process.platform === "win32" ? "the deterministic SIGKILL barrier requires POSIX signals" : false },
  () => {
    const temporary = temporaryDatabase("killed-after-commit");
    try {
      killIntakeAtCommitBarrier(temporary.path, "after-intake-commit");

      const recovered = openAuthorityDatabase(temporary.path);
      const committed = recovered.inspectSyntheticIntake(SYNTHETIC_INTAKE.appId, SYNTHETIC_INTAKE.cursor);
      assert.ok(committed);
      assert.equal(committed.caseId, EXPECTED_INTAKE_AUTHORITY.caseId);
      assert.equal(committed.boardId, EXPECTED_INTAKE_AUTHORITY.boardId);
      assert.equal(committed.workflowRunId, EXPECTED_INTAKE_AUTHORITY.workflowRunId);
      assert.equal(committed.receiptId, EXPECTED_INTAKE_AUTHORITY.receiptId);

      const replayed = recovered.processSyntheticIntake({
        ...SYNTHETIC_INTAKE,
        envelopeEventId: "event-replayed-after-commit-crash",
        receivedAt: "2026-08-26T00:15:00.000Z",
      });
      assert.equal(replayed.outcome, "REPLAYED");
      assert.equal(replayed.caseId, committed.caseId);
      assert.equal(replayed.boardId, committed.boardId);
      assert.equal(replayed.workflowRunId, committed.workflowRunId);
      assert.equal(replayed.receiptId, committed.receiptId);
      assert.deepEqual(
        deliveryHistory(temporary.path, committed.receiptId).map(({ envelopeEventId, receivedAt }) => ({
          envelopeEventId,
          receivedAt,
        })),
        [
          {
            envelopeEventId: SYNTHETIC_INTAKE.envelopeEventId,
            receivedAt: SYNTHETIC_INTAKE.receivedAt,
          },
          {
            envelopeEventId: "event-replayed-after-commit-crash",
            receivedAt: "2026-08-26T00:15:00.000Z",
          },
        ],
      );
      assert.deepEqual(authorityCounts(temporary.path), {
        audit_events: 1,
        boards: 1,
        cases: 1,
        inbox_deliveries: 2,
        inbox_receipts: 1,
        workflow_runs: 1,
      });
      recovered.close();
    } finally {
      temporary.cleanup();
    }
  },
);

test("invalid or conflicting intake cannot leave partial or duplicate authority state", () => {
  const temporary = temporaryDatabase("invalid");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    assert.throws(
      () => authority.processSyntheticIntake({ ...SYNTHETIC_INTAKE, synthetic: false }),
      /synthetic must be true/,
    );
    assert.deepEqual(authorityCounts(temporary.path), {
      audit_events: 0,
      boards: 0,
      cases: 0,
      inbox_deliveries: 0,
      inbox_receipts: 0,
      workflow_runs: 0,
    });

    authority.processSyntheticIntake(SYNTHETIC_INTAKE);
    assert.throws(
      () => authority.processSyntheticIntake({ ...SYNTHETIC_INTAKE, objective: "Conflicting objective" }),
      /conflicts with persisted (payload digest|objective)/,
    );
    assert.throws(
      () => authority.processSyntheticIntake({ ...SYNTHETIC_INTAKE, cursor: 2, envelopeEventId: "event-2" }),
      /UNIQUE constraint failed/,
    );
    assert.deepEqual(authorityCounts(temporary.path), {
      audit_events: 1,
      boards: 1,
      cases: 1,
      inbox_deliveries: 1,
      inbox_receipts: 1,
      workflow_runs: 1,
    });
    authority.close();
  } finally {
    temporary.cleanup();
  }
});
