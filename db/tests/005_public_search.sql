-- JFA-17: drafts, withdrawn and superseded revisions never appear in search.
BEGIN;
DO $$
DECLARE author uuid; ra uuid; rb uuid; entry uuid; draft uuid; n int;
 doc jsonb := '{"schema_version":1,"entry_type":"article","slug":"synthetic-search","locale":"en","title":"Synthetic zebracorn article","summary":"Synthetic summary about records","blocks":[{"kind":"paragraph","runs":[{"text":"Quokkas explain public records requests.","emphasis":"normal"}]},{"kind":"list","items":["platypus list item"]}],"media":[]}';
BEGIN
 INSERT INTO identities DEFAULT VALUES RETURNING id INTO author;
 INSERT INTO identities DEFAULT VALUES RETURNING id INTO ra;
 INSERT INTO identities DEFAULT VALUES RETURNING id INTO rb;
 INSERT INTO cms_entries(entry_type,slug,locale,visibility,current_revision)
  VALUES('article','synthetic-search','en','private',1) RETURNING id INTO entry;
 INSERT INTO cms_revisions(entry_id,version,content,author_id,editorial_state,content_hash)
  VALUES(entry,1,doc,author,'draft',repeat('d',64)) RETURNING id INTO draft;
 SELECT count(*) INTO n FROM core_public_search WHERE search_vector @@ websearch_to_tsquery('english','zebracorn');
 IF n<>0 THEN RAISE EXCEPTION 'draft leaked into search'; END IF;

 INSERT INTO cms_review_workflows(entry_id,source_revision_id,state,row_version) VALUES(entry,draft,'approved',4);
 INSERT INTO publication_approvals(revision_id,approver_id,decision,reason_code) VALUES(draft,ra,'approve','t'),(draft,rb,'approve','t');
 INSERT INTO cms_revisions(entry_id,version,content,author_id,editorial_state,content_hash)
  VALUES(entry,2,doc,author,'published',repeat('d',64));
 UPDATE cms_review_workflows SET state='published',published_revision_id=(SELECT id FROM cms_revisions WHERE entry_id=entry AND version=2) WHERE entry_id=entry;
 UPDATE cms_entries SET visibility='public',current_revision=2 WHERE id=entry;
 SELECT count(*) INTO n FROM core_public_search WHERE search_vector @@ websearch_to_tsquery('english','quokka');
 IF n<>1 THEN RAISE EXCEPTION 'published body text not searchable (stemming)'; END IF;
 SELECT count(*) INTO n FROM core_public_search WHERE search_vector @@ websearch_to_tsquery('english','platypus');
 IF n<>1 THEN RAISE EXCEPTION 'list items not searchable'; END IF;

 UPDATE cms_entries SET visibility='withdrawn' WHERE id=entry;
 SELECT count(*) INTO n FROM core_public_search WHERE search_vector @@ websearch_to_tsquery('english','zebracorn');
 IF n<>0 THEN RAISE EXCEPTION 'withdrawn content still searchable'; END IF;
END $$;
ROLLBACK;
