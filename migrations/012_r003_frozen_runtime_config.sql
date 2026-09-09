/* R003 F1 frozen runtime configuration authority. */
CREATE TABLE runtime_configurations (
  configuration_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.frozen-runtime-config/v1'),
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json) AND length(CAST(canonical_json AS BLOB)) <= 131072),
  config_digest TEXT NOT NULL CHECK (length(config_digest) = 64 AND config_digest NOT GLOB '*[^0-9a-f]*'),
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (configuration_id, revision),
  UNIQUE (configuration_id, revision, config_digest)
) STRICT;

CREATE TABLE run_runtime_configurations (
  workflow_run_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  configuration_id TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL,
  config_digest TEXT NOT NULL CHECK (length(config_digest) = 64 AND config_digest NOT GLOB '*[^0-9a-f]*'),
  bound_at TEXT NOT NULL,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (configuration_id, configuration_revision, config_digest) REFERENCES runtime_configurations(configuration_id, revision, config_digest) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE invocation_runtime_configurations (
  invocation_id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  configuration_id TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL,
  config_digest TEXT NOT NULL CHECK (length(config_digest) = 64 AND config_digest NOT GLOB '*[^0-9a-f]*'),
  bound_at TEXT NOT NULL,
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (configuration_id, configuration_revision, config_digest) REFERENCES runtime_configurations(configuration_id, revision, config_digest) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_run_runtime_configurations_config ON run_runtime_configurations(configuration_id, configuration_revision);
CREATE INDEX idx_invocation_runtime_configurations_run ON invocation_runtime_configurations(workflow_run_id, invocation_id);

CREATE TRIGGER runtime_configurations_immutable_update BEFORE UPDATE ON runtime_configurations BEGIN SELECT RAISE(ABORT, 'runtime configurations are immutable'); END;
CREATE TRIGGER runtime_configurations_immutable_delete BEFORE DELETE ON runtime_configurations BEGIN SELECT RAISE(ABORT, 'runtime configurations are immutable'); END;
CREATE TRIGGER run_runtime_configurations_immutable_update BEFORE UPDATE ON run_runtime_configurations BEGIN SELECT RAISE(ABORT, 'run runtime configurations are immutable'); END;
CREATE TRIGGER run_runtime_configurations_immutable_delete BEFORE DELETE ON run_runtime_configurations BEGIN SELECT RAISE(ABORT, 'run runtime configurations are immutable'); END;
CREATE TRIGGER invocation_runtime_configurations_immutable_update BEFORE UPDATE ON invocation_runtime_configurations BEGIN SELECT RAISE(ABORT, 'invocation runtime configurations are immutable'); END;
CREATE TRIGGER invocation_runtime_configurations_immutable_delete BEFORE DELETE ON invocation_runtime_configurations BEGIN SELECT RAISE(ABORT, 'invocation runtime configurations are immutable'); END;

/* Admit the bound v2 context while preserving every legacy v1 row and value. */
CREATE TABLE profile_contexts_config_bound_v2 (
  context_id TEXT PRIMARY KEY CHECK (length(context_id) = 72 AND substr(context_id, 1, 8) = 'context_'),
  schema_version TEXT NOT NULL CHECK (schema_version IN ('accord.profile-context/v1', 'accord.profile-context/config-bound-v2')),
  invocation_id TEXT NOT NULL UNIQUE, case_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, board_id TEXT NOT NULL,
  node_id TEXT NOT NULL CHECK (node_id IN ('RESEARCHER', 'ANALYST', 'REVIEWER', 'WRITER')),
  workflow_definition_id TEXT NOT NULL, workflow_definition_version TEXT NOT NULL, profile_version TEXT NOT NULL,
  provider_port_version TEXT NOT NULL, model_id TEXT NOT NULL, runtime_version TEXT NOT NULL, output_schema TEXT NOT NULL,
  objective TEXT NOT NULL, selected_entries_json TEXT NOT NULL CHECK (json_valid(selected_entries_json) AND json_type(selected_entries_json) = 'array'),
  approved_sources_json TEXT NOT NULL CHECK (json_valid(approved_sources_json) AND json_type(approved_sources_json) = 'array'),
  permission_summary_json TEXT NOT NULL CHECK (json_valid(permission_summary_json) AND json_type(permission_summary_json) = 'object'),
  context_digest TEXT NOT NULL CHECK (length(context_digest) = 64 AND context_digest NOT GLOB '*[^0-9a-f]*'), created_at TEXT NOT NULL,
  configuration_id TEXT, configuration_revision INTEGER, config_digest TEXT,
  CHECK ((schema_version = 'accord.profile-context/config-bound-v2' AND configuration_id IS NOT NULL AND configuration_revision IS NOT NULL AND config_digest IS NOT NULL) OR (schema_version = 'accord.profile-context/v1' AND configuration_id IS NULL AND configuration_revision IS NULL AND config_digest IS NULL)),
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(workflow_definition_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (configuration_id, configuration_revision, config_digest) REFERENCES runtime_configurations(configuration_id, revision, config_digest) DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO profile_contexts_config_bound_v2 (context_id,schema_version,invocation_id,case_id,workflow_run_id,board_id,node_id,workflow_definition_id,workflow_definition_version,profile_version,provider_port_version,model_id,runtime_version,output_schema,objective,selected_entries_json,approved_sources_json,permission_summary_json,context_digest,created_at) SELECT context_id,schema_version,invocation_id,case_id,workflow_run_id,board_id,node_id,workflow_definition_id,workflow_definition_version,profile_version,provider_port_version,model_id,runtime_version,output_schema,objective,selected_entries_json,approved_sources_json,permission_summary_json,context_digest,created_at FROM profile_contexts;
DROP TABLE profile_contexts;
ALTER TABLE profile_contexts_config_bound_v2 RENAME TO profile_contexts;
CREATE INDEX idx_profile_contexts_run_node ON profile_contexts (workflow_run_id, node_id);
CREATE TRIGGER profile_contexts_immutable_update BEFORE UPDATE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
CREATE TRIGGER profile_contexts_immutable_delete BEFORE DELETE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
