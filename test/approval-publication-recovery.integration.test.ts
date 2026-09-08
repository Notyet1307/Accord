import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { AuthorityStartupError, openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { reconstructGenericWinnerMaterialization } from "../src/researcher-analyst.js";
import { c3Fixture, prepareC3Fixture, confirmC3Approval, choiceEnvelope } from "./helpers/c3-fixture.js";
import { rebuildHistoricalDatabase } from "./helpers/c3-legacy.js";

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const rows = (database: DatabaseSync, sql: string): string[] => database.prepare(sql).all().map((row) => JSON.stringify(row)).sort();
const count = (database: DatabaseSync, table: string, where = ""): number => Number(database.prepare(`SELECT count(*) AS count FROM ${table} ${where}`).get()?.["count"]);

function inspect<T>(path: string, operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try { return operation(database); } finally { database.close(); }
}

function snapshot(database: DatabaseSync) {
  return database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map((table) => {
    const name = String(table["name"]);
    const columns = database.prepare(`PRAGMA table_info(${quote(name)})`).all().map((column) => quote(String(column["name"]))).join(", ");
    return { name, columns, bytes: rows(database, `SELECT ${columns} FROM ${quote(name)}`) };
  });
}

function tamper(path: string, operation: (database: DatabaseSync) => void): void {
  inspect(path, (database) => {
    database.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON");
    const triggers = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all();
    for (const trigger of triggers) database.exec(`DROP TRIGGER ${quote(String(trigger["name"]))}`);
    try { operation(database); } finally {
      for (const trigger of triggers) database.exec(String(trigger["sql"]));
      database.exec("PRAGMA ignore_check_constraints = OFF");
    }
    assert.deepEqual(database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all(), triggers);
  });
}

function rejectsAuthority(path: string): void {
  assert.throws(() => { const authority = openAuthorityDatabase(path); authority.close(); }, (error: unknown) => error instanceof AuthorityStartupError && !/schema drifted|missing required table/u.test(error.message));
}

test("C3 Writer intent failure rolls back Artifact, H2, winner CAS and approval facts together", async (t) => {
  const value = await prepareC3Fixture("c3-writer-intent-rollback", t);
  try {
    const before = inspect(value.temporary.path, (database) => ({
      board: rows(database, "SELECT * FROM boards"), workflow: rows(database, "SELECT * FROM workflow_runs"),
      entries: rows(database, "SELECT * FROM board_entries"),
      winners: rows(database, "SELECT * FROM runtime_results WHERE result_id IN (SELECT result_id FROM runtime_result_arrivals WHERE outcome = 'WINNER')"),
    }));
    inspect(value.temporary.path, (database) => database.exec("CREATE TRIGGER fail_approval_intent BEFORE INSERT ON approval_challenges BEGIN SELECT RAISE(ABORT, 'forced approval intent failure'); END"));
    await assert.rejects(value.completeWriter, /forced approval intent failure/u);
    inspect(value.temporary.path, (database) => {
      assert.deepEqual(rows(database, "SELECT * FROM boards"), before.board);
      assert.deepEqual(rows(database, "SELECT * FROM workflow_runs"), before.workflow);
      assert.deepEqual(rows(database, "SELECT * FROM board_entries"), before.entries);
      assert.deepEqual(rows(database, "SELECT * FROM runtime_results WHERE result_id IN (SELECT result_id FROM runtime_result_arrivals WHERE outcome = 'WINNER')"), before.winners);
      for (const table of ["artifacts", "approval_challenges", "approvals", "response_claims", "publication_freshness"]) assert.equal(count(database, table), 0);
      assert.equal(count(database, "pending_side_effects", "WHERE action_kind = 'APPROVAL_REQUEST'"), 0);
      assert.equal(count(database, "audit_events", "WHERE event_kind LIKE 'C3:%'"), 0);
      assert.equal(reconstructGenericWinnerMaterialization(database, value.writer.invocationId), undefined);
      database.exec("DROP TRIGGER fail_approval_intent");
    });
    value.authority.close();
    const recovered = openAuthorityDatabase(value.temporary.path); recovered.close();
    inspect(value.temporary.path, (database) => {
      assert.equal(count(database, "artifacts"), 1);
      assert.equal(count(database, "approval_challenges"), 1);
      assert.equal(count(database, "pending_side_effects", "WHERE action_kind = 'APPROVAL_REQUEST'"), 1);
      assert.equal(database.prepare("SELECT state FROM workflow_runs").get()?.["state"], "WAIT_FOR_APPROVAL");
    });
  } finally { value.close(); }
});

test("C3 populated schema10 upgrade preserves all C2 bytes and creates one truthful recovery intent", async (t) => {
  const value = await c3Fixture("c3-schema10-upgrade", t);
  try {
    value.authority.close();
    rebuildHistoricalDatabase(value.temporary.path, 10);
    const before = inspect(value.temporary.path, snapshot);
    const historicalH2 = inspect(value.temporary.path, (database) => JSON.stringify(reconstructGenericWinnerMaterialization(database, value.writer.invocationId)));
    t.mock.timers.setTime(Date.parse("2026-09-08T00:00:00.000Z"));
    const startedAt = Date.now();
    const upgraded = openAuthorityDatabase(value.temporary.path); upgraded.close();
    const finishedAt = Date.now();
    inspect(value.temporary.path, (database) => {
      assert.equal(database.prepare("PRAGMA user_version").get()?.["user_version"], 11);
      for (const table of before) {
        const current = rows(database, `SELECT ${table.columns} FROM ${quote(table.name)}`);
        for (const bytes of table.bytes) assert.ok(current.includes(bytes), `${table.name} historical row must remain byte-identical`);
        if (!["accord_schema_migrations", "pending_side_effects", "magicchat_rpc_actions", "audit_events"].includes(table.name)) assert.deepEqual(current, table.bytes, table.name);
      }
      assert.equal(JSON.stringify(reconstructGenericWinnerMaterialization(database, value.writer.invocationId)), historicalH2);
      assert.equal(count(database, "approval_challenges"), 1);
      assert.equal(count(database, "approval_legacy_provenance"), 1);
      assert.equal(count(database, "pending_side_effects", "WHERE action_kind = 'APPROVAL_REQUEST' AND state = 'PENDING'"), 1);
      assert.equal(count(database, "audit_events", "WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_CREATED:%'"), 0);
      const audits = database.prepare("SELECT * FROM audit_events WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_RECOVERED:%'").all();
      assert.equal(audits.length, 1);
      const audit = audits[0]; assert.ok(audit);
      assert.ok(Date.parse(String(audit["recorded_at"])) >= startedAt && Date.parse(String(audit["recorded_at"])) <= finishedAt);
      const artifact = database.prepare("SELECT * FROM artifacts").get(); assert.ok(artifact);
      const challenge = database.prepare("SELECT * FROM approval_challenges").get(); assert.ok(challenge);
      assert.equal(challenge["created_at"], audit["recorded_at"]);
      assert.equal(challenge["expires_at"], new Date(Date.parse(String(challenge["created_at"])) + 86_400_000).toISOString());
      assert.ok(Date.parse(String(challenge["created_at"])) > Date.parse(String(artifact["created_at"])));
      assert.ok(String(audit["details_json"]).includes(String(artifact["source_result_id"])));
      for (const table of ["approvals", "response_claims", "publication_freshness"]) assert.equal(count(database, table), 0);
      assert.equal(count(database, "magicchat_messages", "WHERE purpose <> 'CLARIFICATION'"), 0);
      assert.equal(count(database, "magicchat_rpc_actions", "WHERE action_id IN (SELECT action_id FROM pending_side_effects WHERE action_kind = 'APPROVAL_REQUEST') AND confirmation_json IS NOT NULL"), 0);
    });
    const once = inspect(value.temporary.path, snapshot);
    for (const now of ["2026-09-08T12:00:00.000Z", "2026-09-10T00:00:00.000Z"]) {
      t.mock.timers.setTime(Date.parse(now));
      const authority = openAuthorityDatabase(value.temporary.path); authority.close();
      assert.deepEqual(inspect(value.temporary.path, snapshot), once, "later startup must not renew even an expired challenge");
    }
  } finally { value.close(); }
});

test("C3 recovery audit failure rolls back the whole schema10 upgrade and intent", async (t) => {
  const value = await c3Fixture("c3-schema10-atomic-recovery", t);
  try {
    value.authority.close(); rebuildHistoricalDatabase(value.temporary.path, 10);
    const before = inspect(value.temporary.path, snapshot);
    const originalPrepare = DatabaseSync.prototype.prepare;
    let failedAfterIntent = false;
    const prepare = t.mock.method(DatabaseSync.prototype, "prepare", function (this: DatabaseSync, sql: string) {
      const statement = originalPrepare.call(this, sql);
      if (/INSERT INTO audit_events/iu.test(sql)) {
        const run = statement.run;
        t.mock.method(statement, "run", (...parameters: unknown[]) => {
          if (parameters.some((parameter) => typeof parameter === "string" && parameter.startsWith("C3:APPROVAL_REQUEST_RECOVERED:"))) {
            assert.equal(originalPrepare.call(this, "SELECT count(*) AS count FROM approval_challenges").get()?.["count"], 1);
            failedAfterIntent = true;
            throw new Error("forced recovery audit failure");
          }
          return Reflect.apply(run, statement, parameters);
        });
      }
      return statement;
    });
    try { assert.throws(() => openAuthorityDatabase(value.temporary.path), /forced recovery audit failure/u); } finally { prepare.mock.restore(); }
    assert.equal(failedAfterIntent, true);
    assert.deepEqual(inspect(value.temporary.path, snapshot), before);
    inspect(value.temporary.path, (database) => assert.equal(database.prepare("PRAGMA user_version").get()?.["user_version"], 10));
    const recovered = openAuthorityDatabase(value.temporary.path); recovered.close();
    inspect(value.temporary.path, (database) => assert.equal(count(database, "audit_events", "WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_RECOVERED:%'"), 1));
  } finally { value.close(); }
});

test("C3 refuses invalid schema10 H2 before recovery and leaves the historical schema unchanged", async (t) => {
  const value = await c3Fixture("c3-schema10-invalid-h2", t);
  try {
    value.authority.close(); rebuildHistoricalDatabase(value.temporary.path, 10);
    tamper(value.temporary.path, (database) => database.exec("UPDATE artifacts SET content_markdown = content_markdown || ' altered'"));
    const before = inspect(value.temporary.path, snapshot);
    rejectsAuthority(value.temporary.path);
    assert.deepEqual(inspect(value.temporary.path, snapshot), before);
    inspect(value.temporary.path, (database) => {
      assert.equal(database.prepare("PRAGMA user_version").get()?.["user_version"], 10);
      assert.equal(count(database, "sqlite_schema", "WHERE name = 'approval_challenges'"), 0);
    });
  } finally { value.close(); }
});

test("C3 current schema11 missing intent is rejected rather than repaired as legacy H2", async (t) => {
  const value = await c3Fixture("c3-current-missing-intent", t);
  try {
    value.authority.close();
    tamper(value.temporary.path, (database) => database.exec("DELETE FROM magicchat_rpc_actions WHERE action_id IN (SELECT action_id FROM pending_side_effects WHERE action_kind = 'APPROVAL_REQUEST'); DELETE FROM approval_challenges; DELETE FROM pending_side_effects WHERE action_kind = 'APPROVAL_REQUEST'; DELETE FROM audit_events WHERE event_kind LIKE 'C3:%'"));
    const before = inspect(value.temporary.path, snapshot);
    rejectsAuthority(value.temporary.path);
    assert.deepEqual(inspect(value.temporary.path, snapshot), before);
  } finally { value.close(); }
});

const corruptions = [
  ["request same-ID bytes", "UPDATE magicchat_rpc_actions SET request_json = json_set(request_json, '$.payload.message.content', 'Approve something else') WHERE action_id IN (SELECT approval_action_id FROM approval_challenges)"],
  ["request missing", "DELETE FROM magicchat_rpc_actions WHERE action_id IN (SELECT approval_action_id FROM approval_challenges)"],
  ["request orphan", "UPDATE magicchat_rpc_actions SET action_id = 'action_' || printf('%064d', 0) WHERE action_id IN (SELECT approval_action_id FROM approval_challenges)"],
  ["request chronology", "UPDATE magicchat_rpc_actions SET confirmed_at = '2026-08-25T00:00:00.000Z' WHERE action_id IN (SELECT approval_action_id FROM approval_challenges)"],
  ["challenge same-ID bytes", "UPDATE approval_challenges SET binding_json = json_set(binding_json, '$.actorId', 'forged-actor')"],
  ["challenge missing", "DELETE FROM approval_challenges"],
  ["challenge orphan", "UPDATE approval_challenges SET artifact_id = 'artifact_' || printf('%064d', 0)"],
  ["challenge chronology", "UPDATE approval_challenges SET expires_at = '2026-08-25T00:00:00.000Z'"],
  ["receipt same-ID bytes", "UPDATE inbox_receipts SET source_response_id = 'forged-response' WHERE event_type = 'choice.response_created'"],
  ["receipt payload same-ID bytes", "UPDATE magicchat_inbox_states SET event_payload_json = json_set(event_payload_json, '$.response.option_ids[0]', 'reject') WHERE event_role = 'APPROVAL_RESPONSE'"],
  ["receipt missing", "DELETE FROM inbox_receipts WHERE event_type = 'choice.response_created'"],
  ["receipt orphan", "UPDATE magicchat_inbox_states SET receipt_id = 'receipt_' || printf('%064d', 0) WHERE event_role = 'APPROVAL_RESPONSE'"],
  ["receipt chronology", "UPDATE inbox_receipts SET received_at = '2026-08-25T00:00:00.000Z' WHERE event_type = 'choice.response_created'"],
  ["decision same-ID bytes", "UPDATE approvals SET decision_json = json_set(decision_json, '$.decision', 'REJECTED')"],
  ["decision missing", "DELETE FROM approvals"],
  ["decision orphan", "UPDATE approvals SET challenge_id = 'challenge_' || printf('%064d', 0)"],
  ["decision chronology", "UPDATE approvals SET decided_at = '2026-08-25T00:00:00.000Z'"],
  ["freshness same-ID bytes", "UPDATE publication_freshness SET token_json = json_set(token_json, '$.claimVersion', 2)"],
  ["freshness missing", "DELETE FROM publication_freshness"],
  ["freshness orphan", "UPDATE publication_freshness SET response_claim_id = 'response_claim_' || printf('%064d', 0)"],
  ["freshness chronology", "UPDATE publication_freshness SET confirmed_at = '2026-08-25T00:00:00.000Z'"],
  ["freshness consumed chronology", "UPDATE publication_freshness SET consumed_at = '2026-08-25T00:00:00.000Z'"],
  ["claim same-ID bytes", "UPDATE response_claims SET owner_id = 'FORGED_OWNER'"],
  ["claim missing", "DELETE FROM response_claims"],
  ["claim orphan", "UPDATE response_claims SET approval_id = 'approval_' || printf('%064d', 0)"],
  ["claim chronology", "UPDATE response_claims SET created_at = '2026-08-25T00:00:00.000Z'"],
  ["publication action same-ID bytes", "UPDATE magicchat_rpc_actions SET request_json = json_set(request_json, '$.payload.message.content', 'Unapproved final Markdown') WHERE action_id IN (SELECT action_id FROM pending_side_effects WHERE action_kind = 'PUBLICATION')"],
  ["publication action missing", "DELETE FROM pending_side_effects WHERE action_kind = 'PUBLICATION'"],
  ["publication action orphan", "UPDATE magicchat_rpc_actions SET action_id = 'action_' || printf('%064d', 0) WHERE action_id IN (SELECT action_id FROM pending_side_effects WHERE action_kind = 'PUBLICATION')"],
  ["publication action chronology", "UPDATE magicchat_rpc_actions SET dispatched_at = '2026-08-25T00:00:00.000Z' WHERE action_id IN (SELECT action_id FROM pending_side_effects WHERE action_kind = 'PUBLICATION')"],
  ["message same-ID bytes", "UPDATE magicchat_messages SET message_id = 'forged-final-message' WHERE purpose = 'PUBLICATION'"],
  ["message missing", "DELETE FROM magicchat_messages WHERE purpose = 'PUBLICATION'"],
  ["message orphan", "UPDATE magicchat_messages SET action_id = 'action_' || printf('%064d', 0) WHERE purpose = 'PUBLICATION'"],
  ["message chronology", "UPDATE magicchat_messages SET confirmed_at = '2026-08-25T00:00:00.000Z' WHERE purpose = 'PUBLICATION'"],
  ["audit same-ID bytes", "UPDATE audit_events SET details_json = json_set(details_json, '$.forged', 1) WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_CREATED:%'"],
  ["audit missing", "DELETE FROM audit_events WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_CREATED:%'"],
  ["audit orphan", "INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) SELECT 'audit_' || printf('%064d', 0), schema_version, correlation_id, 'C3:FORGED:orphan', case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at FROM audit_events WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_CREATED:%'"],
  ["audit chronology", "UPDATE audit_events SET recorded_at = '2026-08-25T00:00:00.000Z' WHERE event_kind LIKE 'C3:APPROVAL_REQUEST_CREATED:%'"],
  ["provenance missing", "DELETE FROM approval_legacy_provenance"],
  ["provenance current misclassified", "UPDATE approval_legacy_provenance SET snapshot_json = (SELECT json_group_array(json_object('artifactId', artifact_id, 'artifactRevision', artifact_revision, 'artifactDigest', artifact_digest, 'sourceResultId', source_result_id, 'createdAt', created_at)) FROM artifacts)"],
] as const;

test("C3 startup rejects every corrupted publication authority with the exact schema triggers restored", async (t) => {
  for (const [label, sql] of corruptions) await t.test(label, async (context) => {
    const value = await c3Fixture(`c3-startup-${label.replaceAll(" ", "-")}`, context);
    try {
      const confirmation = confirmC3Approval(value);
      let transition = value.protocol.receive(choiceEnvelope(confirmation), "2026-08-26T00:02:02.000Z");
      for (const [method, now] of [
        ["conversation.messages.list", "2026-08-26T00:02:03.000Z"],
        ["message.send", "2026-08-26T00:02:04.000Z"],
        ["events.ack", "2026-08-26T00:02:05.000Z"],
      ] as const) {
        const request = transition.nextRequest; assert.ok(request); assert.equal(request.method, method);
        const response = value.protocol.dispatch(request.id, now, (outbound) => value.simulator.respond(outbound, now)); assert.ok(response);
        transition = value.protocol.receive(response, now);
      }
      assert.equal(transition.snapshot.workflowState, "COMPLETE");
      assert.equal(value.authority.inspectApprovalPublication(value.caseId)?.publication?.state, "CONFIRMED");
      value.authority.close();
      const valid = openAuthorityDatabase(value.temporary.path); valid.close();
      tamper(value.temporary.path, (database) => {
        database.exec(sql);
        assert.ok(Number(database.prepare("SELECT changes() AS count").get()?.["count"]) > 0, `${label} must modify an actual persisted fact`);
      });
      const before = inspect(value.temporary.path, snapshot);
      rejectsAuthority(value.temporary.path);
      assert.deepEqual(inspect(value.temporary.path, snapshot), before, "failed startup must neither repair nor advance the corrupt graph");
    } finally { value.close(); }
  });
});
