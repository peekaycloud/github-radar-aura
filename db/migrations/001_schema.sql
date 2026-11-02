-- GitHub Radar — core schema
-- Idempotent where practical (IF NOT EXISTS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- telegram_posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_posts (
  id BIGSERIAL PRIMARY KEY,
  telegram_message_id BIGINT NOT NULL UNIQUE,
  posted_at TIMESTAMPTZ NOT NULL,
  text TEXT,
  source_channel TEXT,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_posts_posted_at
  ON telegram_posts (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_posts_message_id
  ON telegram_posts (telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_telegram_posts_source_channel
  ON telegram_posts (source_channel);

-- ---------------------------------------------------------------------------
-- repositories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_url TEXT NOT NULL UNIQUE,
  owner TEXT,
  repo_name TEXT,
  full_name TEXT UNIQUE,
  description TEXT,
  homepage TEXT,
  language TEXT,
  license TEXT,
  stars BIGINT,
  forks BIGINT,
  open_issues BIGINT,
  watchers BIGINT,
  contributors_count BIGINT,
  size_kb BIGINT,
  default_branch TEXT,
  is_fork BOOLEAN,
  is_archived BOOLEAN,
  created_at_github TIMESTAMPTZ,
  updated_at_github TIMESTAMPTZ,
  pushed_at_github TIMESTAMPTZ,
  last_enriched_at TIMESTAMPTZ,
  enrichment_status TEXT DEFAULT 'pending',
  enrichment_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repositories_full_name ON repositories (full_name);
CREATE INDEX IF NOT EXISTS idx_repositories_github_url ON repositories (github_url);
CREATE INDEX IF NOT EXISTS idx_repositories_stars ON repositories (stars DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_repositories_language ON repositories (language);
CREATE INDEX IF NOT EXISTS idx_repositories_owner ON repositories (owner);
CREATE INDEX IF NOT EXISTS idx_repositories_enrichment
  ON repositories (enrichment_status, last_enriched_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_repositories_created_github
  ON repositories (created_at_github);

-- ---------------------------------------------------------------------------
-- telegram_repo_mentions (many-to-many)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_repo_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_post_id BIGINT NOT NULL REFERENCES telegram_posts (id) ON DELETE CASCADE,
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  discovered_at TIMESTAMPTZ,
  UNIQUE (telegram_post_id, repository_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_repository
  ON telegram_repo_mentions (repository_id);
CREATE INDEX IF NOT EXISTS idx_mentions_post
  ON telegram_repo_mentions (telegram_post_id);
CREATE INDEX IF NOT EXISTS idx_mentions_discovered_at
  ON telegram_repo_mentions (discovered_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- github_repo_snapshots (historical stats — never overwrite)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS github_repo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stars BIGINT,
  forks BIGINT,
  watchers BIGINT,
  open_issues BIGINT,
  contributors_count BIGINT,
  pushed_at_github TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_snapshots_repo_captured
  ON github_repo_snapshots (repository_id, captured_at DESC);

-- ---------------------------------------------------------------------------
-- ingestion_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  messages_scanned BIGINT DEFAULT 0,
  new_messages BIGINT DEFAULT 0,
  github_urls_found BIGINT DEFAULT 0,
  new_repositories BIGINT DEFAULT 0,
  repositories_enriched BIGINT DEFAULT 0,
  errors BIGINT DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started
  ON ingestion_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- ingestion_state (delta cursor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_state (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL UNIQUE,
  last_telegram_message_id BIGINT,
  last_posted_at TIMESTAMPTZ,
  last_successful_run_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- categories (normalized)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repository_categories (
  repository_id UUID NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (repository_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_categories_category
  ON repository_categories (category_id);

-- Seed categories
INSERT INTO categories (slug, name) VALUES
  ('ai', 'AI'),
  ('ai-agents', 'AI Agents'),
  ('llm', 'LLM'),
  ('rag', 'RAG'),
  ('mcp', 'MCP'),
  ('developer-tools', 'Developer Tools'),
  ('coding-tools', 'Coding Tools'),
  ('databases', 'Databases'),
  ('devops', 'DevOps'),
  ('security', 'Security'),
  ('productivity', 'Productivity'),
  ('web-development', 'Web Development'),
  ('mobile', 'Mobile'),
  ('data-engineering', 'Data Engineering'),
  ('machine-learning', 'Machine Learning'),
  ('computer-vision', 'Computer Vision'),
  ('robotics', 'Robotics'),
  ('infrastructure', 'Infrastructure'),
  ('open-source', 'Open Source'),
  ('other', 'Other')
ON CONFLICT (slug) DO NOTHING;

-- updated_at trigger for repositories
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repositories_updated_at ON repositories;
CREATE TRIGGER trg_repositories_updated_at
  BEFORE UPDATE ON repositories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
