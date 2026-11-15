-- JFA-27: privacy request workflow with legal hold, append-only history and erasure tombstones.
BEGIN;
ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS outcome_code text CHECK(outcome_code IS NULL OR outcome_code ~ '^[a-z_]{3,60}$');
ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES identities(id);
ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS correction_note text CHECK(correction_note IS NULL OR char_length(correction_note)<=1000);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS erased_at timestamptz;
CREATE TABLE IF NOT EXISTS privacy_request_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES privacy_requests(id),
 status text NOT NULL,
 actor_ref text NOT NULL CHECK(actor_ref ~ '^(subject|staff:[0-9a-f-]{36})$'),
 note_code text CHECK(note_code IS NULL OR note_code ~ '^[a-z_]{3,60}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DROP TRIGGER IF EXISTS privacy_request_events_immutable ON privacy_request_events;
CREATE TRIGGER privacy_request_events_immutable BEFORE UPDATE OR DELETE ON privacy_request_events FOR EACH ROW EXECUTE FUNCTION jfa_forbid_history_rewrite();
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_requests_open ON privacy_requests(identity_id,request_type)
 WHERE status NOT IN ('completed','partially_completed','denied','closed');
INSERT INTO jfa_schema_migrations(version) VALUES ('0013_privacy_requests') ON CONFLICT(version) DO NOTHING;
COMMIT;
