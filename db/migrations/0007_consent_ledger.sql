-- JFA-23: append-only, per-purpose, per-version consent ledger.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='consent_records_subject_format') THEN
  ALTER TABLE consent_records ADD CONSTRAINT consent_records_subject_format
   CHECK(subject_ref ~ '^identity:[0-9a-f-]{36}$') NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='consent_records_purpose_format') THEN
  ALTER TABLE consent_records ADD CONSTRAINT consent_records_purpose_format
   CHECK(purpose ~ '^[a-z][a-z0-9_]{2,60}$' AND policy_version ~ '^\d{4}-\d{2}-\d{2}$' AND scope ~ '^[a-z][a-z0-9_:.-]{1,80}$') NOT VALID;
 END IF;
END $$;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'account_settings'
 CHECK(channel IN ('account_settings','signup_flow'));
-- TRUNCATE bypasses row triggers; forbid it explicitly for the ledgers.
CREATE OR REPLACE FUNCTION jfa_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'append-only table cannot be truncated: %',TG_TABLE_NAME; END $fn$;
DROP TRIGGER IF EXISTS consent_records_no_truncate ON consent_records;
CREATE TRIGGER consent_records_no_truncate BEFORE TRUNCATE ON consent_records FOR EACH STATEMENT EXECUTE FUNCTION jfa_forbid_truncate();
CREATE OR REPLACE VIEW core_current_consent AS
 SELECT DISTINCT ON (subject_ref,purpose) subject_ref,purpose,scope,policy_version,decision,recorded_at,id
 FROM consent_records ORDER BY subject_ref,purpose,recorded_at DESC,id DESC;
INSERT INTO jfa_schema_migrations(version) VALUES ('0007_consent_ledger') ON CONFLICT(version) DO NOTHING;
COMMIT;
