-- JFA-23: the consent ledger is append-only (no update, delete or truncate).
BEGIN;
DO $$
DECLARE s text := 'identity:'||gen_random_uuid()::text; c uuid; blocked boolean;
BEGIN
 INSERT INTO consent_records(subject_ref,purpose,scope,policy_version,decision) VALUES(s,'news_email','core.news_email','2026-11-15','grant') RETURNING id INTO c;
 blocked:=false; BEGIN UPDATE consent_records SET decision='withdraw' WHERE id=c; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'consent rewritten'; END IF;
 blocked:=false; BEGIN DELETE FROM consent_records WHERE id=c; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'consent deleted'; END IF;
 blocked:=false; BEGIN TRUNCATE consent_records; EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'consent ledger truncated'; END IF;
 blocked:=false; BEGIN INSERT INTO consent_records(subject_ref,purpose,scope,policy_version,decision) VALUES('someone@example.org','news_email','core.news_email','2026-11-15','grant'); EXCEPTION WHEN check_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'raw personal identifier accepted as subject'; END IF;
 INSERT INTO consent_records(subject_ref,purpose,scope,policy_version,decision,supersedes_id) VALUES(s,'news_email','core.news_email','2026-11-15','withdraw',c);
 IF (SELECT decision FROM core_current_consent WHERE subject_ref=s AND purpose='news_email')<>'withdraw' THEN RAISE EXCEPTION 'current view wrong'; END IF;
END $$;
ROLLBACK;
