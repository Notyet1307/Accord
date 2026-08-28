/*
 * The Issue 12 repair makes the frozen source manifest and physical provider
 * receipt first-class authority.  It is deliberately additive: an Authority
 * opened at v3 is upgraded in place and no candidate state is rematerialized.
 */
CREATE TABLE approved_synthetic_sources (
  source_id TEXT PRIMARY KEY CHECK (length(source_id) = 71 AND substr(source_id, 1, 7) = 'source_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.approved-synthetic-source/v1'),
  source_kind TEXT NOT NULL,
  locator TEXT NOT NULL,
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  observed_at TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  UNIQUE (source_kind, locator, content_digest, observed_at)
) STRICT;

CREATE TABLE runtime_physical_responses (
  response_id TEXT PRIMARY KEY CHECK (length(response_id) = 73 AND substr(response_id, 1, 9) = 'response_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-physical-response/v1'),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  envelope_digest TEXT NOT NULL CHECK (length(envelope_digest) = 64 AND envelope_digest NOT GLOB '*[^0-9a-f]*'),
  redacted_envelope_json TEXT NOT NULL CHECK (json_valid(redacted_envelope_json)),
  trusted_received_at TEXT NOT NULL,
  provider_received_at TEXT,
  UNIQUE (attempt_id, envelope_digest),
  FOREIGN KEY (invocation_id) REFERENCES runtime_invocations(invocation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (attempt_id, invocation_id) REFERENCES runtime_attempts(attempt_id, invocation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

ALTER TABLE runtime_result_arrivals ADD COLUMN response_id TEXT REFERENCES runtime_physical_responses(response_id);

CREATE TABLE runtime_result_entries (
  result_id TEXT NOT NULL,
  board_entry_id TEXT NOT NULL,
  PRIMARY KEY (result_id, board_entry_id),
  FOREIGN KEY (result_id) REFERENCES runtime_results(result_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_entry_id) REFERENCES board_entries(board_entry_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_runtime_physical_responses_attempt ON runtime_physical_responses (attempt_id, trusted_received_at);
CREATE INDEX idx_runtime_result_entries_result ON runtime_result_entries (result_id, board_entry_id);

CREATE TRIGGER approved_synthetic_sources_immutable_update BEFORE UPDATE ON approved_synthetic_sources BEGIN SELECT RAISE(ABORT, 'approved synthetic sources are immutable'); END;
CREATE TRIGGER approved_synthetic_sources_immutable_delete BEFORE DELETE ON approved_synthetic_sources BEGIN SELECT RAISE(ABORT, 'approved synthetic sources are immutable'); END;
CREATE TRIGGER runtime_physical_responses_immutable_update BEFORE UPDATE ON runtime_physical_responses BEGIN SELECT RAISE(ABORT, 'runtime physical responses are immutable'); END;
CREATE TRIGGER runtime_physical_responses_immutable_delete BEFORE DELETE ON runtime_physical_responses BEGIN SELECT RAISE(ABORT, 'runtime physical responses are immutable'); END;
CREATE TRIGGER runtime_result_entries_immutable_update BEFORE UPDATE ON runtime_result_entries BEGIN SELECT RAISE(ABORT, 'runtime result entries are immutable'); END;
CREATE TRIGGER runtime_result_entries_immutable_delete BEFORE DELETE ON runtime_result_entries BEGIN SELECT RAISE(ABORT, 'runtime result entries are immutable'); END;
