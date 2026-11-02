-- Fast lookup for /repo/[owner]/[repo] and catalog search.
-- pg_trgm is available on Supabase; skip silently if not.

CREATE INDEX IF NOT EXISTS idx_repositories_owner_repo_lower
  ON repositories (lower(owner), lower(repo_name));

CREATE INDEX IF NOT EXISTS idx_mentions_repo_posted
  ON telegram_repo_mentions (repository_id);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END
$$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_repositories_full_name_trgm
    ON repositories USING gin (full_name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_repositories_description_trgm
    ON repositories USING gin (description gin_trgm_ops);
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN insufficient_privilege THEN
    NULL;
END
$$;
