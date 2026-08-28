/*
 * v3 persisted result arrivals before physical Responses existed.  This gate
 * permits one exact response-link backfill inside the encompassing migration
 * transaction, then seals permanently before that transaction commits.
 */
CREATE TABLE runtime_legacy_reconciliation (
  reconciliation_id TEXT PRIMARY KEY CHECK (reconciliation_id = 'runtime_legacy_reconciliation_r003_v1'),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'SEALED')),
  sealed_at TEXT
) STRICT;

INSERT INTO runtime_legacy_reconciliation (reconciliation_id, state, sealed_at)
VALUES ('runtime_legacy_reconciliation_r003_v1', 'OPEN', NULL);

DROP TRIGGER runtime_result_arrivals_immutable_update;

CREATE TRIGGER runtime_result_arrivals_immutable_update
BEFORE UPDATE ON runtime_result_arrivals
WHEN NOT (
  OLD.response_id IS NULL
  AND NEW.response_id IS NOT NULL
  AND NEW.arrival_id = OLD.arrival_id
  AND NEW.schema_version = OLD.schema_version
  AND NEW.invocation_id = OLD.invocation_id
  AND NEW.attempt_id = OLD.attempt_id
  AND NEW.result_id IS OLD.result_id
  AND NEW.arrival_number = OLD.arrival_number
  AND NEW.outcome = OLD.outcome
  AND NEW.raw_response_json = OLD.raw_response_json
  AND NEW.raw_response_digest = OLD.raw_response_digest
  AND NEW.recorded_at = OLD.recorded_at
  AND EXISTS (
    SELECT 1 FROM runtime_legacy_reconciliation
    WHERE reconciliation_id = 'runtime_legacy_reconciliation_r003_v1' AND state = 'OPEN'
  )
)
BEGIN SELECT RAISE(ABORT, 'runtime result arrivals are immutable'); END;

CREATE TRIGGER runtime_legacy_reconciliation_immutable_update
BEFORE UPDATE ON runtime_legacy_reconciliation
WHEN NOT (
  OLD.reconciliation_id = 'runtime_legacy_reconciliation_r003_v1'
  AND OLD.state = 'OPEN'
  AND NEW.state = 'SEALED'
  AND NEW.sealed_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'runtime legacy reconciliation is immutable'); END;

CREATE TRIGGER runtime_legacy_reconciliation_no_delete
BEFORE DELETE ON runtime_legacy_reconciliation
BEGIN SELECT RAISE(ABORT, 'runtime legacy reconciliation is immutable'); END;
