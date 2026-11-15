-- JFA-30: idempotent signed-event inbox and leased, bounded outbox delivery.
BEGIN;
CREATE TABLE IF NOT EXISTS inbox_events (
 event_id uuid PRIMARY KEY,
 source_service text NOT NULL CHECK(source_service ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 key_id text NOT NULL,
 event_type text NOT NULL,
 schema_version text NOT NULL,
 source_resource_id text NOT NULL,
 projection_version text NOT NULL,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 public_payload jsonb NOT NULL CHECK(jsonb_typeof(public_payload)='object' AND pg_column_size(public_payload) < 20000),
 processing_state text NOT NULL DEFAULT 'accepted' CHECK(processing_state IN ('accepted','applied','superseded','failed'))
);
CREATE INDEX IF NOT EXISTS idx_inbox_resource ON inbox_events(source_service,source_resource_id,occurred_at DESC);

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error text CHECK(last_error IS NULL OR last_error ~ '^[a-z0-9_]{1,60}$');
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox_events(next_attempt_at NULLS FIRST,created_at) WHERE delivery_state IN ('pending','failed','delivering');
INSERT INTO jfa_schema_migrations(version) VALUES ('0010_integration_inbox_outbox') ON CONFLICT(version) DO NOTHING;
COMMIT;
