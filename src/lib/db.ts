import postgres from "postgres";

const globalForDb = globalThis as unknown as {
  sql: ReturnType<typeof postgres> | undefined;
};

function createSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  // Supabase pooler: disable prepared statements (required for transaction mode).
  // Small pool for Vercel serverless; prefer session pooler :5432 when possible.
  return postgres(url, {
    ssl: "require",
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: {
      statement_timeout: 12000,
    },
  });
}

export const sql = globalForDb.sql ?? createSql();
globalForDb.sql = sql;

export type Repository = {
  id: string;
  github_url: string;
  owner: string | null;
  repo_name: string | null;
  full_name: string | null;
  description: string | null;
  homepage: string | null;
  language: string | null;
  license: string | null;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  watchers: number | null;
  is_fork: boolean | null;
  is_archived: boolean | null;
  created_at_github: string | null;
  pushed_at_github: string | null;
  last_enriched_at: string | null;
  enrichment_status: string | null;
};

export type DiscoveryRow = Repository & {
  repository_id: string;
  first_discovered_at: string | null;
  last_mentioned_at: string | null;
  mention_count: number;
  days_to_discovery: number | null;
  discovery_age_days: number | null;
  discovery_score?: number | null;
  stars_gained_1d?: number | null;
  stars_gained_7d?: number | null;
  stars_gained_30d?: number | null;
  stars_at_discovery?: number | null;
  current_stars?: number | null;
  baseline_stars?: number | null;
  baseline_captured_at?: string | null;
  growth_multiple?: number | null;
  growth_pct?: number | null;
  ahead_score?: number | null;
  gem_score?: number | null;
  stars_pct_growth_7d?: number | null;
  stars_pct_growth_30d?: number | null;
  stars_pct_growth_observed?: number | null;
  categories?: { slug: string; name: string }[];
};
