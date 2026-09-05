import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RESEARCHER_ANALYST_HANDOFF_SCHEMA_VERSION, REVIEWER_WRITER_MIGRATION_ID, REVIEWER_WRITER_MIGRATION_SHA256, REVIEWER_WRITER_SCHEMA_FINGERPRINT, DATABASE_SCHEMA_VERSION } from "../../src/contracts/versions.js";
import { R003_RESEARCHER_ANALYST_HANDOFF } from "../../src/contracts/researcher-analyst-handoff.js";
import { loadAuthorityMigrations } from "../../src/persistence/migration.js";
import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { temporaryDatabase } from "../fixture.js";
import { deriveProfileInvocationId, parseBoardId, parseCaseId, parseWorkflowRunId } from "../../src/core/ids.js";
import { persistFixedProfileContext, readFixedProfileContext, REVIEWER_OUTPUT_SCHEMA, REVIEWER_PROFILE_VERSION, WRITER_OUTPUT_SCHEMA, WRITER_PROFILE_VERSION } from "../../src/profile-context.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))]));
  return value;
}

test("O01 persists and re-reads stable fixed Reviewer and Writer Contexts", () => {
  for (const profile of ["REVIEWER", "WRITER"] as const) {
    const temporary = temporaryDatabase(`r003-c1-${profile.toLowerCase()}`);
    try {
      const authority = openAuthorityDatabase(temporary.path); authority.close();
      const database = new DatabaseSync(temporary.path);
      try {
        const caseId = parseCaseId(`case_${"a".repeat(64)}`); const boardId = parseBoardId(`board_${"b".repeat(64)}`); const workflowRunId = parseWorkflowRunId(`run_${"c".repeat(64)}`);
        const profileVersion = profile === "REVIEWER" ? REVIEWER_PROFILE_VERSION : WRITER_PROFILE_VERSION; const outputSchema = profile === "REVIEWER" ? REVIEWER_OUTPUT_SCHEMA : WRITER_OUTPUT_SCHEMA;
        const core = { approvedSources: [], boardId, boardRevision: 0, caseId, entries: [], modelId: "model", node: profile, objective: "Objective", outputSchema, permissionSummary: {}, profileVersion, providerPortVersion: "port/v1", runtimeVersion: "runtime/v1", workflowDefinitionId: "workflow_definition_r003_fixed_v1", workflowDefinitionVersion: "r003-fixed/v1", workflowRevision: 1, workflowRunId };
        const contextDigest = createHash("sha256").update(JSON.stringify(canonical(core)), "utf8").digest("hex");
        const invocationId = deriveProfileInvocationId({ caseId, workflowRunId, nodeId: profile, profileVersion, contextDigest });
        database.exec("BEGIN");
        database.prepare("INSERT INTO boards (board_id, schema_version, case_id, revision, created_at) VALUES (?, 'accord.board/v1', ?, 0, ?)").run(boardId, caseId, "2026-09-04T00:00:00.000Z");
        database.prepare("INSERT INTO workflow_runs (workflow_run_id, schema_version, case_id, board_id, workflow_definition_id, state, revision, created_at) VALUES (?, 'accord.workflow-run/v1', ?, ?, 'workflow_definition_r003_fixed_v1', ?, 1, ?)").run(workflowRunId, caseId, boardId, profile, "2026-09-04T00:00:00.000Z");
        database.prepare("INSERT INTO cases (case_id, schema_version, source_app_id, source_conversation_id, source_message_id, objective, status, board_id, workflow_run_id, created_at) VALUES (?, 'accord.case/v1', 'app', 'conversation', ?, 'Objective', 'OPEN', ?, ?, ?)").run(caseId, `message-${profile}`, boardId, workflowRunId, "2026-09-04T00:00:00.000Z");
        database.prepare("INSERT INTO runtime_invocations (invocation_id, schema_version, case_id, workflow_run_id, board_id, node_id, profile_version, model_id, workflow_revision, board_revision, context_digest, status, attempt_budget, created_at) VALUES (?, 'accord.runtime-invocation/v1', ?, ?, ?, ?, ?, 'model', 1, 0, ?, 'READY', 2, ?)").run(invocationId, caseId, workflowRunId, boardId, profile, profileVersion, contextDigest, "2026-09-04T00:00:00.000Z");
        database.exec("COMMIT");
        const input = { invocationId, caseId, workflowRunId, boardId, nodeId: profile, workflowDefinitionId: "workflow_definition_r003_fixed_v1", workflowDefinitionVersion: "r003-fixed/v1", profileVersion, providerPortVersion: "port/v1", modelId: "model", runtimeVersion: "runtime/v1", outputSchema, objective: "Objective", selectedEntriesJson: "[]", approvedSourcesJson: "[]", permissionSummaryJson: "{}", contextDigest, createdAt: "2026-09-04T00:00:00.000Z" };
        const persisted = persistFixedProfileContext(database, input);
        assert.match(persisted.contextId, /^context_[0-9a-f]{64}$/u);
        database.prepare("UPDATE workflow_runs SET state = 'WAIT_FOR_APPROVAL', revision = revision + 1 WHERE workflow_run_id = ?").run(workflowRunId);
        database.prepare("UPDATE boards SET revision = revision + 1 WHERE board_id = ?").run(boardId);
        assert.deepEqual(readFixedProfileContext(database, invocationId), persisted);
        assert.throws(() => persistFixedProfileContext(database, { ...input, modelId: "different" }), /exactly bound|conflicts|digest/u);
        assert.equal((database.prepare("SELECT count(*) AS count FROM profile_contexts WHERE invocation_id = ?").get(invocationId) as Record<string, unknown>)["count"], 1);
      } finally { database.close(); }
    } finally { temporary.cleanup(); }
  }
});
test("O01 rejects invalid schema 8 provenance before migration 009", () => {
  const temporary = temporaryDatabase("r003-c1-invalid-schema8");
  try {
    const database = new DatabaseSync(temporary.path);
    const migrations = loadAuthorityMigrations().slice(0, 8);
    for (const migration of migrations) {
      database.exec(migration.sql);
      database.prepare("INSERT INTO accord_schema_migrations (version, migration_id, migration_sha256, schema_fingerprint, applied_at) VALUES (?, ?, ?, ?, ?)").run(migration.version, migration.id, migration.sha256, migration.schemaFingerprint, "2026-09-04T00:00:00.000Z");
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }
    database.prepare("UPDATE accord_schema_migrations SET migration_sha256 = ? WHERE version = 8").run("0".repeat(64));
    database.close();
    assert.throws(() => openAuthorityDatabase(temporary.path), /schema drifted/u);
    const unchanged = new DatabaseSync(temporary.path);
    try {
      assert.equal((unchanged.prepare("PRAGMA user_version").get() as Record<string, unknown>)["user_version"], 8);
      assert.equal((unchanged.prepare("SELECT count(*) AS count FROM accord_schema_migrations").get() as Record<string, unknown>)["count"], 8);
    } finally { unchanged.close(); }
  } finally { temporary.cleanup(); }
});


test("O01 schema 9 migration is pinned and restart-stable", () => {
  const temporary = temporaryDatabase("r003-c1-o01");
  try {
    const migrations = loadAuthorityMigrations();
    const migration = migrations.at(-1);
    if (migration === undefined) throw new Error("schema 9 migration is missing");
    assert.equal(DATABASE_SCHEMA_VERSION, 9);
    assert.equal(migration.version, 9);
    assert.equal(migration.id, REVIEWER_WRITER_MIGRATION_ID);
    assert.equal(migration.sha256, REVIEWER_WRITER_MIGRATION_SHA256);
    assert.equal(migration.schemaFingerprint, REVIEWER_WRITER_SCHEMA_FINGERPRINT);

    const first = openAuthorityDatabase(temporary.path);
    first.close();
    const reopened = openAuthorityDatabase(temporary.path);
    reopened.close();

    const rows = new DatabaseSync(temporary.path);
    try {
      const migrationRow = rows.prepare("SELECT count(*) AS count FROM accord_schema_migrations WHERE version = 9 AND migration_id = ? AND migration_sha256 = ? AND schema_fingerprint = ?").get(REVIEWER_WRITER_MIGRATION_ID, REVIEWER_WRITER_MIGRATION_SHA256, REVIEWER_WRITER_SCHEMA_FINGERPRINT) as Record<string, unknown>;
      assert.equal(migrationRow["count"], 1);
      const contextRow = rows.prepare("SELECT count(*) AS count FROM profile_contexts WHERE node_id IN ('REVIEWER', 'WRITER')").get() as Record<string, unknown>;
      assert.equal(contextRow["count"], 0);
      const contextSchemaRow = rows.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'profile_contexts'").get() as Record<string, unknown>;
      const contextSchema = contextSchemaRow["sql"];
      if (typeof contextSchema !== "string") throw new Error("profile_contexts schema is missing");
      assert.match(contextSchema, /'REVIEWER'/u);
      assert.match(contextSchema, /'WRITER'/u);
    } finally { rows.close(); }
    assert.equal(R003_RESEARCHER_ANALYST_HANDOFF.databaseSchemaVersion, RESEARCHER_ANALYST_HANDOFF_SCHEMA_VERSION);
    assert.equal(RESEARCHER_ANALYST_HANDOFF_SCHEMA_VERSION, 8);
    const handoffBytes = readFileSync(new URL("../../../contracts/r003-researcher-analyst-handoff.json", import.meta.url));
    assert.equal(createHash("sha256").update(handoffBytes).digest("hex"), "5e7ec4517fa4fec75daf6fdb9be4f52f2555df6890f1db98b619b9e248fd40f5");
  } finally { temporary.cleanup(); }
});
