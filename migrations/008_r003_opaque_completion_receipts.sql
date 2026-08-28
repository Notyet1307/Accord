/*
 * A bounded Provider completion is authority before it is JSON.  This crash
 * record deliberately retains the exact wire only until it has been converted
 * into the existing redacted physical-response / Delivery representation.
 *
 * v7's Delivery disposition records the state after receipt materialization:
 * RUNNING could not be represented there.  Preserve the separately-bound,
 * original receipt disposition without changing migration 007 or its rows.
 */
ALTER TABLE runtime_provider_deliveries
  ADD COLUMN original_attempt_state_at_receipt TEXT NOT NULL DEFAULT 'RESULT_RECEIVED'
  CHECK (original_attempt_state_at_receipt IN ('RUNNING', 'RESULT_RECEIVED', 'DISCARDED', 'UNKNOWN', 'WINNER'));

ALTER TABLE runtime_provider_deliveries
  ADD COLUMN original_receipt_state_binding TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (length(original_receipt_state_binding) = 64 AND original_receipt_state_binding NOT GLOB '*[^0-9a-f]*');

/* Only a v1 row is legacy.  A pre-schema-8 v2 Delivery has no original
 * receipt-state binding and must not be relabelled into the weaker branch.
 * Make that incompatibility fail inside this migration transaction. */
DROP TRIGGER runtime_provider_deliveries_immutable_update;
UPDATE runtime_provider_deliveries
  SET original_attempt_state_at_receipt = attempt_state_at_receipt
  WHERE schema_version = 'accord.runtime-provider-delivery/v1';
CREATE TRIGGER runtime_provider_deliveries_pre_schema8_v2_reject
BEFORE UPDATE ON runtime_provider_deliveries
WHEN OLD.schema_version = 'accord.runtime-provider-delivery/v2'
  AND NEW.schema_version = 'accord.runtime-provider-delivery/v2'
  AND NEW.original_receipt_state_binding = '0000000000000000000000000000000000000000000000000000000000000000'
BEGIN SELECT RAISE(ABORT, 'current Provider Delivery requires an original receipt binding'); END;
UPDATE runtime_provider_deliveries
  SET original_receipt_state_binding = original_receipt_state_binding
  WHERE schema_version = 'accord.runtime-provider-delivery/v2';
DROP TRIGGER runtime_provider_deliveries_pre_schema8_v2_reject;
CREATE TRIGGER runtime_provider_deliveries_immutable_update
BEFORE UPDATE ON runtime_provider_deliveries
BEGIN SELECT RAISE(ABORT, 'runtime provider deliveries are immutable'); END;

/* A zero original-state binding is permitted only for the exact Delivery rows
 * that existed before schema 8.  The migration records a complete immutable
 * row-level witness while the enclosing upgrade transaction is still private.
 * Reconciliation can add v1 rows before the gate is sealed, but schema-8 v2
 * rows can never acquire this exception. */
CREATE TABLE runtime_provider_delivery_legacy_provenance (
  delivery_id TEXT PRIMARY KEY REFERENCES runtime_provider_deliveries(delivery_id) DEFERRABLE INITIALLY DEFERRED,
  migration_id TEXT NOT NULL CHECK (migration_id = '008_r003_opaque_completion_receipts'),
  delivery_schema_version TEXT NOT NULL CHECK (delivery_schema_version = 'accord.runtime-provider-delivery/v1'),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number IN (1, 2)),
  response_id TEXT NOT NULL,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  wire_digest TEXT NOT NULL CHECK (length(wire_digest) = 64 AND wire_digest NOT GLOB '*[^0-9a-f]*'),
  redacted_envelope_json TEXT NOT NULL CHECK (json_valid(redacted_envelope_json)),
  replayable_response_json TEXT NOT NULL CHECK (json_valid(replayable_response_json)),
  trusted_received_at TEXT NOT NULL,
  physical_trusted_received_at TEXT NOT NULL,
  attempt_state_at_receipt TEXT NOT NULL CHECK (attempt_state_at_receipt IN ('RESULT_RECEIVED', 'DISCARDED', 'UNKNOWN', 'WINNER')),
  receipt_binding TEXT NOT NULL CHECK (length(receipt_binding) = 64 AND receipt_binding NOT GLOB '*[^0-9a-f]*'),
  original_attempt_state_at_receipt TEXT NOT NULL CHECK (original_attempt_state_at_receipt IN ('RUNNING', 'RESULT_RECEIVED', 'DISCARDED', 'UNKNOWN', 'WINNER')),
  original_receipt_state_binding TEXT NOT NULL CHECK (original_receipt_state_binding = '0000000000000000000000000000000000000000000000000000000000000000'),
  UNIQUE (attempt_id, delivery_number)
) STRICT;

CREATE TABLE runtime_provider_delivery_legacy_provenance_gate (
  gate_id TEXT PRIMARY KEY CHECK (gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'SEALED')),
  provenance_count INTEGER NOT NULL CHECK (provenance_count >= 0),
  provenance_set_binding TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
    CHECK (length(provenance_set_binding) = 64 AND provenance_set_binding NOT GLOB '*[^0-9a-f]*')
) STRICT;
INSERT INTO runtime_provider_delivery_legacy_provenance_gate (gate_id, state, provenance_count, provenance_set_binding)
  VALUES ('runtime_provider_delivery_legacy_provenance_gate_v1', 'OPEN', 0, '0000000000000000000000000000000000000000000000000000000000000000');

INSERT INTO runtime_provider_delivery_legacy_provenance (
  delivery_id, migration_id, delivery_schema_version, invocation_id, attempt_id, attempt_number, response_id,
  delivery_number, wire_digest, redacted_envelope_json, replayable_response_json,
  trusted_received_at, physical_trusted_received_at, attempt_state_at_receipt,
  receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding
)
SELECT delivery.delivery_id, '008_r003_opaque_completion_receipts', delivery.schema_version, delivery.invocation_id, delivery.attempt_id, attempt.attempt_number, delivery.response_id,
  delivery_number, wire_digest, redacted_envelope_json, replayable_response_json,
  trusted_received_at, physical_trusted_received_at, attempt_state_at_receipt,
  receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding
FROM runtime_provider_deliveries AS delivery
JOIN runtime_attempts AS attempt ON attempt.attempt_id = delivery.attempt_id AND attempt.invocation_id = delivery.invocation_id;

CREATE TRIGGER runtime_provider_delivery_legacy_provenance_immutable_update
BEFORE UPDATE ON runtime_provider_delivery_legacy_provenance
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance is immutable'); END;
CREATE TRIGGER runtime_provider_delivery_legacy_provenance_immutable_delete
BEFORE DELETE ON runtime_provider_delivery_legacy_provenance
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance is immutable'); END;
CREATE TRIGGER runtime_provider_delivery_legacy_provenance_insert_open
BEFORE INSERT ON runtime_provider_delivery_legacy_provenance
WHEN COALESCE((SELECT state FROM runtime_provider_delivery_legacy_provenance_gate WHERE gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'), '') <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance is sealed'); END;
CREATE TRIGGER runtime_provider_delivery_legacy_provenance_gate_no_delete
BEFORE DELETE ON runtime_provider_delivery_legacy_provenance_gate
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance gate is immutable'); END;
CREATE TRIGGER runtime_provider_delivery_legacy_provenance_gate_insert_once
BEFORE INSERT ON runtime_provider_delivery_legacy_provenance_gate
WHEN EXISTS (SELECT 1 FROM runtime_provider_delivery_legacy_provenance_gate)
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance gate already exists'); END;
CREATE TRIGGER runtime_provider_delivery_legacy_provenance_gate_transition
BEFORE UPDATE ON runtime_provider_delivery_legacy_provenance_gate
WHEN OLD.state <> 'OPEN' OR NEW.state <> 'SEALED'
  OR NEW.provenance_count <> (SELECT count(*) FROM runtime_provider_delivery_legacy_provenance)
BEGIN SELECT RAISE(ABORT, 'runtime provider delivery legacy provenance gate is immutable'); END;

/* New v2 receipts have an identity-bound opaque-receipt disposition.  v1 is
 * only a migration-time classification and can be inserted while its exact
 * provenance set is OPEN; the set is sealed before startup becomes visible. */
CREATE TRIGGER runtime_provider_deliveries_v1_provenance_window
BEFORE INSERT ON runtime_provider_deliveries
WHEN NEW.schema_version = 'accord.runtime-provider-delivery/v1'
  AND COALESCE((SELECT state FROM runtime_provider_delivery_legacy_provenance_gate WHERE gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'), '') <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'legacy runtime provider delivery provenance is sealed'); END;
CREATE TRIGGER runtime_provider_deliveries_v2_original_binding
BEFORE INSERT ON runtime_provider_deliveries
WHEN NEW.schema_version = 'accord.runtime-provider-delivery/v2'
  AND NEW.original_receipt_state_binding = '0000000000000000000000000000000000000000000000000000000000000000'
BEGIN SELECT RAISE(ABORT, 'current runtime provider delivery requires an original receipt binding'); END;
CREATE TABLE runtime_opaque_completion_receipts (
  opaque_receipt_id TEXT PRIMARY KEY CHECK (length(opaque_receipt_id) = 71 AND substr(opaque_receipt_id, 1, 7) = 'opaque_'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'accord.runtime-opaque-completion-receipt/v1'),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  wire_utf8 TEXT NOT NULL,
  wire_digest TEXT NOT NULL CHECK (length(wire_digest) = 64 AND wire_digest NOT GLOB '*[^0-9a-f]*'),
  trusted_received_at TEXT NOT NULL,
  attempt_state_at_receipt TEXT NOT NULL CHECK (attempt_state_at_receipt IN ('RUNNING', 'RESULT_RECEIVED', 'DISCARDED', 'UNKNOWN', 'WINNER')),
  receipt_binding TEXT NOT NULL CHECK (length(receipt_binding) = 64 AND receipt_binding NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (attempt_id, delivery_number),
  FOREIGN KEY (attempt_id, invocation_id) REFERENCES runtime_attempts(attempt_id, invocation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX idx_runtime_opaque_completion_receipts_attempt
  ON runtime_opaque_completion_receipts (attempt_id, delivery_number);

CREATE TRIGGER runtime_opaque_completion_receipts_immutable_update
BEFORE UPDATE ON runtime_opaque_completion_receipts
BEGIN SELECT RAISE(ABORT, 'runtime opaque completion receipts are immutable'); END;

/* An opaque wire may disappear only after its exact v2 Delivery exists. */
CREATE TRIGGER runtime_opaque_completion_receipts_guarded_delete
BEFORE DELETE ON runtime_opaque_completion_receipts
WHEN NOT EXISTS (
  SELECT 1
  FROM runtime_provider_deliveries AS delivery
  WHERE delivery.invocation_id = OLD.invocation_id
    AND delivery.attempt_id = OLD.attempt_id
    AND delivery.delivery_number = OLD.delivery_number
    AND delivery.wire_digest = OLD.wire_digest
    AND delivery.trusted_received_at = OLD.trusted_received_at
    AND delivery.original_attempt_state_at_receipt = OLD.attempt_state_at_receipt
)
BEGIN SELECT RAISE(ABORT, 'runtime opaque completion receipt requires its exact Delivery before consumption'); END;
