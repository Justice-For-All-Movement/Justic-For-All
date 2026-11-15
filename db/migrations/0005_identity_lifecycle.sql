-- JFA-19: email-link sign-in, opaque sessions and account lifecycle.
-- Only digests of bearer secrets are stored. Email addresses are sealed
-- (AES-256-GCM in the application) and found by keyed HMAC lookup.
BEGIN;
ALTER TABLE contact_points ADD COLUMN IF NOT EXISTS lookup_hmac bytea CHECK(lookup_hmac IS NULL OR octet_length(lookup_hmac)=32);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_points_account_email ON contact_points(lookup_hmac)
 WHERE purpose='account_email' AND retention_state='active';

CREATE TABLE IF NOT EXISTS auth_sign_in_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 email_lookup bytea NOT NULL CHECK(octet_length(email_lookup)=32),
 email_sealed bytea NOT NULL CHECK(octet_length(email_sealed) BETWEEN 29 AND 400),
 key_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expiry ON auth_sign_in_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_id uuid NOT NULL REFERENCES identities(id),
 token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 idle_expires_at timestamptz NOT NULL,
 absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revoke_reason text CHECK(revoke_reason IN ('sign_out','sign_out_all','account_disabled','deletion_requested','admin')),
 CHECK(absolute_expires_at > created_at AND idle_expires_at <= absolute_expires_at),
 CHECK((revoked_at IS NULL)=(revoke_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_identity ON auth_sessions(identity_id) WHERE revoked_at IS NULL;

-- Throttle buckets are keyed HMACs (never raw emails or IP addresses).
CREATE TABLE IF NOT EXISTS auth_throttle_events (
 bucket bytea NOT NULL CHECK(octet_length(bucket)=32),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_throttle_bucket ON auth_throttle_events(bucket,occurred_at);

INSERT INTO jfa_schema_migrations(version) VALUES ('0005_identity_lifecycle') ON CONFLICT(version) DO NOTHING;
COMMIT;
