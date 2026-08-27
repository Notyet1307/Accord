CREATE TABLE accord_schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  migration_id TEXT NOT NULL UNIQUE,
  migration_sha256 TEXT NOT NULL CHECK (
    length(migration_sha256) = 64 AND
    migration_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_fingerprint TEXT NOT NULL CHECK (
    length(schema_fingerprint) = 64 AND
    schema_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE workflow_definitions (
  workflow_definition_id TEXT PRIMARY KEY,
  definition_version TEXT NOT NULL UNIQUE,
  nodes_json TEXT NOT NULL CHECK (json_valid(nodes_json) AND json_type(nodes_json) = 'array'),
  definition_digest TEXT NOT NULL CHECK (
    length(definition_digest) = 64 AND
    definition_digest NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (workflow_definition_id = 'workflow_definition_r003_fixed_v1'),
  CHECK (definition_version = 'r003-fixed/v1')
) STRICT;

INSERT INTO workflow_definitions (
  workflow_definition_id,
  definition_version,
  nodes_json,
  definition_digest
) VALUES (
  'workflow_definition_r003_fixed_v1',
  'r003-fixed/v1',
  '["INTAKE","WAIT_FOR_INPUT","RESEARCHER","ANALYST","REVIEWER","WRITER","WAIT_FOR_APPROVAL","FRESHNESS_CHECK","PUBLISH","COMPLETE"]',
  'c3642f68d32c15d7b1940103ebb74b8e2c882beb71499f1871138eebfd987f61'
);

CREATE TABLE cases (
  case_id TEXT PRIMARY KEY CHECK (
    length(case_id) = 69 AND
    substr(case_id, 1, 5) = 'case_' AND
    substr(case_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.case/v1'),
  source_app_id TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 4096),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETE', 'FAILED', 'REJECTED')),
  board_id TEXT NOT NULL UNIQUE,
  workflow_run_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (source_app_id, source_conversation_id, source_message_id),
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE boards (
  board_id TEXT PRIMARY KEY CHECK (
    length(board_id) = 70 AND
    substr(board_id, 1, 6) = 'board_' AND
    substr(board_id, 7) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.board/v1'),
  case_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (board_id, case_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE workflow_runs (
  workflow_run_id TEXT PRIMARY KEY CHECK (
    length(workflow_run_id) = 68 AND
    substr(workflow_run_id, 1, 4) = 'run_' AND
    substr(workflow_run_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.workflow-run/v1'),
  case_id TEXT NOT NULL UNIQUE,
  board_id TEXT NOT NULL UNIQUE,
  workflow_definition_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'INTAKE',
    'WAIT_FOR_INPUT',
    'RESEARCHER',
    'ANALYST',
    'REVIEWER',
    'WRITER',
    'WAIT_FOR_APPROVAL',
    'FRESHNESS_CHECK',
    'PUBLISH',
    'PUBLICATION_HOLD',
    'COMPLETE',
    'FAILED',
    'REJECTED'
  )),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (workflow_run_id, case_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(workflow_definition_id)
) STRICT;

CREATE TABLE inbox_receipts (
  receipt_id TEXT PRIMARY KEY CHECK (
    length(receipt_id) = 72 AND
    substr(receipt_id, 1, 8) = 'receipt_' AND
    substr(receipt_id, 9) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.inbox-receipt/v1'),
  app_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  envelope_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'message.created'),
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 64 AND
    payload_digest NOT GLOB '*[^0-9a-f]*'
  ),
  source_conversation_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_message_sequence INTEGER NOT NULL CHECK (source_message_sequence > 0),
  source_actor_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('PROCESSED', 'FAILED')),
  received_at TEXT NOT NULL,
  UNIQUE (app_id, cursor),
  UNIQUE (app_id, source_message_id),
  UNIQUE (receipt_id, case_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inbox_deliveries (
  delivery_id TEXT PRIMARY KEY CHECK (
    length(delivery_id) = 73 AND
    substr(delivery_id, 1, 9) = 'delivery_' AND
    substr(delivery_id, 10) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.inbox-delivery/v1'),
  receipt_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  envelope_event_id TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  UNIQUE (delivery_id, receipt_id),
  UNIQUE (receipt_id, envelope_event_id),
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE board_entries (
  board_entry_id TEXT PRIMARY KEY CHECK (
    length(board_entry_id) = 70 AND
    substr(board_entry_id, 1, 6) = 'entry_' AND
    substr(board_entry_id, 7) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.board-entry/v1'),
  board_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'EvidenceRef',
    'Observation',
    'Question',
    'Intent',
    'Claim',
    'Proposal',
    'Critique',
    'VerificationResult',
    'ArtifactRef'
  )),
  status TEXT NOT NULL CHECK (status IN ('CANDIDATE', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  author_type TEXT NOT NULL CHECK (author_type IN ('SYSTEM', 'HUMAN', 'AGENT')),
  author_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json) AND json_type(source_refs_json) = 'array'),
  based_on_json TEXT NOT NULL CHECK (json_valid(based_on_json) AND json_type(based_on_json) = 'array'),
  contradicts_json TEXT NOT NULL CHECK (json_valid(contradicts_json) AND json_type(contradicts_json) = 'array'),
  supersedes_json TEXT NOT NULL CHECK (json_valid(supersedes_json) AND json_type(supersedes_json) = 'array'),
  visibility TEXT NOT NULL CHECK (visibility IN ('CASE', 'PROFILE_RESTRICTED')),
  trust_level TEXT NOT NULL CHECK (trust_level IN ('UNTRUSTED', 'CANDIDATE', 'VERIFIED')),
  instruction_authority TEXT NOT NULL CHECK (instruction_authority = 'NONE'),
  created_revision INTEGER NOT NULL CHECK (created_revision > 0),
  content_digest TEXT NOT NULL CHECK (
    length(content_digest) = 64 AND
    content_digest NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE runtime_invocations (
  invocation_id TEXT PRIMARY KEY CHECK (
    length(invocation_id) = 75 AND
    substr(invocation_id, 1, 11) = 'invocation_' AND
    substr(invocation_id, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-invocation/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  workflow_revision INTEGER NOT NULL CHECK (workflow_revision > 0),
  board_revision INTEGER NOT NULL CHECK (board_revision >= 0),
  context_digest TEXT NOT NULL CHECK (
    length(context_digest) = 64 AND
    context_digest NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('READY', 'RUNNING', 'UNKNOWN', 'RESULT_COMMITTED', 'FAILED')),
  attempt_budget INTEGER NOT NULL CHECK (attempt_budget BETWEEN 1 AND 2),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, workflow_run_id, node_id, profile_version, context_digest),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY CHECK (
    length(approval_id) = 73 AND
    substr(approval_id, 1, 9) = 'approval_' AND
    substr(approval_id, 10) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.approval/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision > 0),
  artifact_digest TEXT NOT NULL CHECK (
    length(artifact_digest) = 64 AND
    artifact_digest NOT GLOB '*[^0-9a-f]*'
  ),
  expected_actor_id TEXT NOT NULL,
  choice_message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, workflow_run_id, artifact_revision),
  UNIQUE (approval_id, case_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE response_claims (
  response_claim_id TEXT PRIMARY KEY CHECK (
    length(response_claim_id) = 79 AND
    substr(response_claim_id, 1, 15) = 'response_claim_' AND
    substr(response_claim_id, 16) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.response-claim/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  publication_slot TEXT NOT NULL CHECK (publication_slot = 'FINAL_RESPONSE'),
  claim_version INTEGER NOT NULL CHECK (claim_version > 0),
  board_revision INTEGER NOT NULL CHECK (board_revision >= 0),
  workflow_revision INTEGER NOT NULL CHECK (workflow_revision > 0),
  freshness_token_digest TEXT NOT NULL CHECK (
    length(freshness_token_digest) = 64 AND
    freshness_token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('CLAIMED', 'HELD', 'CONFIRMED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, publication_slot),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (approval_id, case_id) REFERENCES approvals(approval_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE pending_side_effects (
  action_id TEXT PRIMARY KEY CHECK (
    length(action_id) = 71 AND
    substr(action_id, 1, 7) = 'action_' AND
    substr(action_id, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.pending-side-effect/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('CLARIFICATION', 'APPROVAL_REQUEST', 'PUBLICATION', 'ACK')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 64 AND
    payload_digest NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'CONFIRMED', 'UNKNOWN', 'FAILED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE audit_events (
  audit_event_id TEXT PRIMARY KEY CHECK (
    length(audit_event_id) = 70 AND
    substr(audit_event_id, 1, 6) = 'audit_' AND
    substr(audit_event_id, 7) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.audit-event/v1'),
  correlation_id TEXT NOT NULL CHECK (
    length(correlation_id) = 69 AND
    substr(correlation_id, 1, 5) = 'corr_' AND
    substr(correlation_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  event_kind TEXT NOT NULL,
  case_id TEXT,
  board_id TEXT,
  workflow_run_id TEXT,
  receipt_id TEXT,
  details_json TEXT NOT NULL CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
  recorded_at TEXT NOT NULL,
  UNIQUE (correlation_id, event_kind),
  CHECK (board_id IS NULL OR case_id IS NOT NULL),
  CHECK (workflow_run_id IS NULL OR case_id IS NOT NULL),
  CHECK (receipt_id IS NULL OR case_id IS NOT NULL),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_inbox_receipts_case ON inbox_receipts (case_id, cursor);
CREATE INDEX idx_inbox_deliveries_receipt ON inbox_deliveries (receipt_id, received_at, delivery_id);
CREATE INDEX idx_board_entries_case_revision ON board_entries (case_id, created_revision);
CREATE INDEX idx_runtime_invocations_run_status ON runtime_invocations (workflow_run_id, status);
CREATE INDEX idx_pending_side_effects_state ON pending_side_effects (state, created_at);
CREATE INDEX idx_audit_events_correlation ON audit_events (correlation_id, recorded_at);
CREATE UNIQUE INDEX idx_audit_events_intake_receipt
  ON audit_events (receipt_id)
  WHERE event_kind = 'INTAKE_COMMITTED';

CREATE TRIGGER inbox_deliveries_immutable_collision
BEFORE INSERT ON inbox_deliveries
WHEN EXISTS (
  SELECT 1
  FROM inbox_deliveries
  WHERE delivery_id = NEW.delivery_id OR envelope_event_id = NEW.envelope_event_id
)
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM inbox_deliveries
      WHERE delivery_id = NEW.delivery_id
        AND schema_version = NEW.schema_version
        AND receipt_id = NEW.receipt_id
        AND case_id = NEW.case_id
        AND envelope_event_id = NEW.envelope_event_id
        AND received_at = NEW.received_at
    ) THEN RAISE(IGNORE)
    ELSE RAISE(ABORT, 'replayed delivery conflicts with the immutable delivery audit')
  END;
END;

CREATE TRIGGER inbox_deliveries_immutable_update
BEFORE UPDATE ON inbox_deliveries
BEGIN
  SELECT RAISE(ABORT, 'inbox delivery audit records are immutable');
END;

CREATE TRIGGER inbox_deliveries_immutable_delete
BEFORE DELETE ON inbox_deliveries
BEGIN
  SELECT RAISE(ABORT, 'inbox delivery audit records are immutable');
END;
