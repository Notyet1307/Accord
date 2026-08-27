import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

import { MIGRATION_SCHEMA_FINGERPRINT, MIGRATION_SHA256 } from "../contracts/handoff.js";
import { DATABASE_SCHEMA_VERSION, MIGRATION_FILE, MIGRATION_ID } from "../contracts/versions.js";

export interface AuthorityMigration {
  readonly version: typeof DATABASE_SCHEMA_VERSION;
  readonly id: typeof MIGRATION_ID;
  readonly sha256: typeof MIGRATION_SHA256;
  readonly schemaFingerprint: typeof MIGRATION_SCHEMA_FINGERPRINT;
  readonly sql: string;
}

function resolveMigrationUrl(): URL {
  const candidates = [
    new URL(`../../../${MIGRATION_FILE}`, import.meta.url),
    new URL(`../../${MIGRATION_FILE}`, import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const metadata = lstatSync(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`${MIGRATION_FILE} must be one regular, non-symlink file`);
      }
      return candidate;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`required migration is missing: ${MIGRATION_FILE}`);
}

export function loadAuthorityMigration(): AuthorityMigration {
  const sql = readFileSync(resolveMigrationUrl(), "utf8");
  const actualDigest = createHash("sha256").update(sql, "utf8").digest("hex");
  if (actualDigest !== MIGRATION_SHA256) {
    throw new Error(`migration checksum mismatch for ${MIGRATION_FILE}`);
  }
  return {
    id: MIGRATION_ID,
    sha256: MIGRATION_SHA256,
    schemaFingerprint: MIGRATION_SCHEMA_FINGERPRINT,
    sql,
    version: DATABASE_SCHEMA_VERSION,
  };
}
