CREATE TABLE magicchat_inbox_states (
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
  event_role TEXT NOT NULL CHECK (event_role IN ('INTAKE', 'CLARIFICATION_REPLY')),
  normalized_body TEXT NOT NULL CHECK (length(normalized_body) BETWEEN 1 AND 4096),
  reply_to_message_id TEXT, message_created_at TEXT NOT NULL,
  business_outcome TEXT NOT NULL CHECK (business_outcome IN (
    'CLARIFICATION_PENDING',
    'WAIT_FOR_INPUT',
    'UNMATCHED_INPUT',
    'EXPIRED_INPUT',
    'RESEARCHER'
  )),
  business_stable INTEGER NOT NULL CHECK (business_stable IN (0, 1)),
  ack_state TEXT NOT NULL CHECK (ack_state IN ('NONE', 'ACK_INTENT', 'ACK_CONFIRMED')),
  ack_action_id TEXT,
  created_at TEXT NOT NULL,
  stable_at TEXT,
  ack_confirmed_at TEXT,
  UNIQUE (app_id, cursor),
  UNIQUE (receipt_id, case_id),
  CHECK (
    (business_stable = 0 AND business_outcome = 'CLARIFICATION_PENDING' AND stable_at IS NULL) OR
    (business_stable = 1 AND business_outcome <> 'CLARIFICATION_PENDING' AND stable_at IS NOT NULL)
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

CREATE TABLE wait_challenges (
  challenge_id TEXT PRIMARY KEY CHECK (
    length(challenge_id) = 74 AND
    substr(challenge_id, 1, 10) = 'challenge_' AND
    substr(challenge_id, 11) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.wait-challenge/v1'),
  case_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  question_entry_id TEXT NOT NULL UNIQUE,
  challenge_version INTEGER NOT NULL CHECK (challenge_version > 0),
  expected_app_id TEXT NOT NULL,
  expected_conversation_id TEXT NOT NULL,
  expected_actor_id TEXT NOT NULL,
  expected_input_contract TEXT NOT NULL CHECK (
    expected_input_contract = 'accord.clarification-answer/plain-text/v1'
  ),
  source_receipt_id TEXT NOT NULL,
  source_cursor INTEGER NOT NULL CHECK (source_cursor > 0),
  source_message_id TEXT NOT NULL,
  source_message_sequence INTEGER NOT NULL CHECK (source_message_sequence > 0),
  clarification_action_id TEXT NOT NULL UNIQUE,
  clarification_message_id TEXT,
  clarification_message_sequence INTEGER CHECK (clarification_message_sequence > 0),
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'RESUMED', 'EXPIRED')),
  resolved_by_receipt_id TEXT,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  resolved_at TEXT,
  UNIQUE (challenge_id, case_id),
  CHECK (
    (clarification_message_id IS NULL AND clarification_message_sequence IS NULL AND ready_at IS NULL) OR
    (clarification_message_id IS NOT NULL AND clarification_message_sequence IS NOT NULL AND ready_at IS NOT NULL)
  ),
  CHECK (
    (state = 'ACTIVE' AND resolved_by_receipt_id IS NULL AND resolved_at IS NULL) OR
    (state IN ('RESUMED', 'EXPIRED') AND resolved_by_receipt_id IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CHECK (state <> 'RESUMED' OR clarification_message_id IS NOT NULL),
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (board_id, case_id) REFERENCES boards(board_id, case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (question_entry_id) REFERENCES board_entries(board_entry_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (clarification_action_id) REFERENCES pending_side_effects(action_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (resolved_by_receipt_id) REFERENCES inbox_receipts(receipt_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE magicchat_rpc_actions (
  action_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.magicchat-rpc-action/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  request_envelope_id TEXT NOT NULL UNIQUE,
  rpc_method TEXT NOT NULL CHECK (rpc_method IN ('message.send', 'events.ack')),
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
  UNIQUE (action_id, case_id),
  CHECK (
    (confirmation_json IS NULL AND confirmed_external_id IS NULL AND confirmed_at IS NULL) OR
    (confirmation_json IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CHECK (rpc_method <> 'message.send' OR confirmation_json IS NULL OR confirmed_external_id IS NOT NULL),
  CHECK (rpc_method <> 'events.ack' OR confirmed_external_id IS NULL),
  FOREIGN KEY (action_id) REFERENCES pending_side_effects(action_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workflow_run_id, case_id) REFERENCES workflow_runs(workflow_run_id, case_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (receipt_id, case_id) REFERENCES inbox_receipts(receipt_id, case_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE magicchat_messages (
  message_record_id TEXT PRIMARY KEY CHECK (
    length(message_record_id) = 75 AND
    substr(message_record_id, 1, 11) = 'mc_message_' AND
    substr(message_record_id, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.magicchat-message/v1'),
  case_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose = 'CLARIFICATION'),
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
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_magicchat_inbox_app_cursor ON magicchat_inbox_states (app_id, cursor, ack_state);
CREATE INDEX idx_magicchat_rpc_request ON magicchat_rpc_actions (receipt_id, rpc_method, request_envelope_id);
CREATE UNIQUE INDEX idx_wait_challenges_active_app
  ON wait_challenges (expected_app_id)
  WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX idx_wait_challenges_run_version
  ON wait_challenges (workflow_run_id, challenge_version);
