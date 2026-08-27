import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

import {
  MAGICCHAT_INGRESS_MIGRATION_SHA256,
  MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT,
  MIGRATION_SCHEMA_FINGERPRINT,
  MIGRATION_SHA256,
} from "../contracts/handoff.js";
import {
  CORE_DATABASE_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  MAGICCHAT_INGRESS_MIGRATION_FILE,
  MAGICCHAT_INGRESS_MIGRATION_ID,
  MIGRATION_FILE,
  MIGRATION_ID,
} from "../contracts/versions.js";

export interface AuthorityMigration {
  readonly version: number;
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly schemaFingerprint: string;
  readonly sql: string;
}

interface AuthorityMigrationDescriptor extends Omit<AuthorityMigration, "sql"> {}

const AUTHORITY_MIGRATION_DESCRIPTORS: readonly AuthorityMigrationDescriptor[] = Object.freeze([
  Object.freeze({
    file: MIGRATION_FILE,
    id: MIGRATION_ID,
    schemaFingerprint: MIGRATION_SCHEMA_FINGERPRINT,
    sha256: MIGRATION_SHA256,
    version: CORE_DATABASE_SCHEMA_VERSION,
  }),
  Object.freeze({
    file: MAGICCHAT_INGRESS_MIGRATION_FILE,
    id: MAGICCHAT_INGRESS_MIGRATION_ID,
    schemaFingerprint: MAGICCHAT_INGRESS_SCHEMA_FINGERPRINT,
    sha256: MAGICCHAT_INGRESS_MIGRATION_SHA256,
    version: DATABASE_SCHEMA_VERSION,
  }),
]);

function resolveMigrationUrl(file: string): URL {
  const candidates = [
    new URL(`../../../${file}`, import.meta.url),
    new URL(`../../${file}`, import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const metadata = lstatSync(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`${file} must be one regular, non-symlink file`);
      }
      return candidate;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`required migration is missing: ${file}`);
}

function loadAuthorityMigration(descriptor: AuthorityMigrationDescriptor): AuthorityMigration {
  const sql = readFileSync(resolveMigrationUrl(descriptor.file), "utf8");
  const actualDigest = createHash("sha256").update(sql, "utf8").digest("hex");
  if (actualDigest !== descriptor.sha256) {
    throw new Error(`migration checksum mismatch for ${descriptor.file}`);
  }
  return {
    ...descriptor,
    sql,
  };
}

export function loadAuthorityMigrations(): readonly AuthorityMigration[] {
  return Object.freeze(AUTHORITY_MIGRATION_DESCRIPTORS.map((descriptor) => Object.freeze(loadAuthorityMigration(descriptor))));
}
