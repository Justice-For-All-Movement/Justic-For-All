-- JFA-28: tamper-evident, append-only audit chain.
-- Every new audit_events row gets a gap-free sequence number and
--   event_hash = sha256(canonical(seq, previous_hash, event_id, actor_ref,
--                                 action, resource_ref, policy_result, occurred_at))
-- computed by the database, so callers cannot forge or skip links.
-- Rows written before this migration have seq NULL and are reported as pre-chain.
BEGIN;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS seq bigint UNIQUE;
CREATE TABLE IF NOT EXISTS audit_chain_head (
 id smallint PRIMARY KEY CHECK(id=1),
 seq bigint NOT NULL CHECK(seq>=0),
 last_hash text NOT NULL CHECK(last_hash ~ '^[a-f0-9]{64}$')
);
INSERT INTO audit_chain_head(id,seq,last_hash) VALUES(1,0,repeat('0',64)) ON CONFLICT(id) DO NOTHING;

-- Length-prefixed fields make the encoding unambiguous.
CREATE OR REPLACE FUNCTION jfa_audit_canonical(seq bigint, prev text, event_id uuid, actor text, action text, resource text, result text, at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT string_agg(length(v)::text||':'||v, '|' ORDER BY ord) FROM unnest(ARRAY[
  seq::text, prev, event_id::text, coalesce(actor,''), action, coalesce(resource,''), result,
  to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')]) WITH ORDINALITY AS t(v,ord)
$fn$;

CREATE OR REPLACE FUNCTION jfa_audit_chain_link() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE head audit_chain_head%ROWTYPE;
BEGIN
 SELECT * INTO head FROM audit_chain_head WHERE id=1 FOR UPDATE;
 NEW.seq := head.seq+1;
 NEW.previous_hash := head.last_hash;
 NEW.occurred_at := date_trunc('microseconds', coalesce(NEW.occurred_at, now()));
 NEW.event_hash := encode(sha256(convert_to(jfa_audit_canonical(NEW.seq,NEW.previous_hash,NEW.event_id,NEW.actor_ref,NEW.action,NEW.resource_ref,NEW.policy_result,NEW.occurred_at),'UTF8')),'hex');
 UPDATE audit_chain_head SET seq=NEW.seq,last_hash=NEW.event_hash WHERE id=1;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS audit_events_chain ON audit_events;
CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION jfa_audit_chain_link();
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION jfa_forbid_truncate();
-- The head may only move forward through the chaining trigger.
CREATE OR REPLACE FUNCTION jfa_audit_head_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.seq<>OLD.seq+1 THEN RAISE EXCEPTION 'audit chain head can only advance by one'; END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS audit_chain_head_guard ON audit_chain_head;
CREATE TRIGGER audit_chain_head_guard BEFORE UPDATE OR DELETE ON audit_chain_head FOR EACH ROW EXECUTE FUNCTION jfa_audit_head_guard();

-- Privacy-safe references: opaque IDs only, never email addresses or free text.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_events_privacy_safe') THEN
  ALTER TABLE audit_events ADD CONSTRAINT audit_events_privacy_safe CHECK(
   coalesce(actor_ref,'') !~ '[@\s]' AND coalesce(resource_ref,'') !~ '[@\s]' AND action ~ '^[a-z][a-z0-9_.:]{2,80}$'
   AND length(coalesce(actor_ref,''))<=120 AND length(coalesce(resource_ref,''))<=200) NOT VALID;
 END IF;
END $$;

-- Recomputes every chained link; returns the first broken sequence number, if any.
CREATE OR REPLACE FUNCTION jfa_verify_audit_chain() RETURNS TABLE(ok boolean, checked bigint, first_bad_seq bigint, head_seq bigint, head_hash text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE r record; prev text := repeat('0',64); expected_seq bigint := 1; n bigint := 0; bad bigint := NULL;
BEGIN
 FOR r IN SELECT * FROM audit_events WHERE seq IS NOT NULL ORDER BY seq LOOP
  n := n+1;
  IF bad IS NULL AND (r.seq<>expected_seq OR r.previous_hash IS DISTINCT FROM prev OR r.event_hash IS DISTINCT FROM
     encode(sha256(convert_to(jfa_audit_canonical(r.seq,r.previous_hash,r.event_id,r.actor_ref,r.action,r.resource_ref,r.policy_result,r.occurred_at),'UTF8')),'hex')) THEN
   bad := r.seq;
  END IF;
  prev := r.event_hash; expected_seq := r.seq+1;
 END LOOP;
 RETURN QUERY SELECT bad IS NULL AND h.seq=n AND h.last_hash=prev, n, bad, h.seq, h.last_hash FROM audit_chain_head h WHERE h.id=1;
END $fn$;
INSERT INTO jfa_schema_migrations(version) VALUES ('0008_audit_chain') ON CONFLICT(version) DO NOTHING;
COMMIT;
