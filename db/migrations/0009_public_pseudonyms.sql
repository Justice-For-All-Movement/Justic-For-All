-- JFA-22: optional public pseudonyms, unique (case-insensitive) among public profiles.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_display_name_shape') THEN
  ALTER TABLE profiles ADD CONSTRAINT profiles_display_name_shape CHECK(
   public_display_name IS NULL OR (char_length(public_display_name) BETWEEN 3 AND 40 AND public_display_name !~ '[@<>]')) NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_public_needs_name') THEN
  ALTER TABLE profiles ADD CONSTRAINT profiles_public_needs_name CHECK(visibility='private' OR public_display_name IS NOT NULL) NOT VALID;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_name ON profiles(lower(public_display_name)) WHERE visibility='public';
INSERT INTO jfa_schema_migrations(version) VALUES ('0009_public_pseudonyms') ON CONFLICT(version) DO NOTHING;
COMMIT;
