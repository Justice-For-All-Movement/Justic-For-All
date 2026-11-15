-- JFA-20: passkeys (WebAuthn), TOTP, recovery codes and per-session step-up.
BEGIN;
CREATE TABLE IF NOT EXISTS webauthn_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_id uuid NOT NULL REFERENCES identities(id),
 credential_id text NOT NULL UNIQUE CHECK(credential_id ~ '^[A-Za-z0-9_-]+$' AND char_length(credential_id) BETWEEN 16 AND 1400),
 public_key bytea NOT NULL CHECK(octet_length(public_key) BETWEEN 32 AND 2048),
 counter bigint NOT NULL DEFAULT 0 CHECK(counter>=0),
 transports text[] NOT NULL DEFAULT '{}',
 nickname text NOT NULL DEFAULT 'Passkey' CHECK(char_length(nickname) BETWEEN 1 AND 60 AND nickname !~ '[<>]'),
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webauthn_identity ON webauthn_credentials(identity_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS webauthn_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES auth_sessions(id),
 purpose text NOT NULL CHECK(purpose IN ('register','step_up')),
 challenge text NOT NULL UNIQUE CHECK(challenge ~ '^[A-Za-z0-9_-]{32,128}$'),
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at <= created_at + interval '5 minutes')
);
CREATE TABLE IF NOT EXISTS totp_factors (
 identity_id uuid PRIMARY KEY REFERENCES identities(id),
 secret_sealed bytea NOT NULL, key_ref text NOT NULL,
 confirmed_at timestamptz, last_step bigint, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_id uuid NOT NULL REFERENCES identities(id),
 code_digest bytea NOT NULL UNIQUE CHECK(octet_length(code_digest)=32),
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS step_up_at timestamptz;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS step_up_method text CHECK(step_up_method IS NULL OR step_up_method IN ('passkey','totp','recovery_code'));
INSERT INTO jfa_schema_migrations(version) VALUES ('0015_staff_mfa') ON CONFLICT(version) DO NOTHING;
COMMIT;
