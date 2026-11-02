import { sql, type DiscoveryRow } from "@/lib/db";
import { cacheReadModel, toPlain } from "@/lib/data/cache";
import {
  discoveryJoin,
  discoverySelect,
  repositorySelect,
} from "@/lib/data/sql";

export async function getTrending(
  window: "1d" | "7d" | "30d" | "all" = "7d",
  limit = 50,
  offset = 0
): Promise<DiscoveryRow[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  if (window === "all") {
    return toPlain(
      await sql<DiscoveryRow[]>`
        SELECT ${repositorySelect}, ${discoverySelect}
        FROM (
          SELECT *
          FROM repositories
          ORDER BY COALESCE(stars, 0) DESC
          LIMIT ${limit} OFFSET ${offset}
        ) r
        ${discoveryJoin}
      `
    );
  }

  const interval =
    window === "1d"
      ? sql`INTERVAL '1 day'`
      : window === "30d"
        ? sql`INTERVAL '30 days'`
        : sql`INTERVAL '7 days'`;
  const gainAlias =
    window === "1d"
      ? sql`stars_gained_1d`
      : window === "30d"
        ? sql`stars_gained_30d`
        : sql`stars_gained_7d`;

  const candidateLimit = Math.min(800, Math.max(400, offset + limit * 8));
  return toPlain(
    await sql<DiscoveryRow[]>`
      WITH candidates AS (
        SELECT snap.repository_id
        FROM mv_repo_snapshot_stats snap
        WHERE snap.snapshot_count >= 2
          AND snap.stars_delta > 0
        ORDER BY snap.stars_delta DESC
        LIMIT ${candidateLimit}
      ),
      gained AS (
        SELECT
          c.repository_id,
          (COALESCE(latest.stars, 0)
            - COALESCE(prior.stars, earliest.stars, 0)) AS stars_gained
        FROM candidates c
        JOIN LATERAL (
          SELECT s.stars, s.captured_at
          FROM github_repo_snapshots s
          WHERE s.repository_id = c.repository_id
          ORDER BY s.captured_at DESC
          LIMIT 1
        ) latest ON TRUE
        LEFT JOIN LATERAL (
          SELECT s.stars, s.captured_at
          FROM github_repo_snapshots s
          WHERE s.repository_id = c.repository_id
            AND s.captured_at <= NOW() - ${interval}
          ORDER BY s.captured_at DESC
          LIMIT 1
        ) prior ON TRUE
        JOIN LATERAL (
          SELECT s.stars, s.captured_at
          FROM github_repo_snapshots s
          WHERE s.repository_id = c.repository_id
          ORDER BY s.captured_at ASC
          LIMIT 1
        ) earliest ON TRUE
        WHERE COALESCE(latest.stars, 0)
            > COALESCE(prior.stars, earliest.stars, 0)
          AND latest.captured_at
            > COALESCE(prior.captured_at, earliest.captured_at)
        ORDER BY
          (COALESCE(latest.stars, 0)
            - COALESCE(prior.stars, earliest.stars, 0)) DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT
        ${repositorySelect},
        ${discoverySelect},
        gained.stars_gained AS ${gainAlias}
      FROM gained
      JOIN repositories r ON r.id = gained.repository_id
      ${discoveryJoin}
      ORDER BY gained.stars_gained DESC
    `
  );
}

export async function getHiddenGems(limit = 50, offset = 0): Promise<DiscoveryRow[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  return toPlain(
    await sql<DiscoveryRow[]>`
      SELECT
        ${repositorySelect},
        ${discoverySelect},
        snap.stars_delta AS stars_gained_7d,
        snap.pct_growth_observed AS stars_pct_growth_observed,
        (
          CASE
            WHEN COALESCE(r.stars, 0) BETWEEN 50 AND 800 THEN 1.6
            WHEN COALESCE(r.stars, 0) BETWEEN 801 AND 2000 THEN 1.1
            ELSE 0.7
          END
          * LN(1 + GREATEST(COALESCE(snap.stars_delta, 0), 0)
              + GREATEST(COALESCE(disc.mention_count, 1), 1))
          * EXP(-GREATEST(COALESCE(
              EXTRACT(EPOCH FROM (NOW() - disc.first_discovered_at)) / 86400.0,
              60
            ), 0) / 40.0)
          * CASE WHEN COALESCE(snap.pct_growth_observed, 0) >= 1 THEN 1.5 ELSE 1.0 END
        )::float AS gem_score
      FROM repositories r
      ${discoveryJoin}
      LEFT JOIN mv_repo_snapshot_stats snap ON snap.repository_id = r.id
      WHERE COALESCE(r.stars, 0) BETWEEN 20 AND 1999
        AND COALESCE(r.is_fork, FALSE) = FALSE
        AND COALESCE(r.is_archived, FALSE) = FALSE
        AND disc.first_discovered_at IS NOT NULL
        AND (
          COALESCE(snap.pct_growth_observed, 0) >= 1
          OR disc.first_discovered_at >= NOW() - INTERVAL '45 days'
        )
      ORDER BY gem_score DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `
  );
}

export async function getAheadOfCurve(limit = 50, offset = 0): Promise<DiscoveryRow[]> {
  "use cache";
  cacheReadModel("catalog", "hours");
  const candidateLimit = Math.min(800, Math.max(500, offset + limit * 8));
  return toPlain(
    await sql<DiscoveryRow[]>`
      WITH ranked AS (
        SELECT
          r.id,
          disc.first_discovered_at,
          disc.mention_count,
          disc.days_to_discovery
        FROM mv_repository_discovery disc
        JOIN repositories r ON r.id = disc.repository_id
        WHERE r.created_at_github IS NOT NULL
          AND disc.first_discovered_at IS NOT NULL
          AND disc.days_to_discovery IS NOT NULL
          AND disc.days_to_discovery >= 0
          AND COALESCE(r.stars, 0) >= 50
        ORDER BY
          (
            EXP(-GREATEST(disc.days_to_discovery, 0) / 45.0)
            * LN(1 + COALESCE(disc.mention_count, 1))
            * LN(1 + COALESCE(r.stars, 0))
            * CASE
                WHEN disc.days_to_discovery <= 30 THEN 1.4
                WHEN disc.days_to_discovery <= 90 THEN 1.15
                ELSE 1.0
              END
          ) DESC
        LIMIT ${candidateLimit}
      )
      SELECT
        ${repositorySelect},
        ranked.first_discovered_at,
        ranked.mention_count,
        ranked.days_to_discovery,
        EXTRACT(EPOCH FROM (NOW() - ranked.first_discovered_at)) / 86400.0
          AS discovery_age_days,
        sad.stars AS stars_at_discovery,
        earliest.stars AS baseline_stars,
        earliest.captured_at AS baseline_captured_at,
        COALESCE(r.stars, 0) AS current_stars,
        CASE
          WHEN COALESCE(sad.stars, 0) > 0
          THEN COALESCE(r.stars, 0)::float / sad.stars::float
          WHEN COALESCE(earliest.stars, 0) > 0
          THEN COALESCE(r.stars, 0)::float / earliest.stars::float
          ELSE NULL
        END AS growth_multiple
      FROM ranked
      JOIN repositories r ON r.id = ranked.id
      LEFT JOIN LATERAL (
        SELECT s.stars
        FROM github_repo_snapshots s
        WHERE s.repository_id = ranked.id
          AND s.captured_at >= ranked.first_discovered_at - INTERVAL '2 days'
          AND s.captured_at <= ranked.first_discovered_at + INTERVAL '7 days'
        ORDER BY ABS(EXTRACT(EPOCH FROM (s.captured_at - ranked.first_discovered_at)))
        LIMIT 1
      ) sad ON TRUE
      LEFT JOIN LATERAL (
        SELECT s.stars, s.captured_at
        FROM github_repo_snapshots s
        WHERE s.repository_id = ranked.id
        ORDER BY s.captured_at ASC
        LIMIT 1
      ) earliest ON TRUE
      ORDER BY
        (
          EXP(-GREATEST(ranked.days_to_discovery, 0) / 45.0)
          * LN(1 + COALESCE(ranked.mention_count, 1))
          * CASE
              WHEN sad.stars IS NOT NULL THEN
                LN(
                  1 + GREATEST(
                    COALESCE(r.stars, 0) - sad.stars, 0
                  )
                )
                * CASE
                    WHEN COALESCE(r.stars, 0) > sad.stars
                    THEN 3.0
                    ELSE 0.65
                  END
              ELSE LN(1 + COALESCE(r.stars, 0))
            END
          * CASE
              WHEN ranked.days_to_discovery <= 30 THEN 1.4
              WHEN ranked.days_to_discovery <= 90 THEN 1.15
              ELSE 1.0
            END
        ) DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  );
}

export async function getTimeline(limit = 60) {
  "use cache";
  cacheReadModel("catalog", "hours");
  return toPlain(
    await sql<
      { discovery_date: string; repositories_discovered: number; posts_count: number }[]
    >`
      SELECT
        discovery_date::text,
        repositories_discovered,
        posts_count
      FROM mv_discovery_timeline
      ORDER BY discovery_date DESC
      LIMIT ${limit}
    `
  );
}

export async function getReposForDate(date: string) {
  "use cache";
  cacheReadModel("catalog", "hours");
  return toPlain(
    await sql<DiscoveryRow[]>`
      SELECT ${repositorySelect}, ${discoverySelect}
      FROM mv_repository_discovery disc
      JOIN repositories r ON r.id = disc.repository_id
      WHERE DATE(disc.first_discovered_at) = ${date}::date
      ORDER BY COALESCE(r.stars, 0) DESC
    `
  );
}

export async function searchRepositories(opts: {
  q?: string;
  language?: string;
  category?: string;
  minStars?: number;
  archived?: boolean;
  fork?: boolean;
  limit?: number;
  offset?: number;
}) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;
  const q = opts.q?.trim() ?? "";
  const pattern = `%${q}%`;
  const ownerPrefix = `${q.toLowerCase()}%`;
  const idFilter = q
    ? sql`AND r.id IN (
        SELECT id FROM repositories WHERE full_name ILIKE ${pattern}
        UNION
        SELECT id FROM repositories WHERE lower(owner) LIKE ${ownerPrefix}
        ${
          q.length >= 3
            ? sql`UNION SELECT id FROM repositories WHERE description ILIKE ${pattern}`
            : sql``
        }
      )`
    : sql``;

  return toPlain(
    await sql<DiscoveryRow[]>`
      WITH matched AS (
        SELECT r.*
        FROM repositories r
        WHERE 1=1
          ${idFilter}
          ${opts.language ? sql`AND lower(r.language) = lower(${opts.language})` : sql``}
          ${opts.category ? sql`AND EXISTS (
            SELECT 1 FROM repository_categories rc
            JOIN categories c ON c.id = rc.category_id
            WHERE rc.repository_id = r.id AND c.slug = ${opts.category}
          )` : sql``}
          ${opts.minStars != null ? sql`AND COALESCE(r.stars, 0) >= ${opts.minStars}` : sql``}
          ${opts.archived === true ? sql`AND r.is_archived IS TRUE` : sql``}
          ${opts.archived === false ? sql`AND (r.is_archived IS FALSE OR r.is_archived IS NULL)` : sql``}
          ${opts.fork === true ? sql`AND r.is_fork IS TRUE` : sql``}
          ${opts.fork === false ? sql`AND (r.is_fork IS FALSE OR r.is_fork IS NULL)` : sql``}
        ORDER BY COALESCE(r.stars, 0) DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT ${repositorySelect}, ${discoverySelect}
      FROM matched r
      ${discoveryJoin}
      ORDER BY COALESCE(r.stars, 0) DESC
    `
  );
}
