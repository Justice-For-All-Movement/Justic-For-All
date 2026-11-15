-- Fix: verification under concurrent writers. Read the head first, then verify
-- only rows up to that sequence. Rows <= head.seq were committed together with
-- the head update, so they are visible to the later row scan even in READ
-- COMMITTED; rows appended meanwhile are ignored instead of reported as breaks.
BEGIN;
CREATE OR REPLACE FUNCTION jfa_verify_audit_chain() RETURNS TABLE(ok boolean, checked bigint, first_bad_seq bigint, head_seq bigint, head_hash text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE r record; h audit_chain_head%ROWTYPE; prev text := repeat('0',64); expected_seq bigint := 1; n bigint := 0; bad bigint := NULL;
BEGIN
 SELECT * INTO h FROM audit_chain_head WHERE id=1;
 FOR r IN SELECT * FROM audit_events WHERE seq IS NOT NULL AND seq <= h.seq ORDER BY seq LOOP
  n := n+1;
  IF bad IS NULL AND (r.seq<>expected_seq OR r.previous_hash IS DISTINCT FROM prev OR r.event_hash IS DISTINCT FROM
     encode(sha256(convert_to(jfa_audit_canonical(r.seq,r.previous_hash,r.event_id,r.actor_ref,r.action,r.resource_ref,r.policy_result,r.occurred_at),'UTF8')),'hex')) THEN
   bad := r.seq;
  END IF;
  prev := r.event_hash; expected_seq := r.seq+1;
 END LOOP;
 IF bad IS NULL AND n<>h.seq THEN bad := expected_seq; END IF;
 RETURN QUERY SELECT bad IS NULL AND prev=h.last_hash, n, bad, h.seq, h.last_hash;
END $fn$;
INSERT INTO jfa_schema_migrations(version) VALUES ('0014_audit_verify_snapshot') ON CONFLICT(version) DO NOTHING;
COMMIT;
