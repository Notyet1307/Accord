/* Schema 9 widens the fixed Context boundary without changing any existing
 * Researcher/Analyst row or identity.  Reviewer and Writer remain the only
 * newly admitted profile nodes; no dynamic profile catalog is introduced. */
CREATE TABLE profile_contexts_schema9 (
  context_id TEXT PRIMARY KEY CHECK (length(context_id) = 72 AND substr(context_id, 1, 8) = 'context_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.profile-context/v1'),
  invocation_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  node_id TEXT NOT NULL CHECK (node_id IN ('RESEARCHER', 'ANALYST', 'REVIEWER', 'WRITER')),
  workflow_definition_id TEXT NOT NULL,
  workflow_definition_version TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  provider_port_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  objective TEXT NOT NULL,
  selected_entries_json TEXT NOT NULL CHECK (json_valid(selected_entries_json) AND json_type(selected_entries_json) = 'array'),
  approved_sources_json TEXT NOT NULL CHECK (json_valid(approved_sources_json) AND json_type(approved_sources_json) = 'array'),
  permission_summary_json TEXT NOT NULL CHECK (json_valid(permission_summary_json) AND json_type(permission_summary_json) = 'object'),
  context_digest TEXT NOT NULL CHECK (length(context_digest) = 64 AND context_digest NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(workflow_definition_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

INSERT INTO profile_contexts_schema9 SELECT * FROM profile_contexts;
DROP TABLE profile_contexts;
ALTER TABLE profile_contexts_schema9 RENAME TO profile_contexts;

CREATE INDEX idx_profile_contexts_run_node ON profile_contexts (workflow_run_id, node_id);
CREATE TRIGGER profile_contexts_immutable_update BEFORE UPDATE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
CREATE TRIGGER profile_contexts_immutable_delete BEFORE DELETE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
