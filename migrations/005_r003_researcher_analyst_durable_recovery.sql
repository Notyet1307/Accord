/*
 * Completes the Issue 12 repair without rewriting any prior authority rows.
 * A manifest has exactly one immutable identity and a physical response retains
 * a bounded replay snapshot solely for startup classification.
 */
CREATE TABLE approved_synthetic_source_manifests (
  manifest_id TEXT PRIMARY KEY CHECK (manifest_id = 'source_manifest_r003_v1'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.approved-synthetic-source-manifest/v1'),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
  source_count INTEGER NOT NULL CHECK (source_count >= 0 AND source_count <= 32),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'SEALED')),
  installed_at TEXT NOT NULL,
  sealed_at TEXT
) STRICT;

INSERT INTO approved_synthetic_source_manifests
  (manifest_id, schema_version, manifest_digest, source_count, state, installed_at, sealed_at)
VALUES
  ('source_manifest_r003_v1', 'accord.approved-synthetic-source-manifest/v1',
   'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, 'OPEN',
   '1970-01-01T00:00:00.000Z', NULL);

ALTER TABLE approved_synthetic_sources ADD COLUMN manifest_id TEXT NOT NULL DEFAULT 'source_manifest_r003_v1';
ALTER TABLE runtime_physical_responses ADD COLUMN replayable_response_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(replayable_response_json));

CREATE TRIGGER approved_synthetic_source_manifest_sealed_update
BEFORE UPDATE ON approved_synthetic_source_manifests
WHEN OLD.state = 'SEALED'
BEGIN SELECT RAISE(ABORT, 'approved synthetic source manifest is sealed'); END;
CREATE TRIGGER approved_synthetic_source_manifest_no_delete
BEFORE DELETE ON approved_synthetic_source_manifests
BEGIN SELECT RAISE(ABORT, 'approved synthetic source manifest is immutable'); END;
