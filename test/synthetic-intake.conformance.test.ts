import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeSyntheticIntake } from "../src/contracts/intake.js";
import { deriveInboxDeliveryId, type CaseId } from "../src/core/ids.js";
import { MagicChatProtocolAdapter, type MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { DeterministicMagicChatSimulator } from "../src/magicchat/simulator.js";
import { openAuthorityDatabase, type AuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { EXPECTED_INTAKE_AUTHORITY, SYNTHETIC_INTAKE, magicChatMessageCreatedEnvelope, temporaryDatabase, type TemporaryDatabase } from "./fixture.js";
import { C3_NOW, c3Fixture, choiceEnvelope, confirmC3Approval, type C3ApprovalConfirmation, type C3Fixture } from "./helpers/c3-fixture.js";
const C4_DECIDE = "2026-08-26T00:02:02.000Z";
const C4_READ = "2026-08-26T00:02:03.000Z";
const C4_SEND = "2026-08-26T00:02:04.000Z";

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

const C4_SPEC_REVISION = "R003-C4/r1";
const C4_SPEC_SHA256 = "90a92b29ab0fd2f20080c89001009c0482156a92beb3143268d179cf9a086994";
const C4_TRACE_CANARY = "C4_PRIVATE_CANARY_MUST_NOT_ESCAPE";
type C4Record = Record<string, unknown>;
type C4BaseFixture = Readonly<{
  authority: AuthorityDatabase;
  protocol: MagicChatProtocolAdapter;
  simulator: DeterministicMagicChatSimulator;
  temporary: TemporaryDatabase;
  caseId: CaseId;
  close: () => void;
}>;
function c4BaseFixture(label: string, context: TestContext): C4BaseFixture {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-26T00:00:00.000Z") });
  const temporary = temporaryDatabase(label);
  let authority: AuthorityDatabase | undefined;
  try {
    authority = openAuthorityDatabase(temporary.path);
    authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z");
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app", firstMessageSequence: 2 });
    const created = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Synthetic objective" }), "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const clarificationResponse = simulator.respond(created.nextRequest, "2026-08-26T00:00:02.000Z");
    assert.ok("message" in clarificationResponse.payload);
    const clarification = protocol.receive(clarificationResponse, "2026-08-26T00:00:03.000Z");
    assert.ok(clarification.nextRequest);
    protocol.receive(simulator.respond(clarification.nextRequest, "2026-08-26T00:00:04.000Z"), "2026-08-26T00:00:04.000Z");
    const answer = magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: `event-${label}`, messageCreatedAt: "2026-08-26T00:01:00Z", messageId: `message-${label}`, messageSequence: 3, replyToMessageId: clarificationResponse.payload.message.id });
    simulator.observeUserMessage(answer);
    const resumed = protocol.receive(answer, "2026-08-26T00:01:01.000Z");
    if (resumed.nextRequest !== undefined) protocol.receive(simulator.respond(resumed.nextRequest, "2026-08-26T00:01:01.000Z"), "2026-08-26T00:01:01.000Z");
    let closed = false;
    const close = (): void => { if (closed) return; closed = true; try { authority?.close(); } finally { temporary.cleanup(); } };
    if (authority === undefined) throw new Error("C4 authority startup did not complete");
    return { authority, protocol, simulator, temporary, caseId: resumed.snapshot.caseId, close };
  } catch (error) {
    try { authority?.close(); } catch {}
    temporary.cleanup();
    throw error;
  }
}

type C4Assertion = Readonly<{ name: string; passed: boolean; observed: unknown }>;
type C4TraceResult = Readonly<{ canonicalBytes: string; sha256: string; trace: unknown }>;
type C4Run = Readonly<{ trace: C4TraceResult; observations: C4Record; assertions: readonly C4Assertion[]; terminal: C4Record; operation: C4Record }>;
type C4ChildExit = Readonly<{ status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; pid: number | undefined; diagnostic: string }>;

function c4Canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(c4Canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, c4Canonical(Reflect.get(value, key))]));
  return value;
}
function c4Digest(value: unknown): string {
  const bytes = typeof value === "string" ? value : JSON.stringify(c4Canonical(value));
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}
function c4ReadJson(path: string): C4Record { return JSON.parse(readFileSync(path, "utf8")) as C4Record; }
function c4WriteJson(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}
async function c4WaitFor(path: string, timeout = 10_000): Promise<C4Record> {
  const deadline = performance.now() + timeout;
  while (!existsSync(path)) {
    if (performance.now() >= deadline) throw new Error(`C4 IPC timeout: ${path}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return c4ReadJson(path);
}
function c4FileDigest(path: string): string { return c4Digest(readFileSync(path, "utf8")); }
function c4Query(path: string, sql: string, ...parameters: (string | number)[]): readonly C4Record[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare(sql).all(...parameters) as readonly C4Record[]; } finally { database.close(); }
}
function c4CodeCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout).trim() : "UNAVAILABLE";
}
function c4InheritedCapabilityArguments(): readonly string[] {
  return process.execArgv.filter((argument) => argument === "--permission" || argument.startsWith("--allow-fs-read=") || argument.startsWith("--allow-fs-write=") || argument.startsWith("--import="));
}
interface C4Worker { readonly child: ChildProcess; readonly pid: number | undefined; readonly done: Promise<C4ChildExit> }
function c4LaunchWorker(argumentsList: readonly string[], timeout: number): C4Worker {
  const childPath = fileURLToPath(new URL("helpers/c4-runner-child.js", import.meta.url));
  const child: ChildProcess = spawn(process.execPath, [...c4InheritedCapabilityArguments(), childPath, ...argumentsList], { env: {}, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.resume();
  child.stderr?.resume();
  let diagnostic = "";
  child.once("error", (error) => { diagnostic = error.name; });
  let timedOut = false;
  const done = new Promise<C4ChildExit>((resolve) => {
    // Real monotonic watchdog: the worker is a separate process, so fake test time cannot terminate it.
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout);
    child.once("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, timedOut, pid: child.pid, diagnostic }); });
  });
  return { child, pid: child.pid, done };
}
async function c4RunHappy(t: TestContext): Promise<C4Run> {
  const fixture = await c3Fixture("c4-runner-happy", t);
  try {
    t.mock.timers.setTime(Date.parse(C3_NOW));
    const confirmation = confirmC3Approval(fixture);
    const visibleBefore = fixture.simulator.visibleMessageCount;
    const { publication } = c4ToPublication(fixture.protocol, fixture.simulator, confirmation);
    c4FinishPublication(fixture.protocol, fixture.simulator, publication);
    const replayOutcome = c4ReplayChoice(fixture.protocol, confirmation);
    const snapshot = fixture.protocol.inspect(3);
    assert.ok(snapshot);
    const trace = fixture.authority.generateCaseTrace(fixture.caseId);
    const visibleAfter = fixture.simulator.visibleMessageCount;
    return {
      trace,
      observations: { external: "SYNTHETIC_DETERMINISTIC_SIMULATOR", visibleFinalDelta: visibleAfter - visibleBefore, visibleMessageCount: visibleAfter, acknowledgedCursors: fixture.simulator.acknowledgedCursors, replayOutcome },
      assertions: [
        c4Assertion("fixed workflow completes", snapshot.workflowState === "COMPLETE", snapshot.workflowState),
        c4Assertion("one final visible message", visibleAfter - visibleBefore === 1, visibleAfter - visibleBefore),
        c4Assertion("source replay is idempotent", replayOutcome === "REPLAYED", replayOutcome),
        c4Assertion("trace is bounded", Buffer.byteLength(trace.canonicalBytes, "utf8") <= 1_048_576, Buffer.byteLength(trace.canonicalBytes, "utf8")),
      ],
      terminal: { workflowState: snapshot.workflowState, caseStatus: snapshot.phase },
      operation: { parentPid: process.pid, workerPids: [], restartPids: [], signals: [] },
    };
  } finally { fixture.close(); }
}

async function c4RunModelUnknown(t: TestContext): Promise<C4Run> {
  const fixture = c4BaseFixture("c4-runner-model-unknown", t);
  const databasePath = fixture.temporary.path;
  const ipcRoot = mkdtempSync(join(tmpdir(), "accord-c4-w1-ipc-"));
  const barrierPath = join(ipcRoot, "provider-barrier.json");
  const resumeResultPath = join(ipcRoot, "resume-result.json");
  const errorPath = join(ipcRoot, "worker-error.json");
  let hold: C4Worker | undefined;
  let resume: C4Worker | undefined;
  try {
    fixture.authority.close();
    hold = c4LaunchWorker(["hold-w1", databasePath, fixture.caseId, barrierPath, errorPath], 10_000);
    const barrier = await c4WaitFor(barrierPath);
    assert.equal(typeof barrier["invocationId"], "string");
    assert.equal(barrier["state"], "PROVIDER_CALL_ACCEPTED_WITHOUT_COMPLETION");
    const holdPid = hold.pid;
    assert.equal(typeof holdPid, "number");
    assert.equal(barrier["pid"], holdPid);
    c4StopWorker(hold);
    const holdExit = await hold.done;
    assert.equal(holdExit.signal, "SIGKILL");
    assert.equal(holdExit.timedOut, false);
    const invocationId = String(barrier["invocationId"]);
    resume = c4LaunchWorker(["resume-w1", databasePath, fixture.caseId, invocationId, resumeResultPath, errorPath], 10_000);
    const resumeResult = await c4WaitFor(resumeResultPath, 10_000);
    const resumePid = resume.pid;
    const resumeExit = await resume.done;
    assert.equal(resumeExit.status, 0, "C4 W1 restart worker failed");
    assert.equal(resumeResult["state"], "PROFILES_COMPLETE");
    t.mock.timers.setTime(Date.parse(C3_NOW));
    const authority = openAuthorityDatabase(databasePath);
    try {
      const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
      const confirmation = c4ConfirmPending(protocol, fixture.simulator);
      const { publication } = c4ToPublication(protocol, fixture.simulator, confirmation);
      c4FinishPublication(protocol, fixture.simulator, publication);
      const replayOutcome = c4ReplayChoice(protocol, confirmation);
      const snapshot = protocol.inspect(3);
      assert.ok(snapshot);
      const trace = authority.generateCaseTrace(fixture.caseId);
      const runtime = c4RuntimeSummary(databasePath, invocationId);
      const attemptStates = c4Query(databasePath, "SELECT attempt_number, state FROM runtime_attempts WHERE invocation_id = ? ORDER BY attempt_number", invocationId).map((row) => ({ attemptNumber: row["attempt_number"], state: row["state"] }));
      return {
        trace,
        observations: { external: "SYNTHETIC_PROVIDER_PORT", providerCallsObserved: 1, knownUsage: "UNKNOWN", invocationId, attemptStates, replayOutcome },
        assertions: [
          c4Assertion("first worker reached provider boundary", barrier["state"] === "PROVIDER_CALL_ACCEPTED_WITHOUT_COMPLETION", barrier["state"]),
          c4Assertion("first worker was SIGKILLed", holdExit.signal === "SIGKILL", holdExit.signal),
          c4Assertion("restart used a new PID", typeof resumePid === "number" && resumePid !== holdPid, typeof resumePid === "number" && resumePid !== holdPid),
          c4Assertion("two Attempt ceiling preserved", JSON.stringify(attemptStates) === JSON.stringify([{ attemptNumber: 1, state: "UNKNOWN" }, { attemptNumber: 2, state: "WINNER" }]), attemptStates),
          c4Assertion("fixed workflow completes", snapshot.workflowState === "COMPLETE", snapshot.workflowState),
          c4Assertion("source replay is idempotent", replayOutcome === "REPLAYED", replayOutcome),
        ],
        terminal: { workflowState: snapshot.workflowState, runtime, attemptStates },
        operation: { parentPid: process.pid, workerPids: [holdPid], restartPids: [resumePid], signals: [holdExit.signal] },
      };
    } finally { authority.close(); }
  } finally { try { if (hold !== undefined && hold.child.exitCode === null && hold.child.signalCode === null) c4StopWorker(hold); } catch {} try { if (resume !== undefined && resume.child.exitCode === null && resume.child.signalCode === null) c4StopWorker(resume); } catch {} fixture.close(); }
}
function c4StopWorker(worker: { child: ChildProcess }): void {
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
}
function c4Assertion(name: string, passed: boolean, observed: unknown): C4Assertion { return Object.freeze({ name, passed, observed }); }
function c4ConfirmPending(protocol: MagicChatProtocolAdapter, simulator: C3Fixture["simulator"]): C3ApprovalConfirmation {
  const pending = protocol.pendingRequests().find(({ request }) => request.method === "message.send");
  assert.ok(pending);
  const delivered = protocol.dispatch(pending.request.id, C3_NOW, (request) => simulator.respond(request, C3_NOW));
  protocol.receive(delivered, C3_NOW);
  const response = simulator.respond(pending.request, C3_NOW);
  assert.ok("message" in response.payload);
  return { request: pending.request, card: response.payload.message };
}
function c4ToPublication(protocol: MagicChatProtocolAdapter, simulator: C3Fixture["simulator"], confirmation: C3ApprovalConfirmation): { publication: MagicChatRequestEnvelope; confirmation: C3ApprovalConfirmation } {
  const choice = protocol.receive(choiceEnvelope(confirmation), C4_DECIDE);
  assert.ok(choice.nextRequest);
  const freshness = protocol.receive(simulator.respond(choice.nextRequest, C4_READ), C4_READ);
  assert.ok(freshness.nextRequest);
  assert.equal(freshness.nextRequest.method, "message.send");
  return { publication: freshness.nextRequest, confirmation };
}
function c4FinishPublication(protocol: MagicChatProtocolAdapter, simulator: C3Fixture["simulator"], publication: MagicChatRequestEnvelope): void {
  assert.equal(publication.method, "message.send");
  const response = protocol.dispatch(publication.id, C4_SEND, (request) => simulator.respond(request, C4_SEND));
  const completed = protocol.receive(response, C4_SEND);
  const ack = completed.nextRequest ?? protocol.pendingRequests().find(({ request }) => request.method === "events.ack")?.request;
  if (ack !== undefined) {
    const ackResponse = protocol.dispatch(ack.id, C4_SEND, (request) => simulator.respond(request, C4_SEND));
    protocol.receive(ackResponse, C4_SEND);
  }
}
function c4ReplayChoice(protocol: MagicChatProtocolAdapter, confirmation: C3ApprovalConfirmation): string {
  const replay = protocol.receive({ ...choiceEnvelope(confirmation), id: "c4-choice-replay" }, C4_SEND);
  return replay.outcome;
}
function c4RuntimeSummary(path: string, invocationId?: string): C4Record {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const attempts = invocationId === undefined
      ? database.prepare("SELECT state, count(*) AS count FROM runtime_attempts GROUP BY state ORDER BY state").all()
      : database.prepare("SELECT state, count(*) AS count FROM runtime_attempts WHERE invocation_id = ? GROUP BY state ORDER BY state").all(invocationId);
    const rows = attempts as readonly C4Record[];
    return { attempts: rows.map((row) => ({ state: row["state"], count: Number(row["count"]) })) };
  } finally { database.close(); }
}
function c4WriteEvidence(directory: string, scenario: string, run: C4Run): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tracePath = join(directory, "trace.json");
  const externalPath = join(directory, "external-observations.json");
  const manifestPath = join(directory, "manifest.json");
  const resultPath = join(directory, "result.json");
  writeFileSync(tracePath, run.trace.canonicalBytes, { encoding: "utf8", mode: 0o600 });
  c4WriteJson(externalPath, { schemaVersion: "accord.r003-c4-external-observations/v1", scenario, ...run.observations });
  c4WriteJson(manifestPath, {
    schemaVersion: "accord.r003-c4-manifest/v1",
    codeCommit: c4CodeCommit(),
    spec: { revision: C4_SPEC_REVISION, sha256: C4_SPEC_SHA256 },
    toolchain: { node: process.version, packageNode: "24.19.0", packageNpm: "11.17.0" },
    fixture: { workflow: "r003-fixed/v1", sourceManifest: "approved-synthetic-source/v1", protocol: "magicchat-official-shaped/v1" },
    clock: { mode: "SYNTHETIC_CONTROLLED", scenarioInstants: ["2026-08-26T00:00:00.000Z", C3_NOW], workerDeadlineMs: 10_000, scenarioDeadlineMs: 60_000 },
    scenario,
    operation: run.operation,
  });
  const result = {
    schemaVersion: "accord.r003-c4-run/v1",
    scenario,
    status: "PASS",
    assertions: run.assertions,
    terminal: run.terminal,
    fileDigests: { manifest: c4FileDigest(manifestPath), trace: c4FileDigest(tracePath), externalObservations: c4FileDigest(externalPath) },
    diagnostics: null,
  } as const;
  c4WriteJson(resultPath, result);
  for (const path of [manifestPath, tracePath, externalPath, resultPath]) assert.equal(readFileSync(path, "utf8").includes(C4_TRACE_CANARY), false, `redaction canary escaped in ${path}`);
}
function c4WriteFailure(directory: string, scenario: string, diagnostic: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  c4WriteJson(join(directory, "manifest.json"), { schemaVersion: "accord.r003-c4-manifest/v1", spec: { revision: C4_SPEC_REVISION, sha256: C4_SPEC_SHA256 }, scenario, clock: { mode: "SYNTHETIC_CONTROLLED" }, operation: { parentPid: process.pid } });
  c4WriteJson(join(directory, "external-observations.json"), { schemaVersion: "accord.r003-c4-external-observations/v1", scenario, observations: [] });
  c4WriteJson(join(directory, "result.json"), { schemaVersion: "accord.r003-c4-run/v1", scenario, status: "FAIL", assertions: [], terminal: {}, fileDigests: {}, diagnostics: { code: diagnostic } });
}
function c4IpcRequest(value: unknown): MagicChatRequestEnvelope {
  if (value === null || typeof value !== "object" || !("request" in value)) throw new TypeError("C4 IPC request envelope missing");
  const request = value.request;
  if (request === null || typeof request !== "object" || !("id" in request) || typeof request.id !== "string" || !("method" in request) || typeof request.method !== "string") throw new TypeError("C4 IPC request envelope invalid");
  return request as MagicChatRequestEnvelope;
}
async function c4RunPublicationUnknown(t: TestContext): Promise<C4Run> {
  const fixture = await c3Fixture("c4-runner-publication-unknown", t);
  const databasePath = fixture.temporary.path;
  const ipcRoot = mkdtempSync(join(tmpdir(), "accord-c4-w2-ipc-"));
  const requestPath = join(ipcRoot, "publication-request.json");
  const barrierPath = join(ipcRoot, "publication-barrier.json");
  const resumeRequestPath = join(ipcRoot, "resume-request.json");
  const resumeResponsePath = `${resumeRequestPath}.response`;
  const resumeResultPath = join(ipcRoot, "resume-result.json");
  const errorPath = join(ipcRoot, "worker-error.json");
  let hold: C4Worker | undefined;
  let resume: C4Worker | undefined;
  try {
    t.mock.timers.setTime(Date.parse(C3_NOW));
    const confirmation = confirmC3Approval(fixture);
    const preparedPublication = c4ToPublication(fixture.protocol, fixture.simulator, confirmation).publication;
    assert.equal(preparedPublication.method, "message.send");
    const visibleBefore = fixture.simulator.visibleMessageCount;
    fixture.authority.close();
    hold = c4LaunchWorker(["hold-publication", databasePath, "synthetic-app", requestPath, barrierPath, errorPath], 10_000);
    const requestEnvelope = c4IpcRequest(await c4WaitFor(requestPath));
    assert.equal(requestEnvelope.method, "message.send");
    const firstResponse = fixture.simulator.respond(requestEnvelope, C4_SEND);
    assert.ok("message" in firstResponse.payload);
    const firstMessage = firstResponse.payload.message;
    c4WriteJson(`${requestPath}.accepted`, { requestId: requestEnvelope.id, requestDigest: c4Digest(requestEnvelope), messageId: firstMessage.id, messageSequence: firstMessage.seq, visibleMessageCount: fixture.simulator.visibleMessageCount });
    const barrier = await c4WaitFor(barrierPath);
    assert.equal(barrier["state"], "EXTERNAL_ACCEPTED_BEFORE_CONFIRMATION");
    const pendingState = c4Query(databasePath, "SELECT p.state, r.dispatched_at FROM pending_side_effects p JOIN magicchat_rpc_actions r ON r.action_id = p.action_id WHERE r.request_envelope_id = ?", requestEnvelope.id)[0];
    assert.ok(pendingState);
    assert.equal(pendingState["state"], "UNKNOWN");
    assert.equal(typeof pendingState["dispatched_at"], "string");
    const holdPid = hold.pid;
    assert.equal(typeof holdPid, "number");
    assert.equal(barrier["pid"], holdPid);
    c4StopWorker(hold);
    const holdExit = await hold.done;
    assert.equal(holdExit.signal, "SIGKILL");
    assert.equal(holdExit.timedOut, false);
    resume = c4LaunchWorker(["resume-publication", databasePath, "synthetic-app", fixture.caseId, resumeRequestPath, resumeResultPath, errorPath], 10_000);
    const replayRequest = c4IpcRequest(await c4WaitFor(resumeRequestPath));
    assert.equal(replayRequest.id, requestEnvelope.id);
    const replayResponse = fixture.simulator.respond(replayRequest, C3_NOW);
    assert.ok("message" in replayResponse.payload);
    assert.equal(replayResponse.payload.message.id, firstMessage.id);
    assert.equal(fixture.simulator.visibleMessageCount, visibleBefore + 1);
    c4WriteJson(resumeResponsePath, replayResponse);
    const resumeResult = await c4WaitFor(resumeResultPath, 10_000);
    const resumeExit = await resume.done;
    assert.equal(resumeExit.status, 0, "C4 W2 restart worker failed");
    assert.equal(resumeResult["visibleConfirmation"], true);
    const authority = openAuthorityDatabase(databasePath);
    try {
      const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
      const ack = protocol.pendingRequests().find(({ request }) => request.method === "events.ack");
      assert.ok(ack);
      const ackResponse = protocol.dispatch(ack.request.id, C4_SEND, (request) => fixture.simulator.respond(request, C4_SEND));
      protocol.receive(ackResponse, C4_SEND);
      const replayOutcome = c4ReplayChoice(protocol, confirmation);
      const snapshot = protocol.inspect(3);
      assert.ok(snapshot);
      const publicationState = authority.inspectApprovalPublication(fixture.caseId)?.publication?.state;
      const trace = authority.generateCaseTrace(fixture.caseId);
      return {
        trace,
        observations: { external: "SYNTHETIC_DETERMINISTIC_SIMULATOR", publicationRequestId: requestEnvelope.id, publicationRequestDigest: c4Digest(requestEnvelope), firstDispatchObserved: true, externalMessageId: firstMessage.id, externalMessageSequence: firstMessage.seq, visibleMessageCount: fixture.simulator.visibleMessageCount, acknowledgedCursors: fixture.simulator.acknowledgedCursors, replayRequestId: replayRequest.id, replayResponseDigest: c4Digest(replayResponse), replayOutcome },
        assertions: [
          c4Assertion("external acceptance preceded kill", barrier["state"] === "EXTERNAL_ACCEPTED_BEFORE_CONFIRMATION", barrier["state"]),
          c4Assertion("local publication was UNKNOWN at cut", pendingState["state"] === "UNKNOWN", pendingState["state"]),
          c4Assertion("same request identity replayed", replayRequest.id === requestEnvelope.id, { first: requestEnvelope.id, replay: replayRequest.id }),
          c4Assertion("one visible final message", fixture.simulator.visibleMessageCount - visibleBefore === 1, fixture.simulator.visibleMessageCount - visibleBefore),
          c4Assertion("publication confirmed once", publicationState === "CONFIRMED", publicationState),
          c4Assertion("final workflow completes", snapshot.workflowState === "COMPLETE", snapshot.workflowState),
          c4Assertion("source replay is idempotent", replayOutcome === "REPLAYED", replayOutcome),
        ],
        terminal: { workflowState: snapshot.workflowState, publicationState, ackState: protocol.inspect(3)?.ackState },
        operation: { parentPid: process.pid, workerPids: [holdPid], restartPids: [resume.pid], signals: [holdExit.signal] },
      };
    } finally { authority.close(); }
  } finally { try { if (hold !== undefined && hold.child.exitCode === null && hold.child.signalCode === null) c4StopWorker(hold); } catch {} try { if (resume !== undefined && resume.child.exitCode === null && resume.child.signalCode === null) c4StopWorker(resume); } catch {} fixture.close(); }
}

function c4Comparable(run: C4Run): string {
  return JSON.stringify(c4Canonical({ trace: run.trace.canonicalBytes, observations: run.observations, assertions: run.assertions, terminal: run.terminal }));
}

test(
  "C4 runner proves bounded process recovery, complete Trace, and repeatable evidence",
  { skip: process.platform === "win32" ? "C4 SIGKILL acceptance requires POSIX" : false },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "accord-r003-c4-evidence-"));
    const scenarios = [["happy", c4RunHappy], ["model-unknown", c4RunModelUnknown], ["publication-unconfirmed", c4RunPublicationUnknown]] as const;
    const comparison: C4Record[] = [];
    for (const [scenario, runScenario] of scenarios) {
      const repeatRuns: C4Run[] = [];
      for (const repeat of [1, 2] as const) {
        t.mock.timers.reset();
        const directory = join(root, `${scenario}-${repeat}`);
        try {
          const run = await runScenario(t);
          assert.equal(run.assertions.every((assertion) => assertion.passed), true, `${scenario} assertion failed`);
          c4WriteEvidence(directory, scenario, run);
          repeatRuns.push(run);
        } catch (error) {
          c4WriteFailure(directory, scenario, error instanceof Error ? error.name : "C4_SCENARIO_ERROR");
          throw error;
        } finally { t.mock.timers.reset(); }
      }
      const firstRun = repeatRuns[0];
      const secondRun = repeatRuns[1];
      assert.ok(firstRun);
      assert.ok(secondRun);
      assert.equal(c4Comparable(firstRun), c4Comparable(secondRun), `${scenario} repeat evidence diverged`);
      comparison.push({ scenario, traceSha256: firstRun.trace.sha256, repeatEqual: true });
    }
    c4WriteJson(join(root, "repeat-comparison.json"), { schemaVersion: "accord.r003-c4-repeat-comparison/v1", scenarios: comparison });
    process.stdout.write(`C4_EVIDENCE ${root}\n`);
  },
);
