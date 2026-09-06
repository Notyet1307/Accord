CREATE TABLE artifacts (
  artifact_id TEXT NOT NULL CHECK (
    length(artifact_id) = 73 AND
    substr(artifact_id, 1, 9) = 'artifact_' AND
    substr(artifact_id, 10) NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision = 1),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.artifact/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  source_invocation_id TEXT NOT NULL UNIQUE,
  source_result_id TEXT NOT NULL UNIQUE,
  reviewer_result_id TEXT NOT NULL,
  reviewer_handoff_id TEXT NOT NULL CHECK (
    length(reviewer_handoff_id) = 72 AND
    substr(reviewer_handoff_id, 1, 8) = 'handoff_' AND
    substr(reviewer_handoff_id, 9) NOT GLOB '*[^0-9a-f]*'
  ),
  content_markdown TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (
    length(content_digest) = 64 AND
    content_digest NOT GLOB '*[^0-9a-f]*'
  ),
  material_assertions_json TEXT NOT NULL CHECK (
    json_valid(material_assertions_json) AND
    json_type(material_assertions_json) = 'array'
  ),
  manifest_digest TEXT NOT NULL CHECK (
    length(manifest_digest) = 64 AND
    manifest_digest NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_digest TEXT NOT NULL CHECK (
    length(artifact_digest) = 64 AND
    artifact_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_board_revision INTEGER NOT NULL CHECK (created_board_revision > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, artifact_revision),
  UNIQUE (case_id, workflow_run_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_result_id) REFERENCES runtime_results(result_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (reviewer_result_id) REFERENCES runtime_results(result_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TRIGGER artifacts_immutable_update
BEFORE UPDATE ON artifacts
BEGIN SELECT RAISE(ABORT, 'artifacts are immutable'); END;

CREATE TRIGGER artifacts_immutable_delete
BEFORE DELETE ON artifacts
BEGIN SELECT RAISE(ABORT, 'artifacts are immutable'); END;
