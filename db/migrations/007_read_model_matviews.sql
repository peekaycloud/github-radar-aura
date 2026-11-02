-- Read-model snapshots for the Next.js app.
-- Refreshed after scrape/enrich (scripts/refresh_read_models.py).
-- No extra datastore — these live in the existing Postgres.

DROP MATERIALIZED VIEW IF EXISTS mv_discovery_timeline;
DROP MATERIALIZED VIEW IF EXISTS mv_repository_discovery;
DROP MATERIALIZED VIEW IF EXISTS mv_repo_snapshot_stats;

CREATE MATERIALIZED VIEW mv_repo_snapshot_stats AS
SELECT
  repository_id,
  COUNT(*)::int AS snapshot_count,
  MIN(stars) AS min_stars,
  MAX(stars) AS max_stars,
  MAX(stars) - MIN(stars) AS stars_delta,
  CASE
    WHEN MIN(stars) > 0
    THEN ((MAX(stars) - MIN(stars))::float / MIN(stars)::float) * 100.0
    ELSE 0::float
  END AS pct_growth_observed,
  MIN(captured_at) AS first_captured_at,
  MAX(captured_at) AS last_captured_at
FROM github_repo_snapshots
GROUP BY repository_id;

CREATE UNIQUE INDEX mv_repo_snapshot_stats_pk
  ON mv_repo_snapshot_stats (repository_id);
CREATE INDEX mv_repo_snapshot_stats_pct
  ON mv_repo_snapshot_stats (pct_growth_observed DESC);

CREATE MATERIALIZED VIEW mv_repository_discovery AS
SELECT
  r.id AS repository_id,
  MIN(COALESCE(m.discovered_at, p.posted_at)) AS first_discovered_at,
  MAX(COALESCE(m.discovered_at, p.posted_at)) AS last_mentioned_at,
  COUNT(DISTINCT m.id)::int AS mention_count,
  CASE
    WHEN r.created_at_github IS NOT NULL
    THEN EXTRACT(EPOCH FROM (
      MIN(COALESCE(m.discovered_at, p.posted_at)) - r.created_at_github
    )) / 86400.0
    ELSE NULL
  END AS days_to_discovery
FROM repositories r
LEFT JOIN telegram_repo_mentions m ON m.repository_id = r.id
LEFT JOIN telegram_posts p ON p.id = m.telegram_post_id
GROUP BY r.id;

CREATE UNIQUE INDEX mv_repository_discovery_pk
  ON mv_repository_discovery (repository_id);
CREATE INDEX mv_repository_discovery_first
  ON mv_repository_discovery (first_discovered_at DESC NULLS LAST);

CREATE MATERIALIZED VIEW mv_discovery_timeline AS
SELECT
  DATE(COALESCE(m.discovered_at, p.posted_at)) AS discovery_date,
  COUNT(DISTINCT m.repository_id)::int AS repositories_discovered,
  COUNT(DISTINCT m.telegram_post_id)::int AS posts_count
FROM telegram_repo_mentions m
JOIN telegram_posts p ON p.id = m.telegram_post_id
WHERE COALESCE(m.discovered_at, p.posted_at) IS NOT NULL
GROUP BY DATE(COALESCE(m.discovered_at, p.posted_at));

CREATE UNIQUE INDEX mv_discovery_timeline_pk
  ON mv_discovery_timeline (discovery_date);
