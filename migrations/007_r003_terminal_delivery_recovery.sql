/*
 * A physical response names bounded wire bytes, not a completion delivery.
 * Keep an immutable receipt for every delivery so terminal Attempts can be
 * recovered after receipt and before its Arrival/audit transaction commits.
 */
CREATE TABLE runtime_provider_deliveries (
  delivery_id TEXT PRIMARY KEY CHECK (length(delivery_id) = 73 AND substr(delivery_id, 1, 9) = 'delivery_'),
  schema_version TEXT NOT NULL CHECK (schema_version IN ('accord.runtime-provider-delivery/v1', 'accord.runtime-provider-delivery/v2')),
  invocation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  wire_digest TEXT NOT NULL CHECK (length(wire_digest) = 64 AND wire_digest NOT GLOB '*[^0-9a-f]*'),
  redacted_envelope_json TEXT NOT NULL CHECK (json_valid(redacted_envelope_json)),
  replayable_response_json TEXT NOT NULL CHECK (json_valid(replayable_response_json)),
  trusted_received_at TEXT NOT NULL,
  physical_trusted_received_at TEXT NOT NULL,
  attempt_state_at_receipt TEXT NOT NULL CHECK (attempt_state_at_receipt IN ('RESULT_RECEIVED', 'DISCARDED', 'UNKNOWN', 'WINNER')),
  receipt_binding TEXT NOT NULL CHECK (length(receipt_binding) = 64 AND receipt_binding NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (attempt_id, delivery_number),
  FOREIGN KEY (response_id) REFERENCES runtime_physical_responses(response_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (attempt_id, invocation_id) REFERENCES runtime_attempts(attempt_id, invocation_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE runtime_delivery_arrivals (
  delivery_id TEXT PRIMARY KEY REFERENCES runtime_provider_deliveries(delivery_id) DEFERRABLE INITIALLY DEFERRED,
  arrival_id TEXT NOT NULL UNIQUE REFERENCES runtime_result_arrivals(arrival_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

/*
 * Existing v6 rows are reconciled in the enclosing startup transaction. SQL
 * cannot derive the canonical SHA-256 receipt binding, so no legacy delivery
 * is inserted until all of its physical, Arrival, and audit identities have
 * been validated together by the runtime authority.
 */

CREATE INDEX idx_runtime_provider_deliveries_attempt ON runtime_provider_deliveries (attempt_id, delivery_number);
CREATE INDEX idx_runtime_delivery_arrivals_arrival ON runtime_delivery_arrivals (arrival_id);

CREATE TRIGGER runtime_provider_deliveries_immutable_update
BEFORE UPDATE ON runtime_provider_deliveries
BEGIN SELECT RAISE(ABORT, 'runtime provider deliveries are immutable'); END;
CREATE TRIGGER runtime_provider_deliveries_immutable_delete
BEFORE DELETE ON runtime_provider_deliveries
BEGIN SELECT RAISE(ABORT, 'runtime provider deliveries are immutable'); END;
CREATE TRIGGER runtime_delivery_arrivals_immutable_update
BEFORE UPDATE ON runtime_delivery_arrivals
BEGIN SELECT RAISE(ABORT, 'runtime delivery arrivals are immutable'); END;
CREATE TRIGGER runtime_delivery_arrivals_immutable_delete
BEFORE DELETE ON runtime_delivery_arrivals
BEGIN SELECT RAISE(ABORT, 'runtime delivery arrivals are immutable'); END;
