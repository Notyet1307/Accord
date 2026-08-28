CREATE TABLE profile_contexts (
  context_id TEXT PRIMARY KEY CHECK (length(context_id) = 72 AND substr(context_id, 1, 8) = 'context_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.profile-context/v1'),
  invocation_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  node_id TEXT NOT NULL CHECK (node_id IN ('RESEARCHER', 'ANALYST')),
  workflow_definition_id TEXT NOT NULL,
  workflow_definition_version TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  provider_port_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  objective TEXT NOT NULL,
  selected_entries_json TEXT NOT NULL CHECK (json_valid(selected_entries_json) AND json_type(selected_entries_json) = 'array'),
  /* The complete frozen synthetic source is retained so a claimed Attempt can
     be reconstructed from authority, never from a caller-supplied context. */
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

CREATE TABLE runtime_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) = 72 AND substr(attempt_id, 1, 8) = 'attempt_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-attempt/v1'),
  invocation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
  state TEXT NOT NULL CHECK (state IN ('READY', 'RUNNING', 'UNKNOWN', 'RESULT_RECEIVED', 'WINNER', 'DISCARDED')),
  no_sdk_retry INTEGER NOT NULL CHECK (no_sdk_retry = 1),
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (invocation_id, attempt_number),
  UNIQUE (attempt_id, invocation_id),
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

/* Canonical response facts are separate from immutable delivery/arrival audits. */
CREATE TABLE runtime_results (
  result_id TEXT PRIMARY KEY CHECK (length(result_id) = 71 AND substr(result_id, 1, 7) = 'result_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-result/v1'),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  provider_metadata_json TEXT NOT NULL CHECK (json_valid(provider_metadata_json) AND json_type(provider_metadata_json) = 'object'),
  output_json TEXT NOT NULL CHECK (json_valid(output_json) AND json_type(output_json) = 'object'),
  output_digest TEXT NOT NULL CHECK (length(output_digest) = 64 AND output_digest NOT GLOB '*[^0-9a-f]*'),
  usage_json TEXT NOT NULL CHECK (json_valid(usage_json) AND json_type(usage_json) = 'object'),
  first_received_at TEXT NOT NULL,
  UNIQUE (attempt_id, output_digest),
  UNIQUE (result_id, invocation_id, attempt_id),
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (attempt_id, invocation_id) REFERENCES runtime_attempts(attempt_id, invocation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE runtime_result_arrivals (
  arrival_id TEXT PRIMARY KEY CHECK (length(arrival_id) = 72 AND substr(arrival_id, 1, 8) = 'arrival_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-result-arrival/v1'),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  result_id TEXT,
  arrival_number INTEGER NOT NULL CHECK (arrival_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('WINNER', 'LATE', 'STALE', 'DUPLICATE', 'DIVERGENT', 'UNKNOWN', 'INVALID')),
  raw_response_json TEXT NOT NULL CHECK (json_valid(raw_response_json)),
  raw_response_digest TEXT NOT NULL CHECK (length(raw_response_digest) = 64 AND raw_response_digest NOT GLOB '*[^0-9a-f]*'),
  recorded_at TEXT NOT NULL,
  UNIQUE (attempt_id, arrival_number),
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (attempt_id, invocation_id) REFERENCES runtime_attempts(attempt_id, invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (result_id, invocation_id, attempt_id) REFERENCES runtime_results(result_id, invocation_id, attempt_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_profile_contexts_run_node ON profile_contexts (workflow_run_id, node_id);
CREATE INDEX idx_runtime_attempts_invocation ON runtime_attempts (invocation_id, attempt_number);
CREATE INDEX idx_runtime_results_invocation ON runtime_results (invocation_id, first_received_at);
CREATE INDEX idx_runtime_result_arrivals_invocation ON runtime_result_arrivals (invocation_id, recorded_at);

CREATE TRIGGER profile_contexts_immutable_update BEFORE UPDATE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
CREATE TRIGGER profile_contexts_immutable_delete BEFORE DELETE ON profile_contexts BEGIN SELECT RAISE(ABORT, 'profile contexts are immutable'); END;
CREATE TRIGGER runtime_results_immutable_update BEFORE UPDATE ON runtime_results BEGIN SELECT RAISE(ABORT, 'runtime results are immutable'); END;
CREATE TRIGGER runtime_results_immutable_delete BEFORE DELETE ON runtime_results BEGIN SELECT RAISE(ABORT, 'runtime results are immutable'); END;
CREATE TRIGGER runtime_result_arrivals_immutable_update BEFORE UPDATE ON runtime_result_arrivals BEGIN SELECT RAISE(ABORT, 'runtime result arrivals are immutable'); END;
CREATE TRIGGER runtime_result_arrivals_immutable_delete BEFORE DELETE ON runtime_result_arrivals BEGIN SELECT RAISE(ABORT, 'runtime result arrivals are immutable'); END;
CREATE TRIGGER board_entries_immutable_update BEFORE UPDATE ON board_entries BEGIN SELECT RAISE(ABORT, 'board entries are immutable'); END;
CREATE TRIGGER board_entries_immutable_delete BEFORE DELETE ON board_entries BEGIN SELECT RAISE(ABORT, 'board entries are immutable'); END;
