-- JFA-17: approved-only public full-text search.
-- Search reads published revisions directly; there is no copied search table to
-- fall out of sync, so withdrawal removes results in the same transaction.
BEGIN;
-- Public text of a validated editorial document (title, summary, block text).
-- Control characters are stripped so \x02/\x03 can safely delimit highlights.
CREATE OR REPLACE FUNCTION jfa_public_body_text(doc jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
 SELECT regexp_replace(coalesce((
   SELECT string_agg(t #>> '{}', ' ')
   FROM jsonb_path_query(doc, '$.blocks[*].runs[*].text') AS t
  ), '') || ' ' || coalesce((
   SELECT string_agg(t #>> '{}', ' ')
   FROM jsonb_path_query(doc, '$.blocks[*].items[*]') AS t
  ), ''), '[\x01-\x08]', '', 'g')
$fn$;
CREATE OR REPLACE FUNCTION jfa_public_search_vector(doc jsonb) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
 SELECT setweight(to_tsvector('english'::regconfig, coalesce(doc->>'title','')), 'A')
     || setweight(to_tsvector('english'::regconfig, coalesce(doc->>'summary','')), 'B')
     || setweight(to_tsvector('english'::regconfig, jfa_public_body_text(doc)), 'C')
$fn$;
-- Only published revisions are indexed; drafts never enter the index.
CREATE INDEX IF NOT EXISTS idx_cms_revisions_public_search ON cms_revisions
 USING gin (jfa_public_search_vector(content)) WHERE editorial_state='published';
-- Safe public search surface: current, public, two-person-approved revisions only.
CREATE OR REPLACE VIEW core_public_search AS
 SELECT e.slug, e.locale, e.entry_type, r.version, r.created_at AS published_at,
  r.content->>'title' AS title, r.content->>'summary' AS summary,
  jfa_public_body_text(r.content) AS body_text,
  jfa_public_search_vector(r.content) AS search_vector
 FROM cms_entries e
 JOIN cms_revisions r ON r.entry_id=e.id AND r.version=e.current_revision
 JOIN cms_review_workflows w ON w.entry_id=e.id AND w.published_revision_id=r.id AND w.state='published'
 WHERE e.visibility='public' AND r.editorial_state='published';
INSERT INTO jfa_schema_migrations(version) VALUES ('0004_public_search') ON CONFLICT(version) DO NOTHING;
COMMIT;
