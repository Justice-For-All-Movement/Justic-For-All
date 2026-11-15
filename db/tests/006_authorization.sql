-- JFA-21: grants are revocable but otherwise immutable and never deleted.
BEGIN;
DO $$
DECLARE a uuid; b uuid; g uuid; blocked boolean;
BEGIN
 INSERT INTO identities DEFAULT VALUES RETURNING id INTO a;
 INSERT INTO identities DEFAULT VALUES RETURNING id INTO b;
 INSERT INTO role_grants(subject_id,role,resource_scope,approved_by) VALUES(b,'editor','core',a) RETURNING id INTO g;
 IF NOT EXISTS (SELECT 1 FROM core_active_grants WHERE subject_id=b AND role='editor') THEN RAISE EXCEPTION 'active grant missing'; END IF;
 blocked:=false; BEGIN UPDATE role_grants SET role='admin' WHERE id=g; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'grant escalation by update accepted'; END IF;
 blocked:=false; BEGIN DELETE FROM role_grants WHERE id=g; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'grant deletion accepted'; END IF;
 blocked:=false; BEGIN UPDATE role_grants SET revoked_at=now(),revoked_by=b WHERE id=g; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'self-revocation accepted'; END IF;
 blocked:=false; BEGIN INSERT INTO role_grants(subject_id,role,resource_scope) VALUES(b,'editor','core; DROP'); EXCEPTION WHEN check_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'malformed scope accepted'; END IF;
 UPDATE role_grants SET revoked_at=now(),revoked_by=a WHERE id=g;
 IF EXISTS (SELECT 1 FROM core_active_grants WHERE subject_id=b) THEN RAISE EXCEPTION 'revoked grant still active'; END IF;
 blocked:=false; BEGIN UPDATE role_grants SET revoked_at=NULL,revoked_by=NULL WHERE id=g; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'revoked grant reinstated'; END IF;
 UPDATE identities SET account_state='disabled' WHERE id=a;
 INSERT INTO role_grants(subject_id,role,resource_scope) VALUES(a,'admin','core');
 IF EXISTS (SELECT 1 FROM core_active_grants WHERE subject_id=a) THEN RAISE EXCEPTION 'disabled identity has active grant'; END IF;
END $$;
ROLLBACK;
