import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { loadAuthorityMigrations } from "../../src/persistence/migration.js";

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Call only after closing every authority connection. Rebuild the historical
 * schema from its pinned migrations, never by lowering a current user_version. */
export function rebuildHistoricalDatabase(path: string, version: 9 | 10): void {
  const checkpoint = new DatabaseSync(path);
  checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  checkpoint.close();
  const historicalPath = `${path}.schema${version}`;
  const historical = new DatabaseSync(historicalPath);
  try {
    historical.exec("PRAGMA foreign_keys = OFF");
    for (const migration of loadAuthorityMigrations().filter((migration) => migration.version <= version)) historical.exec(migration.sql);
    historical.prepare("ATTACH DATABASE ? AS current_authority").run(path);
    const triggers = historical.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all();
    for (const trigger of triggers) historical.exec(`DROP TRIGGER ${quote(String(trigger["name"]))}`);
    const tables = historical.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
    for (const table of tables) {
      const name = String(table["name"]);
      const columns = historical.prepare(`PRAGMA table_info(${quote(name)})`).all().map((column) => quote(String(column["name"])));
      let where = "";
      if (name === "accord_schema_migrations") where = ` WHERE version <= ${version}`;
      else if (name === "audit_events") where = " WHERE event_kind NOT LIKE 'C3:%'";
      else if (name === "pending_side_effects") where = " WHERE action_kind IN ('CLARIFICATION', 'ACK')";
      else if (name === "magicchat_rpc_actions") where = " WHERE action_id IN (SELECT action_id FROM current_authority.pending_side_effects WHERE action_kind IN ('CLARIFICATION', 'ACK'))";
      else if (name === "magicchat_messages") where = " WHERE purpose = 'CLARIFICATION'";
      historical.exec(`DELETE FROM ${quote(name)}; INSERT INTO ${quote(name)} (${columns.join(", ")}) SELECT ${columns.join(", ")} FROM current_authority.${quote(name)}${where}`);
    }
    for (const trigger of triggers) historical.exec(String(trigger["sql"]));
    historical.exec(`PRAGMA user_version = ${version}`);
    assert.deepEqual(historical.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(historical.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('approval_challenges', 'publication_freshness', 'approval_legacy_provenance')").get()?.["count"], 0);
    assert.equal(historical.prepare("SELECT count(*) AS count FROM pragma_table_info('inbox_receipts') WHERE name = 'source_response_id'").get()?.["count"], 0);
    historical.exec("DETACH DATABASE current_authority");
  } finally { historical.close(); }
  renameSync(historicalPath, path);
}
