import { sql, type DiscoveryRow } from "@/lib/db";
import { cacheReadModel, toPlain } from "@/lib/data/cache";
import {
  discoveryJoin,
  discoverySelect,
  repositorySelect,
} from "@/lib/data/sql";

export async function getTodaysRadar(limit = 12): Promise<DiscoveryRow[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  const rows = await sql<DiscoveryRow[]>`
    SELECT
      ${repositorySelect},
      ${discoverySelect},
      snap.pct_growth_observed AS stars_pct_growth_observed
    FROM mv_repository_discovery disc
    JOIN repositories r ON r.id = disc.repository_id
    LEFT JOIN mv_repo_snapshot_stats snap ON snap.repository_id = r.id
    WHERE disc.first_discovered_at IS NOT NULL
    ORDER BY disc.first_discovered_at DESC NULLS LAST
    LIMIT ${limit}
  `;
  return toPlain(await attachCategories(rows));
}

export type FastMover = DiscoveryRow & {
  pct_growth_observed: number;
};

export async function getFastestMoving(limit = 5): Promise<FastMover[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  const rows = await sql<FastMover[]>`
    SELECT
      ${repositorySelect},
      ${discoverySelect},
      snap.pct_growth_observed
    FROM mv_repo_snapshot_stats snap
    JOIN repositories r ON r.id = snap.repository_id
    ${discoveryJoin}
    WHERE snap.snapshot_count >= 2
      AND snap.pct_growth_observed >= 1
      AND (snap.last_captured_at - snap.first_captured_at) >= INTERVAL '12 hours'
    ORDER BY snap.pct_growth_observed DESC
    LIMIT ${limit}
  `;
  return toPlain(rows);
}

export type CategoryMomentum = {
  name: string;
  slug: string;
  recent: number;
  previous: number;
  delta: number;
};

export type MomentumWindow = 7 | 30 | 90;

export async function getCategoryMomentum(
  limit = 6,
  windowDays: MomentumWindow = 30
): Promise<CategoryMomentum[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  const days = windowDays;
  const rows = await sql<CategoryMomentum[]>`
    WITH recent AS (
      SELECT c.slug, c.name, COUNT(DISTINCT m.repository_id)::int AS n
      FROM repository_categories rc
      JOIN categories c ON c.id = rc.category_id
      JOIN telegram_repo_mentions m ON m.repository_id = rc.repository_id
      JOIN telegram_posts p ON p.id = m.telegram_post_id
      WHERE COALESCE(m.discovered_at, p.posted_at) >= NOW() - (${days} || ' days')::interval
        AND c.slug NOT IN ('other', 'open-source')
      GROUP BY c.slug, c.name
    ),
    previous AS (
      SELECT c.slug, COUNT(DISTINCT m.repository_id)::int AS n
      FROM repository_categories rc
      JOIN categories c ON c.id = rc.category_id
      JOIN telegram_repo_mentions m ON m.repository_id = rc.repository_id
      JOIN telegram_posts p ON p.id = m.telegram_post_id
      WHERE COALESCE(m.discovered_at, p.posted_at) >= NOW() - ((${days} * 2) || ' days')::interval
        AND COALESCE(m.discovered_at, p.posted_at) < NOW() - (${days} || ' days')::interval
        AND c.slug NOT IN ('other', 'open-source')
      GROUP BY c.slug
    )
    SELECT
      r.name,
      r.slug,
      r.n AS recent,
      COALESCE(p.n, 0) AS previous,
      (r.n - COALESCE(p.n, 0)) AS delta
    FROM recent r
    LEFT JOIN previous p ON p.slug = r.slug
    ORDER BY delta DESC, r.n DESC
    LIMIT ${limit}
  `;
  return toPlain(rows);
}

export type DiscoverySpotlight = DiscoveryRow & {
  growth_multiple: number | null;
};

export async function getDiscoverySpotlight(): Promise<DiscoverySpotlight | null> {
  "use cache";
  cacheReadModel("catalog", "hours");
  const rows = await sql<DiscoverySpotlight[]>`
    WITH candidates AS (
      SELECT
        r.*,
        disc.first_discovered_at,
        disc.days_to_discovery,
        disc.mention_count
      FROM mv_repository_discovery disc
      JOIN repositories r ON r.id = disc.repository_id
      WHERE disc.first_discovered_at IS NOT NULL
        AND disc.days_to_discovery IS NOT NULL
        AND disc.days_to_discovery >= 0
        AND r.created_at_github IS NOT NULL
        AND COALESCE(r.stars, 0) > 0
      ORDER BY
        LN(1 + COALESCE(r.stars, 0))
        * EXP(-GREATEST(disc.days_to_discovery, 0) / 45.0)
        DESC
      LIMIT 50
    )
    SELECT
      ${repositorySelect},
      r.first_discovered_at,
      r.days_to_discovery,
      r.mention_count,
      sad.stars AS stars_at_discovery,
      CASE
        WHEN sad.stars IS NOT NULL AND sad.stars > 0
        THEN COALESCE(r.stars, 0)::float / sad.stars::float
        ELSE NULL
      END AS growth_multiple
    FROM candidates r
    JOIN LATERAL (
      SELECT s.stars
      FROM github_repo_snapshots s
      WHERE s.repository_id = r.id
        AND s.captured_at >= r.first_discovered_at - INTERVAL '2 days'
      ORDER BY ABS(EXTRACT(EPOCH FROM (s.captured_at - r.first_discovered_at)))
      LIMIT 1
    ) sad ON TRUE
    WHERE sad.stars IS NOT NULL
      AND COALESCE(r.stars, 0) > sad.stars
    ORDER BY
      (
        LN(1 + GREATEST(COALESCE(r.stars, 0) - sad.stars, 0))
        * CASE
            WHEN r.days_to_discovery <= 90 THEN 1.4
            WHEN r.days_to_discovery <= 180 THEN 1.15
            ELSE 1.0
          END
        * CASE
            WHEN r.first_discovered_at >= NOW() - INTERVAL '30 days' THEN 1.25
            ELSE 1.0
          END
      ) DESC
    LIMIT 1
  `;
  return toPlain(rows[0] ?? null);
}

async function attachCategories(rows: DiscoveryRow[]): Promise<DiscoveryRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.repository_id);
  const catRows = await sql<
    { repository_id: string; slug: string; name: string }[]
  >`
    SELECT rc.repository_id, c.slug, c.name
    FROM repository_categories rc
    JOIN categories c ON c.id = rc.category_id
    WHERE rc.repository_id = ANY(${ids})
    ORDER BY c.name
  `;
  const catsByRepo = new Map<string, { slug: string; name: string }[]>();
  for (const c of catRows) {
    const list = catsByRepo.get(c.repository_id) ?? [];
    list.push({ slug: c.slug, name: c.name });
    catsByRepo.set(c.repository_id, list);
  }
  return rows.map((row) => ({
    ...row,
    categories: catsByRepo.get(row.repository_id) ?? [],
  }));
}
