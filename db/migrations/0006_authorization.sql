-- JFA-21: revocable, auditable role grants. Grants are never edited except
-- to record revocation; scopes are validated.
BEGIN;
ALTER TABLE role_grants ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE role_grants ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES identities(id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='role_grants_scope_format') THEN
  ALTER TABLE role_grants ADD CONSTRAINT role_grants_scope_format
   CHECK(resource_scope ~ '^(core|org:[a-z0-9-]{1,60}|source:[a-z0-9-]{1,60})$') NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='role_grants_revocation_pair') THEN
  ALTER TABLE role_grants ADD CONSTRAINT role_grants_revocation_pair CHECK((revoked_at IS NULL)=(revoked_by IS NULL));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_role_grants_active ON role_grants(subject_id) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION jfa_role_grant_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'role grants are revoked, never deleted'; END IF;
 IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked grant is final'; END IF;
 IF (NEW.id,NEW.subject_id,NEW.role,NEW.resource_scope,NEW.approved_by,NEW.expires_at,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.subject_id,OLD.role,OLD.resource_scope,OLD.approved_by,OLD.expires_at,OLD.created_at) THEN
  RAISE EXCEPTION 'role grant fields are immutable; revoke and grant again';
 END IF;
 IF NEW.revoked_by=NEW.subject_id THEN RAISE EXCEPTION 'subjects cannot revoke their own grants'; END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS role_grants_guard ON role_grants;
CREATE TRIGGER role_grants_guard BEFORE UPDATE OR DELETE ON role_grants FOR EACH ROW EXECUTE FUNCTION jfa_role_grant_guard();

-- Single source of truth for "is this grant usable now" used by every SQL check.
CREATE OR REPLACE VIEW core_active_grants AS
 SELECT g.subject_id,g.role,g.resource_scope FROM role_grants g
 JOIN identities i ON i.id=g.subject_id AND i.account_state='active'
 WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now());

INSERT INTO jfa_schema_migrations(version) VALUES ('0006_authorization') ON CONFLICT(version) DO NOTHING;
COMMIT;
