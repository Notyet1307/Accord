/* Generalize existing authority facts without rewriting their stored values. */

CREATE TABLE approval_challenges (
  challenge_id TEXT PRIMARY KEY CHECK (
    length(challenge_id) = 74 AND substr(challenge_id, 1, 10) = 'challenge_' AND substr(challenge_id, 11) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.approval-challenge/v1'),
  case_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision = 1),
  artifact_digest TEXT NOT NULL CHECK (length(artifact_digest) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*'),
  challenge_version INTEGER NOT NULL CHECK (challenge_version > 0),
  expected_app_id TEXT NOT NULL,
  expected_conversation_id TEXT NOT NULL,
  expected_actor_id TEXT NOT NULL,
  expected_board_revision INTEGER NOT NULL CHECK (expected_board_revision >= 0),
  expected_workflow_revision INTEGER NOT NULL CHECK (expected_workflow_revision > 0),
  source_receipt_id TEXT NOT NULL,
  source_cursor INTEGER NOT NULL CHECK (source_cursor > 0),
  source_message_sequence INTEGER NOT NULL CHECK (source_message_sequence > 0),
  approval_action_id TEXT NOT NULL UNIQUE,
  binding_json TEXT NOT NULL CHECK (json_valid(binding_json) AND json_type(binding_json) = 'object'),
  binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64 AND binding_digest NOT GLOB '*[^0-9a-f]*'),
  options_json TEXT NOT NULL CHECK (options_json = '["approve","reject"]'),
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('REQUEST_PENDING', 'WAIT_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLICATION_HOLD', 'COMPLETE')),
  choice_message_id TEXT,
  choice_message_sequence INTEGER CHECK (choice_message_sequence > 0),
  ready_at TEXT,
  resolved_by_receipt_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (challenge_id, case_id),
  UNIQUE (case_id, workflow_run_id, artifact_id, artifact_revision),
  UNIQUE (workflow_run_id, challenge_version),
  UNIQUE (expected_app_id, expected_conversation_id, choice_message_id),
  CHECK ((choice_message_id IS NULL AND choice_message_sequence IS NULL AND ready_at IS NULL)
    OR (choice_message_id IS NOT NULL AND choice_message_sequence IS NOT NULL AND ready_at IS NOT NULL)),
  CHECK (state <> 'REQUEST_PENDING' OR choice_message_id IS NULL),
  CHECK (state NOT IN ('WAIT_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETE') OR choice_message_id IS NOT NULL),
  CHECK ((resolved_by_receipt_id IS NULL AND resolved_at IS NULL)
    OR (resolved_by_receipt_id IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (state NOT IN ('APPROVED', 'REJECTED', 'COMPLETE') OR resolved_by_receipt_id IS NOT NULL),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (artifact_id, artifact_revision) REFERENCES artifacts(artifact_id, artifact_revision) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (approval_action_id, case_id) REFERENCES magicchat_rpc_actions(action_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (resolved_by_receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inbox_receipts_schema11 (
  receipt_id TEXT PRIMARY KEY CHECK (
    length(receipt_id) = 72 AND
    substr(receipt_id, 1, 8) = 'receipt_' AND
    substr(receipt_id, 9) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.inbox-receipt/v1'),
  app_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  envelope_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('message.created', 'choice.response_created')),
  payload_digest TEXT NOT NULL CHECK (
    length(payload_digest) = 64 AND
    payload_digest NOT GLOB '*[^0-9a-f]*'
  ),
  source_conversation_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_message_sequence INTEGER NOT NULL CHECK (source_message_sequence > 0),
  source_actor_id TEXT NOT NULL,
  source_response_id TEXT,
  case_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
  received_at TEXT NOT NULL,
  UNIQUE (app_id, cursor),
  UNIQUE (receipt_id, case_id),
  CHECK ((event_type = 'message.created' AND source_response_id IS NULL) OR
    (event_type = 'choice.response_created' AND source_response_id IS NOT NULL)),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO inbox_receipts_schema11 (receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type, payload_digest, source_conversation_id, source_message_id, source_message_sequence, source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at)
SELECT receipt_id, schema_version, app_id, cursor, envelope_event_id, event_type, payload_digest, source_conversation_id, source_message_id, source_message_sequence, source_actor_id, case_id, board_id, workflow_run_id, processing_status, received_at FROM inbox_receipts;
DROP TABLE inbox_receipts;
ALTER TABLE inbox_receipts_schema11 RENAME TO inbox_receipts;

CREATE INDEX idx_inbox_receipts_case ON inbox_receipts (case_id, cursor);
CREATE UNIQUE INDEX idx_inbox_receipts_message ON inbox_receipts (app_id, source_message_id)
  WHERE event_type = 'message.created';

CREATE TABLE magicchat_inbox_states_schema11 (
  receipt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.magicchat-inbox-state/v1'),
  app_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  case_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE CHECK (
    length(correlation_id) = 69 AND
    substr(correlation_id, 1, 5) = 'corr_' AND
    substr(correlation_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  event_role TEXT NOT NULL CHECK (event_role IN ('INTAKE', 'CLARIFICATION_REPLY', 'APPROVAL_RESPONSE', 'OBSERVED_INPUT')),
  normalized_body TEXT CHECK (length(normalized_body) BETWEEN 1 AND 4096),
  reply_to_message_id TEXT, message_created_at TEXT,
  event_payload_json TEXT CHECK (event_payload_json IS NULL OR (json_valid(event_payload_json) AND json_type(event_payload_json) = 'object')),
  business_outcome TEXT NOT NULL CHECK (business_outcome IN (
    'CLARIFICATION_PENDING',
    'WAIT_FOR_INPUT',
    'UNMATCHED_INPUT',
    'EXPIRED_INPUT',
    'RESEARCHER',
    'APPROVAL_PENDING',
    'WAIT_FOR_APPROVAL',
    'FRESHNESS_PENDING',
    'PUBLICATION_PENDING',
    'PUBLICATION_HOLD',
    'COMPLETE',
    'REJECTED',
    'INVALID_CHOICE',
    'OBSERVED_INPUT'
  )),
  business_stable INTEGER NOT NULL CHECK (business_stable IN (0, 1)),
  ack_state TEXT NOT NULL CHECK (ack_state IN ('NONE', 'ACK_INTENT', 'ACK_CONFIRMED')),
  ack_action_id TEXT,
  created_at TEXT NOT NULL,
  stable_at TEXT,
  ack_confirmed_at TEXT,
  UNIQUE (app_id, cursor),
  UNIQUE (receipt_id, case_id),
  CHECK (event_role NOT IN ('INTAKE', 'CLARIFICATION_REPLY') OR (normalized_body IS NOT NULL AND message_created_at IS NOT NULL)),
  CHECK (event_role NOT IN ('APPROVAL_RESPONSE', 'OBSERVED_INPUT') OR event_payload_json IS NOT NULL),
  CHECK (
    (business_stable = 0 AND business_outcome IN ('CLARIFICATION_PENDING', 'APPROVAL_PENDING', 'FRESHNESS_PENDING', 'PUBLICATION_PENDING', 'OBSERVED_INPUT', 'INVALID_CHOICE') AND stable_at IS NULL) OR
    (business_stable = 1 AND business_outcome NOT IN ('CLARIFICATION_PENDING', 'APPROVAL_PENDING', 'FRESHNESS_PENDING', 'PUBLICATION_PENDING') AND stable_at IS NOT NULL)
  ),
  CHECK (
    (ack_state = 'NONE' AND ack_action_id IS NULL AND ack_confirmed_at IS NULL) OR
    (ack_state = 'ACK_INTENT' AND business_stable = 1 AND ack_action_id IS NOT NULL AND ack_confirmed_at IS NULL) OR
    (ack_state = 'ACK_CONFIRMED' AND business_stable = 1 AND ack_action_id IS NOT NULL AND ack_confirmed_at IS NOT NULL)
  ),
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (ack_action_id) REFERENCES pending_side_effects(action_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO magicchat_inbox_states_schema11 (receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id, correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome, business_stable, ack_state, ack_action_id, created_at, stable_at, ack_confirmed_at)
SELECT receipt_id, schema_version, app_id, cursor, case_id, board_id, workflow_run_id, correlation_id, event_role, normalized_body, reply_to_message_id, message_created_at, business_outcome, business_stable, ack_state, ack_action_id, created_at, stable_at, ack_confirmed_at FROM magicchat_inbox_states;
DROP TABLE magicchat_inbox_states;
ALTER TABLE magicchat_inbox_states_schema11 RENAME TO magicchat_inbox_states;

CREATE INDEX idx_magicchat_inbox_app_cursor ON magicchat_inbox_states (app_id, cursor, ack_state);

CREATE TABLE pending_side_effects_schema11 (
  action_id TEXT PRIMARY KEY CHECK (
    length(action_id) = 71 AND
    substr(action_id, 1, 7) = 'action_' AND
    substr(action_id, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.pending-side-effect/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('CLARIFICATION', 'APPROVAL_REQUEST', 'PUBLICATION', 'FRESHNESS_READ', 'ACK')),
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
INSERT INTO pending_side_effects_schema11 (action_id, schema_version, case_id, workflow_run_id, receipt_id, action_kind, idempotency_key, payload_digest, state, created_at)
SELECT action_id, schema_version, case_id, workflow_run_id, receipt_id, action_kind, idempotency_key, payload_digest, state, created_at FROM pending_side_effects;
DROP TABLE pending_side_effects;
ALTER TABLE pending_side_effects_schema11 RENAME TO pending_side_effects;

CREATE INDEX idx_pending_side_effects_state ON pending_side_effects (state, created_at);

CREATE TABLE magicchat_rpc_actions_schema11 (
  action_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.magicchat-rpc-action/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT,
  request_envelope_id TEXT NOT NULL UNIQUE,
  rpc_method TEXT NOT NULL CHECK (rpc_method IN ('message.send', 'events.ack', 'conversation.messages.list')),
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  request_digest TEXT NOT NULL CHECK (
    length(request_digest) = 64 AND
    request_digest NOT GLOB '*[^0-9a-f]*'
  ),
  confirmation_json TEXT CHECK (
    confirmation_json IS NULL OR (json_valid(confirmation_json) AND json_type(confirmation_json) = 'object')
  ),
  confirmed_external_id TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  dispatched_at TEXT,
  UNIQUE (action_id, case_id),
  CHECK (
    (confirmation_json IS NULL AND confirmed_external_id IS NULL AND confirmed_at IS NULL) OR
    (confirmation_json IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CHECK (rpc_method <> 'message.send' OR confirmation_json IS NULL OR confirmed_external_id IS NOT NULL),
  CHECK (rpc_method NOT IN ('events.ack', 'conversation.messages.list') OR confirmed_external_id IS NULL),
  FOREIGN KEY (action_id) REFERENCES pending_side_effects(action_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO magicchat_rpc_actions_schema11 (action_id, schema_version, case_id, workflow_run_id, receipt_id, request_envelope_id, rpc_method, request_json, request_digest, confirmation_json, confirmed_external_id, created_at, confirmed_at)
SELECT action_id, schema_version, case_id, workflow_run_id, receipt_id, request_envelope_id, rpc_method, request_json, request_digest, confirmation_json, confirmed_external_id, created_at, confirmed_at FROM magicchat_rpc_actions;
DROP TABLE magicchat_rpc_actions;
ALTER TABLE magicchat_rpc_actions_schema11 RENAME TO magicchat_rpc_actions;

CREATE INDEX idx_magicchat_rpc_request ON magicchat_rpc_actions (receipt_id, rpc_method, request_envelope_id);

CREATE TABLE approvals_schema11 (
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
  artifact_id TEXT,
  challenge_id TEXT UNIQUE,
  response_id TEXT UNIQUE,
  receipt_id TEXT UNIQUE,
  request_action_id TEXT,
  decision_digest TEXT CHECK (decision_digest IS NULL OR (length(decision_digest) = 64 AND decision_digest NOT GLOB '*[^0-9a-f]*')),
  decision_json TEXT CHECK (decision_json IS NULL OR (json_valid(decision_json) AND json_type(decision_json) = 'object')),
  decided_at TEXT,
  UNIQUE (case_id, workflow_run_id, artifact_revision),
  UNIQUE (approval_id, case_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (challenge_id IS NULL OR (artifact_id IS NOT NULL AND response_id IS NOT NULL AND receipt_id IS NOT NULL
    AND request_action_id IS NOT NULL AND decision_digest IS NOT NULL AND decision_json IS NOT NULL
    AND decided_at IS NOT NULL AND state IN ('APPROVED', 'REJECTED'))),
  FOREIGN KEY (artifact_id, artifact_revision) REFERENCES artifacts(artifact_id, artifact_revision) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (challenge_id, case_id) REFERENCES approval_challenges(challenge_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (request_action_id, case_id) REFERENCES magicchat_rpc_actions(action_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO approvals_schema11 (approval_id, schema_version, case_id, workflow_run_id, artifact_revision, artifact_digest, expected_actor_id, choice_message_id, state, created_at)
SELECT approval_id, schema_version, case_id, workflow_run_id, artifact_revision, artifact_digest, expected_actor_id, choice_message_id, state, created_at FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_schema11 RENAME TO approvals;

CREATE TABLE response_claims_schema11 (
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
  freshness_token_digest TEXT CHECK (
    length(freshness_token_digest) = 64 AND
    freshness_token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('CLAIMED', 'HELD', 'CONFIRMED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  artifact_id TEXT,
  artifact_revision INTEGER CHECK (artifact_revision = 1),
  artifact_digest TEXT CHECK (artifact_digest IS NULL OR (length(artifact_digest) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*')),
  owner_id TEXT,
  expires_at TEXT,
  UNIQUE (response_claim_id, case_id),
  UNIQUE (case_id, publication_slot),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (approval_id, case_id) REFERENCES approvals(approval_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (artifact_id IS NULL OR (artifact_revision IS NOT NULL AND artifact_digest IS NOT NULL AND owner_id IS NOT NULL AND expires_at IS NOT NULL)),
  FOREIGN KEY (artifact_id, artifact_revision) REFERENCES artifacts(artifact_id, artifact_revision) DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO response_claims_schema11 (response_claim_id, schema_version, case_id, workflow_run_id, approval_id, publication_slot, claim_version, board_revision, workflow_revision, freshness_token_digest, state, created_at)
SELECT response_claim_id, schema_version, case_id, workflow_run_id, approval_id, publication_slot, claim_version, board_revision, workflow_revision, freshness_token_digest, state, created_at FROM response_claims;
DROP TABLE response_claims;
ALTER TABLE response_claims_schema11 RENAME TO response_claims;

CREATE TABLE magicchat_messages_schema11 (
  message_record_id TEXT PRIMARY KEY CHECK (
    length(message_record_id) = 75 AND
    substr(message_record_id, 1, 11) = 'mc_message_' AND
    substr(message_record_id, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.magicchat-message/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT,
  action_id TEXT NOT NULL UNIQUE,
  challenge_id TEXT UNIQUE,
  approval_challenge_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('CLARIFICATION', 'APPROVAL_REQUEST', 'PUBLICATION')),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_sequence INTEGER NOT NULL CHECK (message_sequence > 0),
  confirmed_at TEXT NOT NULL,
  UNIQUE (conversation_id, message_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (action_id, case_id) REFERENCES magicchat_rpc_actions(action_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (challenge_id, case_id) REFERENCES wait_challenges(challenge_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((purpose = 'CLARIFICATION' AND challenge_id IS NOT NULL AND approval_challenge_id IS NULL AND receipt_id IS NOT NULL)
    OR (purpose IN ('APPROVAL_REQUEST', 'PUBLICATION') AND challenge_id IS NULL AND approval_challenge_id IS NOT NULL)),
  UNIQUE (approval_challenge_id, purpose),
  FOREIGN KEY (approval_challenge_id, case_id) REFERENCES approval_challenges(challenge_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
INSERT INTO magicchat_messages_schema11 (message_record_id, schema_version, case_id, workflow_run_id, receipt_id, action_id, challenge_id, purpose, conversation_id, message_id, message_sequence, confirmed_at)
SELECT message_record_id, schema_version, case_id, workflow_run_id, receipt_id, action_id, challenge_id, purpose, conversation_id, message_id, message_sequence, confirmed_at FROM magicchat_messages;
DROP TABLE magicchat_messages;
ALTER TABLE magicchat_messages_schema11 RENAME TO magicchat_messages;

CREATE TRIGGER approval_challenges_binding_immutable
BEFORE UPDATE ON approval_challenges
WHEN NEW.challenge_id IS NOT OLD.challenge_id OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.case_id IS NOT OLD.case_id OR NEW.board_id IS NOT OLD.board_id OR NEW.workflow_run_id IS NOT OLD.workflow_run_id
  OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.artifact_revision IS NOT OLD.artifact_revision OR NEW.artifact_digest IS NOT OLD.artifact_digest
  OR NEW.challenge_version IS NOT OLD.challenge_version OR NEW.expected_app_id IS NOT OLD.expected_app_id
  OR NEW.expected_conversation_id IS NOT OLD.expected_conversation_id OR NEW.expected_actor_id IS NOT OLD.expected_actor_id
  OR NEW.expected_board_revision IS NOT OLD.expected_board_revision OR NEW.expected_workflow_revision IS NOT OLD.expected_workflow_revision
  OR NEW.source_receipt_id IS NOT OLD.source_receipt_id OR NEW.source_cursor IS NOT OLD.source_cursor
  OR NEW.source_message_sequence IS NOT OLD.source_message_sequence OR NEW.approval_action_id IS NOT OLD.approval_action_id
  OR NEW.binding_json IS NOT OLD.binding_json OR NEW.binding_digest IS NOT OLD.binding_digest
  OR NEW.options_json IS NOT OLD.options_json OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.choice_message_id IS NOT NULL AND (NEW.choice_message_id IS NOT OLD.choice_message_id
    OR NEW.choice_message_sequence IS NOT OLD.choice_message_sequence OR NEW.ready_at IS NOT OLD.ready_at))
  OR (OLD.resolved_by_receipt_id IS NOT NULL AND (NEW.resolved_by_receipt_id IS NOT OLD.resolved_by_receipt_id OR NEW.resolved_at IS NOT OLD.resolved_at))
BEGIN SELECT RAISE(ABORT, 'approval challenge binding is immutable'); END;

CREATE TRIGGER approvals_decision_immutable_update
BEFORE UPDATE ON approvals WHEN OLD.challenge_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'approval decisions are immutable'); END;
CREATE TRIGGER approvals_decision_immutable_delete
BEFORE DELETE ON approvals WHEN OLD.challenge_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'approval decisions are immutable'); END;

CREATE TABLE publication_freshness (
  freshness_id TEXT PRIMARY KEY CHECK (
    length(freshness_id) = 74 AND substr(freshness_id, 1, 10) = 'freshness_' AND substr(freshness_id, 11) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.publication-freshness/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision = 1),
  artifact_digest TEXT NOT NULL CHECK (length(artifact_digest) = 64 AND artifact_digest NOT GLOB '*[^0-9a-f]*'),
  approval_id TEXT NOT NULL,
  response_claim_id TEXT NOT NULL,
  claim_version INTEGER NOT NULL CHECK (claim_version > 0),
  app_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  source_message_sequence INTEGER NOT NULL CHECK (source_message_sequence > 0),
  trigger_message_id TEXT NOT NULL,
  trigger_message_sequence INTEGER NOT NULL CHECK (trigger_message_sequence > 0),
  board_revision INTEGER NOT NULL CHECK (board_revision >= 0),
  workflow_revision INTEGER NOT NULL CHECK (workflow_revision > 0),
  read_action_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  snapshot_digest TEXT NOT NULL CHECK (length(snapshot_digest) = 64 AND snapshot_digest NOT GLOB '*[^0-9a-f]*'),
  token_json TEXT CHECK (token_json IS NULL OR (json_valid(token_json) AND json_type(token_json) = 'object')),
  token_digest TEXT CHECK (token_digest IS NULL OR (length(token_digest) = 64 AND token_digest NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'VALID', 'INVALID', 'CONSUMED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  invalidated_at TEXT,
  consumed_at TEXT,
  UNIQUE (response_claim_id, claim_version),
  CHECK ((token_json IS NULL AND token_digest IS NULL) OR (token_json IS NOT NULL AND token_digest IS NOT NULL)),
  CHECK (state NOT IN ('VALID', 'CONSUMED') OR (token_json IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (state <> 'PENDING' OR (token_json IS NULL AND confirmed_at IS NULL AND invalidated_at IS NULL AND consumed_at IS NULL)),
  CHECK ((state = 'CONSUMED' AND consumed_at IS NOT NULL) OR (state <> 'CONSUMED' AND consumed_at IS NULL)),
  CHECK ((state = 'INVALID' AND invalidated_at IS NOT NULL) OR (state <> 'INVALID' AND invalidated_at IS NULL)),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (artifact_id, artifact_revision) REFERENCES artifacts(artifact_id, artifact_revision) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (approval_id, case_id) REFERENCES approvals(approval_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (response_claim_id, case_id) REFERENCES response_claims(response_claim_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (read_action_id, case_id) REFERENCES magicchat_rpc_actions(action_id, case_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

/* Capture the pre-C3 Artifact set once, before recovery can create intents. */
CREATE TABLE approval_legacy_provenance (
  provenance_id TEXT PRIMARY KEY CHECK (provenance_id = 'approval_legacy_provenance_v1'),
  migration_id TEXT NOT NULL CHECK (migration_id = '011_r003_approval_publication'),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'array')
) STRICT;
INSERT INTO approval_legacy_provenance (provenance_id, migration_id, snapshot_json)
SELECT 'approval_legacy_provenance_v1', '011_r003_approval_publication',
  json_group_array(json_object('artifactId', artifact_id, 'artifactRevision', artifact_revision,
    'artifactDigest', artifact_digest, 'sourceResultId', source_result_id, 'createdAt', created_at))
FROM (SELECT artifact_id, artifact_revision, artifact_digest, source_result_id, created_at
  FROM artifacts ORDER BY artifact_id, artifact_revision);
CREATE TRIGGER approval_legacy_provenance_sealed_insert
BEFORE INSERT ON approval_legacy_provenance
BEGIN SELECT RAISE(ABORT, 'approval legacy provenance is sealed'); END;
CREATE TRIGGER approval_legacy_provenance_immutable_update
BEFORE UPDATE ON approval_legacy_provenance
BEGIN SELECT RAISE(ABORT, 'approval legacy provenance is immutable'); END;
CREATE TRIGGER approval_legacy_provenance_immutable_delete
BEFORE DELETE ON approval_legacy_provenance
BEGIN SELECT RAISE(ABORT, 'approval legacy provenance is immutable'); END;
