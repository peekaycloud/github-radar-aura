-- GitHub Radar — derived analytics views
-- Drop dependents first so CREATE OR REPLACE never hits 42P16 (column mismatch).

DROP VIEW IF EXISTS v_hidden_gems;
DROP VIEW IF EXISTS v_ahead_of_curve;
DROP VIEW IF EXISTS v_discovery_score;
DROP VIEW IF EXISTS v_discovery_timeline;
DROP VIEW IF EXISTS v_community_stats;
DROP VIEW IF EXISTS v_top_owners;
DROP VIEW IF EXISTS v_stars_at_discovery;
DROP VIEW IF EXISTS v_repository_growth;
DROP VIEW IF EXISTS v_repository_discovery;

-- ---------------------------------------------------------------------------
-- Discovery metrics per repository
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_repository_discovery AS
SELECT
  r.id AS repository_id,
  r.full_name,
  r.github_url,
  r.owner,
  r.repo_name,
  r.description,
  r.language,
  r.license,
  r.stars,
  r.forks,
  r.open_issues,
  r.watchers,
  r.is_fork,
  r.is_archived,
  r.created_at_github,
  r.pushed_at_github,
  r.last_enriched_at,
  r.enrichment_status,
  MIN(COALESCE(m.discovered_at, p.posted_at)) AS first_discovered_at,
  MAX(COALESCE(m.discovered_at, p.posted_at)) AS last_mentioned_at,
  COUNT(DISTINCT m.id) AS mention_count,
  COUNT(DISTINCT p.id) AS telegram_post_count,
  CASE
    WHEN r.created_at_github IS NOT NULL
      THEN EXTRACT(EPOCH FROM (
        MIN(COALESCE(m.discovered_at, p.posted_at)) - r.created_at_github
      )) / 86400.0
    ELSE NULL
  END AS days_to_discovery,
  EXTRACT(EPOCH FROM (
    NOW() - MIN(COALESCE(m.discovered_at, p.posted_at))
  )) / 86400.0 AS discovery_age_days
FROM repositories r
LEFT JOIN telegram_repo_mentions m ON m.repository_id = r.id
LEFT JOIN telegram_posts p ON p.id = m.telegram_post_id
GROUP BY r.id;

-- ---------------------------------------------------------------------------
-- Growth from snapshots (1d / 7d / 30d)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_repository_growth AS
WITH latest AS (
  SELECT DISTINCT ON (repository_id)
    repository_id,
    captured_at,
    stars,
    forks,
    watchers,
    open_issues,
    contributors_count
  FROM github_repo_snapshots
  ORDER BY repository_id, captured_at DESC
),
snap_1d AS (
  SELECT DISTINCT ON (s.repository_id)
    s.repository_id,
    s.stars
  FROM github_repo_snapshots s
  WHERE s.captured_at <= NOW() - INTERVAL '1 day'
  ORDER BY s.repository_id, s.captured_at DESC
),
snap_7d AS (
  SELECT DISTINCT ON (s.repository_id)
    s.repository_id,
    s.stars
  FROM github_repo_snapshots s
  WHERE s.captured_at <= NOW() - INTERVAL '7 days'
  ORDER BY s.repository_id, s.captured_at DESC
),
snap_30d AS (
  SELECT DISTINCT ON (s.repository_id)
    s.repository_id,
    s.stars
  FROM github_repo_snapshots s
  WHERE s.captured_at <= NOW() - INTERVAL '30 days'
  ORDER BY s.repository_id, s.captured_at DESC
)
SELECT
  r.id AS repository_id,
  r.full_name,
  COALESCE(r.stars, latest.stars) AS current_stars,
  COALESCE(r.forks, latest.forks) AS current_forks,
  latest.captured_at AS latest_snapshot_at,
  CASE WHEN snap_1d.stars IS NOT NULL
    THEN COALESCE(r.stars, latest.stars, 0) - snap_1d.stars END AS stars_gained_1d,
  CASE WHEN snap_7d.stars IS NOT NULL
    THEN COALESCE(r.stars, latest.stars, 0) - snap_7d.stars END AS stars_gained_7d,
  CASE WHEN snap_30d.stars IS NOT NULL
    THEN COALESCE(r.stars, latest.stars, 0) - snap_30d.stars END AS stars_gained_30d,
  CASE
    WHEN snap_7d.stars IS NOT NULL AND snap_7d.stars > 0
    THEN ((COALESCE(r.stars, latest.stars, 0) - snap_7d.stars)::float
          / snap_7d.stars::float) * 100.0
    ELSE NULL
  END AS stars_pct_growth_7d
FROM repositories r
LEFT JOIN latest ON latest.repository_id = r.id
LEFT JOIN snap_1d ON snap_1d.repository_id = r.id
LEFT JOIN snap_7d ON snap_7d.repository_id = r.id
LEFT JOIN snap_30d ON snap_30d.repository_id = r.id;

-- ---------------------------------------------------------------------------
-- Stars nearest to first discovery (ahead-of-the-curve base)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stars_at_discovery AS
SELECT
  d.repository_id,
  d.first_discovered_at,
  (
    SELECT s.stars
    FROM github_repo_snapshots s
    WHERE s.repository_id = d.repository_id
      AND s.captured_at >= d.first_discovered_at - INTERVAL '2 days'
    ORDER BY ABS(EXTRACT(EPOCH FROM (s.captured_at - d.first_discovered_at)))
    LIMIT 1
  ) AS stars_at_discovery
FROM v_repository_discovery d
WHERE d.first_discovered_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Discovery Score
-- Formula (documented):
--   score =
--     0.30 * log1p(stars_gained_7d)         -- recent GitHub growth
--   + 0.20 * log1p(mention_count)           -- Telegram repetition
--   + 0.15 * recency_boost                  -- recently discovered
--   + 0.15 * early_discovery_boost          -- discovered soon after creation
--   + 0.10 * growth_since_discovery         -- stars now / stars then
--   + 0.10 * size_penalty_inverse           -- prefer not mega-repos only
--
-- recency_boost = exp(-discovery_age_days / 30)
-- early_discovery_boost = exp(-max(days_to_discovery, 0) / 60)
-- growth_since_discovery = log1p(current / max(stars_at_discovery, 1))
-- size_penalty_inverse = 1 / (1 + log1p(current_stars / 1000))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_discovery_score AS
SELECT
  d.repository_id,
  d.full_name,
  d.stars,
  d.mention_count,
  d.first_discovered_at,
  d.days_to_discovery,
  d.discovery_age_days,
  g.stars_gained_7d,
  sad.stars_at_discovery,
  (
    0.30 * LN(1 + GREATEST(COALESCE(g.stars_gained_7d, 0), 0))
    + 0.20 * LN(1 + COALESCE(d.mention_count, 0))
    + 0.15 * EXP(-GREATEST(COALESCE(d.discovery_age_days, 365), 0) / 30.0)
    + 0.15 * EXP(-GREATEST(COALESCE(d.days_to_discovery, 365), 0) / 60.0)
    + 0.10 * LN(1 + (
        COALESCE(d.stars, 0)::float
        / GREATEST(COALESCE(sad.stars_at_discovery, 1), 1)::float
      ))
    + 0.10 * (1.0 / (1.0 + LN(1 + COALESCE(d.stars, 0)::float / 1000.0)))
  )::float AS discovery_score
FROM v_repository_discovery d
LEFT JOIN v_repository_growth g ON g.repository_id = d.repository_id
LEFT JOIN v_stars_at_discovery sad ON sad.repository_id = d.repository_id;

-- ---------------------------------------------------------------------------
-- Ahead of the Curve
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ahead_of_curve AS
SELECT
  d.repository_id,
  d.full_name,
  d.owner,
  d.repo_name,
  d.description,
  d.language,
  d.github_url,
  d.created_at_github,
  d.first_discovered_at,
  d.days_to_discovery,
  d.mention_count,
  COALESCE(sad.stars_at_discovery, 0) AS stars_at_discovery,
  COALESCE(d.stars, 0) AS current_stars,
  CASE
    WHEN COALESCE(sad.stars_at_discovery, 0) > 0
    THEN (COALESCE(d.stars, 0)::float / sad.stars_at_discovery::float)
    ELSE NULL
  END AS growth_multiple,
  CASE
    WHEN COALESCE(sad.stars_at_discovery, 0) > 0
    THEN ((COALESCE(d.stars, 0) - sad.stars_at_discovery)::float
          / sad.stars_at_discovery::float) * 100.0
    ELSE NULL
  END AS growth_pct,
  -- Rank favor: early discovery + large subsequent growth
  (
    EXP(-GREATEST(COALESCE(d.days_to_discovery, 365), 0) / 45.0)
    * LN(1 + GREATEST(
        COALESCE(d.stars, 0) - COALESCE(sad.stars_at_discovery, 0), 0
      ))
    * LN(1 + COALESCE(d.mention_count, 1))
  )::float AS ahead_score
FROM v_repository_discovery d
LEFT JOIN v_stars_at_discovery sad ON sad.repository_id = d.repository_id
WHERE d.first_discovered_at IS NOT NULL
  AND d.created_at_github IS NOT NULL
  AND d.days_to_discovery IS NOT NULL
  AND d.days_to_discovery >= 0;

-- ---------------------------------------------------------------------------
-- Hidden Gems
-- Multiple signals required: modest stars, high recent growth, recent
-- discovery, repeated mentions, active repo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_hidden_gems AS
SELECT
  d.repository_id,
  d.full_name,
  d.owner,
  d.repo_name,
  d.description,
  d.language,
  d.github_url,
  d.stars,
  d.forks,
  d.mention_count,
  d.first_discovered_at,
  d.discovery_age_days,
  d.created_at_github,
  g.stars_gained_7d,
  g.stars_pct_growth_7d,
  ds.discovery_score,
  (
    -- Prefer mid/low stars with strong relative growth
    CASE
      WHEN COALESCE(d.stars, 0) BETWEEN 50 AND 5000 THEN 1.5
      WHEN COALESCE(d.stars, 0) < 50 THEN 1.0
      ELSE 0.4
    END
    * LN(1 + GREATEST(COALESCE(g.stars_gained_7d, 0), 0))
    * LN(1 + GREATEST(COALESCE(g.stars_pct_growth_7d, 0), 0) / 10.0)
    * LN(1 + COALESCE(d.mention_count, 0))
    * EXP(-GREATEST(COALESCE(d.discovery_age_days, 365), 0) / 45.0)
    * CASE WHEN d.is_archived IS TRUE THEN 0.1 ELSE 1.0 END
    * CASE
        WHEN d.pushed_at_github IS NOT NULL
          AND d.pushed_at_github > NOW() - INTERVAL '90 days'
        THEN 1.3 ELSE 0.7
      END
  )::float AS gem_score
FROM v_repository_discovery d
LEFT JOIN v_repository_growth g ON g.repository_id = d.repository_id
LEFT JOIN v_discovery_score ds ON ds.repository_id = d.repository_id
WHERE COALESCE(d.stars, 0) < 15000
  AND COALESCE(d.mention_count, 0) >= 1
  AND (
    COALESCE(g.stars_gained_7d, 0) > 0
    OR COALESCE(d.mention_count, 0) >= 2
    OR COALESCE(d.discovery_age_days, 999) < 30
  );

-- ---------------------------------------------------------------------------
-- Daily discovery timeline
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_discovery_timeline AS
SELECT
  DATE(COALESCE(m.discovered_at, p.posted_at)) AS discovery_date,
  COUNT(DISTINCT m.repository_id) AS repositories_discovered,
  COUNT(DISTINCT m.telegram_post_id) AS posts_count
FROM telegram_repo_mentions m
JOIN telegram_posts p ON p.id = m.telegram_post_id
WHERE COALESCE(m.discovered_at, p.posted_at) IS NOT NULL
GROUP BY DATE(COALESCE(m.discovered_at, p.posted_at));

-- ---------------------------------------------------------------------------
-- Homepage / community aggregates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_community_stats AS
SELECT
  (SELECT COUNT(*) FROM repositories) AS total_repositories,
  (SELECT COUNT(*) FROM telegram_posts) AS total_telegram_posts,
  (SELECT COUNT(*) FROM telegram_repo_mentions) AS total_mentions,
  (SELECT COUNT(*) FROM categories) AS total_categories,
  (SELECT COALESCE(AVG(stars), 0) FROM repositories WHERE stars IS NOT NULL) AS avg_stars,
  (
    SELECT COUNT(DISTINCT repository_id)
    FROM telegram_repo_mentions m
    JOIN telegram_posts p ON p.id = m.telegram_post_id
    WHERE COALESCE(m.discovered_at, p.posted_at) >= NOW() - INTERVAL '7 days'
  ) AS new_discoveries_this_week,
  (
    SELECT COUNT(*) FROM repositories
    WHERE enrichment_status = 'success'
  ) AS repositories_enriched;

-- ---------------------------------------------------------------------------
-- Top organizations / owners
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_top_owners AS
SELECT
  owner,
  COUNT(*) AS repo_count,
  SUM(COALESCE(stars, 0)) AS total_stars,
  AVG(COALESCE(stars, 0))::bigint AS avg_stars
FROM repositories
WHERE owner IS NOT NULL
GROUP BY owner;

-- First-discovery index helper (materialized later if needed)
CREATE INDEX IF NOT EXISTS idx_mentions_repo_discovered
  ON telegram_repo_mentions (repository_id, discovered_at);
