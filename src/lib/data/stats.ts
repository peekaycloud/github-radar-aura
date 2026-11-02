import { sql } from "@/lib/db";
import { cacheReadModel, toPlain } from "@/lib/data/cache";

export type IntelligenceStats = {
  total_repositories: number;
  discoveries_this_month: number;
  discoveries_this_week: number;
  fast_growers: number;
  hidden_gems: number;
  median_discovery_age_days: number | null;
  crossed_1k_this_week: number;
};

export async function getIntelligenceStats(): Promise<IntelligenceStats> {
  "use cache";
  cacheReadModel("stats", "hours");
  const rows = await sql<IntelligenceStats[]>`
    SELECT
      (SELECT COUNT(*)::int FROM repositories) AS total_repositories,
      (
        SELECT COUNT(*)::int
        FROM mv_repository_discovery
        WHERE first_discovered_at >= NOW() - INTERVAL '30 days'
      ) AS discoveries_this_month,
      (
        SELECT COUNT(*)::int
        FROM mv_repository_discovery
        WHERE first_discovered_at >= NOW() - INTERVAL '7 days'
      ) AS discoveries_this_week,
      (
        SELECT COUNT(*)::int
        FROM mv_repo_snapshot_stats
        WHERE snapshot_count >= 2
          AND stars_delta >= 20
      ) AS fast_growers,
      (
        SELECT COUNT(*)::int
        FROM repositories r
        JOIN mv_repository_discovery disc ON disc.repository_id = r.id
        WHERE COALESCE(r.stars, 0) BETWEEN 20 AND 1999
          AND COALESCE(r.is_fork, FALSE) = FALSE
          AND COALESCE(r.is_archived, FALSE) = FALSE
          AND disc.first_discovered_at >= NOW() - INTERVAL '45 days'
      ) AS hidden_gems,
      (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_discovery)::float
        FROM mv_repository_discovery
        WHERE days_to_discovery IS NOT NULL AND days_to_discovery >= 0
      ) AS median_discovery_age_days,
      0 AS crossed_1k_this_week
  `;
  return toPlain(
    rows[0] ?? {
      total_repositories: 0,
      discoveries_this_month: 0,
      discoveries_this_week: 0,
      fast_growers: 0,
      hidden_gems: 0,
      median_discovery_age_days: null,
      crossed_1k_this_week: 0,
    }
  );
}

export type CommunityStats = {
  total_repositories: number;
  total_telegram_posts: number;
  total_mentions: number;
  total_categories: number;
  avg_stars: number;
  new_discoveries_this_week: number;
  repositories_enriched: number;
};

export async function getCommunityStats(): Promise<CommunityStats> {
  "use cache";
  cacheReadModel("stats", "hours");
  const rows = await sql<CommunityStats[]>`
    SELECT
      (SELECT COUNT(*)::int FROM repositories) AS total_repositories,
      (SELECT COUNT(*)::int FROM telegram_posts) AS total_telegram_posts,
      (SELECT COUNT(*)::int FROM telegram_repo_mentions) AS total_mentions,
      (SELECT COUNT(*)::int FROM categories) AS total_categories,
      (SELECT COALESCE(AVG(stars), 0)::float FROM repositories WHERE stars IS NOT NULL) AS avg_stars,
      (
        SELECT COUNT(*)::int
        FROM mv_repository_discovery
        WHERE first_discovered_at >= NOW() - INTERVAL '7 days'
      ) AS new_discoveries_this_week,
      (
        SELECT COUNT(*)::int FROM repositories WHERE enrichment_status = 'success'
      ) AS repositories_enriched
  `;
  return toPlain(
    rows[0] ?? {
      total_repositories: 0,
      total_telegram_posts: 0,
      total_mentions: 0,
      total_categories: 0,
      avg_stars: 0,
      new_discoveries_this_week: 0,
      repositories_enriched: 0,
    }
  );
}

export async function getLanguages() {
  "use cache";
  cacheReadModel("stats", "hours");
  return toPlain(
    await sql<{ language: string; count: number }[]>`
      SELECT language, COUNT(*)::int AS count
      FROM repositories
      WHERE language IS NOT NULL AND language <> ''
      GROUP BY language
      ORDER BY count DESC
      LIMIT 40
    `
  );
}

export async function getCategories() {
  "use cache";
  cacheReadModel("stats", "hours");
  return toPlain(
    await sql<{ slug: string; name: string; count: number }[]>`
      SELECT c.slug, c.name, COUNT(rc.repository_id)::int AS count
      FROM categories c
      LEFT JOIN repository_categories rc ON rc.category_id = c.id
      GROUP BY c.slug, c.name
      ORDER BY count DESC, c.name
    `
  );
}

export async function getTopOwners(limit = 20) {
  "use cache";
  cacheReadModel("stats", "hours");
  return toPlain(
    await sql<{ owner: string; repo_count: number; total_stars: number }[]>`
      SELECT
        owner,
        COUNT(*)::int AS repo_count,
        SUM(COALESCE(stars, 0))::bigint AS total_stars
      FROM repositories
      WHERE owner IS NOT NULL
      GROUP BY owner
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `
  );
}
