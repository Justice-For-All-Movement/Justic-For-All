-- JFA-24: double opt-in subscriptions, suppression list, idempotent campaign delivery.
BEGIN;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS unsubscribe_digest bytea UNIQUE CHECK(unsubscribe_digest IS NULL OR octet_length(unsubscribe_digest)=32);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS confirm_expires_at timestamptz;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_topic_allowed') THEN
  ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_topic_allowed CHECK(topic IN ('news')) NOT VALID;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_live ON subscriptions(contact_point_id,topic)
 WHERE confirmation_state IN ('pending_verification','active');

-- Keyed HMAC of the address (same key as account lookup): never the address itself.
CREATE TABLE IF NOT EXISTS email_suppressions (
 lookup_hmac bytea PRIMARY KEY CHECK(octet_length(lookup_hmac)=32),
 reason text NOT NULL CHECK(reason IN ('unsubscribed','bounced','complained','manual')),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 topic text NOT NULL CHECK(topic IN ('news')),
 subject text NOT NULL CHECK(char_length(subject) BETWEEN 5 AND 120 AND subject !~ '[<>\r\n]'),
 body_text text NOT NULL CHECK(char_length(body_text) BETWEEN 20 AND 5000 AND body_text !~ '[<>]'),
 created_by uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES notification_campaigns(id),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','dead','skipped')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz, lease_expires_at timestamptz,
 provider_message_id text, last_error text CHECK(last_error IS NULL OR last_error ~ '^[a-z0-9_]{1,60}$'),
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(campaign_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_due ON notification_deliveries(state,next_attempt_at) WHERE state IN ('pending','failed','sending');
INSERT INTO jfa_schema_migrations(version) VALUES ('0011_subscriptions') ON CONFLICT(version) DO NOTHING;
COMMIT;
