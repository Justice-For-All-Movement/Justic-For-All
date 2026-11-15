-- JFA-28: chain links are computed by the database and cannot be forged.
BEGIN;
DO $$
DECLARE r record; v record; blocked boolean;
BEGIN
 INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result,previous_hash,event_hash)
  VALUES('synthetic','sql_test_event','test:1','allow',repeat('f',64),repeat('e',64)) RETURNING * INTO r;
 IF r.previous_hash=repeat('f',64) OR r.event_hash=repeat('e',64) OR r.seq IS NULL THEN RAISE EXCEPTION 'caller-supplied chain values accepted'; END IF;
 SELECT * INTO v FROM jfa_verify_audit_chain();
 IF NOT v.ok THEN RAISE EXCEPTION 'fresh chain does not verify'; END IF;
 blocked:=false; BEGIN UPDATE audit_events SET action='edited' WHERE event_id=r.event_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'audit row edited'; END IF;
 blocked:=false; BEGIN DELETE FROM audit_events WHERE event_id=r.event_id; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'audit row deleted'; END IF;
 blocked:=false; BEGIN TRUNCATE audit_events; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'audit truncated'; END IF;
 blocked:=false; BEGIN UPDATE audit_chain_head SET seq=0 WHERE id=1; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'chain head rewound'; END IF;
 blocked:=false; BEGIN INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('x','sql_test_event','person@example.org','allow'); EXCEPTION WHEN check_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'email address accepted in audit reference'; END IF;
 blocked:=false; BEGIN INSERT INTO audit_events(actor_ref,action,resource_ref,policy_result) VALUES('x','Free text story here','r','allow'); EXCEPTION WHEN check_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'free text accepted as audit action'; END IF;
END $$;
ROLLBACK;
