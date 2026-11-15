-- JFA-26: content reports, temporary moderation holds, immutable actions and appeals.
BEGIN;
ALTER TABLE cms_entries ADD COLUMN IF NOT EXISTS moderation_hold boolean NOT NULL DEFAULT false;

-- Public surfaces exclude held content (same columns as before).
CREATE OR REPLACE VIEW core_public_content AS
  SELECT e.slug,e.locale,e.entry_type,r.version,
    r.content->>'title' AS title,r.content->>'summary' AS summary
  FROM cms_entries e JOIN cms_revisions r
    ON r.entry_id=e.id AND r.version=e.current_revision
  WHERE e.visibility='public' AND r.editorial_state='published' AND NOT e.moderation_hold;
CREATE OR REPLACE VIEW core_public_search AS
 SELECT e.slug, e.locale, e.entry_type, r.version, r.created_at AS published_at,
  r.content->>'title' AS title, r.content->>'summary' AS summary,
  jfa_public_body_text(r.content) AS body_text,
  jfa_public_search_vector(r.content) AS search_vector
 FROM cms_entries e
 JOIN cms_revisions r ON r.entry_id=e.id AND r.version=e.current_revision
 JOIN cms_review_workflows w ON w.entry_id=e.id AND w.published_revision_id=r.id AND w.state='published'
 WHERE e.visibility='public' AND r.editorial_state='published' AND NOT e.moderation_hold;

ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS entry_id uuid REFERENCES cms_entries(id);
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS details text CHECK(details IS NULL OR char_length(details)<=1000);
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS receipt_digest bytea UNIQUE CHECK(receipt_digest IS NULL OR octet_length(receipt_digest)=32);
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT '2026-11-15';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='content_reports_reason_allowed') THEN
  ALTER TABLE content_reports ADD CONSTRAINT content_reports_reason_allowed CHECK(reason_category IN
   ('privacy_exposure','harassment_or_threat','inaccurate','copyright','safety_risk','other')) NOT VALID;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS moderation_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 action_id uuid NOT NULL REFERENCES moderation_actions(id),
 appellant_id uuid NOT NULL REFERENCES identities(id),
 statement text NOT NULL CHECK(char_length(statement) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','upheld','overturned')),
 decided_by uuid REFERENCES identities(id),
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='received')=(decided_by IS NULL)),
 UNIQUE(action_id,appellant_id)
);

DROP TRIGGER IF EXISTS moderation_actions_immutable ON moderation_actions;
CREATE TRIGGER moderation_actions_immutable BEFORE UPDATE OR DELETE ON moderation_actions
 FOR EACH ROW EXECUTE FUNCTION jfa_forbid_history_rewrite();
INSERT INTO jfa_schema_migrations(version) VALUES ('0012_moderation') ON CONFLICT(version) DO NOTHING;
COMMIT;
