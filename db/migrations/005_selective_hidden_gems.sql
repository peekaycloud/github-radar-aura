-- Tighten Hidden Gems: modest stars + activity + growth signal.
-- Growth uses 7d % when available; falls back to observed snapshot Δ
-- while the enricher builds longer history.

DROP VIEW IF EXISTS v_hidden_gems;

CREATE VIEW v_hidden_gems AS
WITH snap AS (
  SELECT
    repository_id,
    MIN(stars) AS min_stars,
    MAX(stars) AS max_stars,
    MAX(stars) - MIN(stars) AS stars_delta,
    CASE
      WHEN MIN(stars) > 0
      THEN ((MAX(stars) - MIN(stars))::float / MIN(stars)::float) * 100.0
      ELSE 0::float
    END AS stars_pct_observed
  FROM github_repo_snapshots
  GROUP BY repository_id
)
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
    CASE
      WHEN COALESCE(d.stars, 0) BETWEEN 50 AND 2000 THEN 1.6
      WHEN COALESCE(d.stars, 0) < 50 THEN 0.9
      ELSE 0.3
    END
    * LN(1 + GREATEST(COALESCE(g.stars_gained_7d, s.stars_delta, 0), 0))
    * LN(1 + GREATEST(COALESCE(g.stars_pct_growth_7d, s.stars_pct_observed, 0), 0) / 8.0)
    * LN(1 + COALESCE(d.mention_count, 0))
    * EXP(-GREATEST(COALESCE(d.discovery_age_days, 365), 0) / 40.0)
    * CASE WHEN d.is_archived IS TRUE THEN 0.05 ELSE 1.0 END
    * CASE
        WHEN d.pushed_at_github IS NOT NULL
          AND d.pushed_at_github > NOW() - INTERVAL '30 days'
        THEN 1.35
        WHEN d.first_discovered_at > NOW() - INTERVAL '30 days'
        THEN 1.2
        ELSE 0.5
      END
  )::float AS gem_score,
  COALESCE(g.stars_pct_growth_7d, s.stars_pct_observed) AS stars_pct_growth_observed
FROM v_repository_discovery d
LEFT JOIN v_repository_growth g ON g.repository_id = d.repository_id
LEFT JOIN v_discovery_score ds ON ds.repository_id = d.repository_id
LEFT JOIN snap s ON s.repository_id = d.repository_id
WHERE COALESCE(d.stars, 0) < 2000
  AND COALESCE(d.is_fork, FALSE) = FALSE
  AND COALESCE(d.is_archived, FALSE) = FALSE
  AND COALESCE(d.mention_count, 0) >= 1
  AND (
    d.pushed_at_github > NOW() - INTERVAL '30 days'
    OR d.first_discovered_at > NOW() - INTERVAL '30 days'
  )
  AND (
    COALESCE(g.stars_pct_growth_7d, 0) >= 20
    -- Observed snapshot % is short-window until history deepens;
    -- require meaningful positive growth, not a flat 0%.
    OR COALESCE(s.stars_pct_observed, 0) >= 1
  );
