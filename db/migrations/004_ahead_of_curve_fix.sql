-- Ahead of the Curve works once created_at_github is enriched.
-- Rank primarily by early discovery; growth multiple is optional.

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
  COALESCE(sad.stars_at_discovery, earliest.stars) AS stars_at_discovery,
  COALESCE(d.stars, 0) AS current_stars,
  CASE
    WHEN COALESCE(sad.stars_at_discovery, earliest.stars, 0) > 0
    THEN (COALESCE(d.stars, 0)::float
          / GREATEST(COALESCE(sad.stars_at_discovery, earliest.stars), 1)::float)
    ELSE NULL
  END AS growth_multiple,
  CASE
    WHEN COALESCE(sad.stars_at_discovery, earliest.stars, 0) > 0
    THEN ((COALESCE(d.stars, 0) - COALESCE(sad.stars_at_discovery, earliest.stars))::float
          / GREATEST(COALESCE(sad.stars_at_discovery, earliest.stars), 1)::float) * 100.0
    ELSE NULL
  END AS growth_pct,
  (
    EXP(-GREATEST(COALESCE(d.days_to_discovery, 365), 0) / 45.0)
    * LN(1 + GREATEST(COALESCE(d.stars, 0), 0))
    * LN(1 + COALESCE(d.mention_count, 1))
    * CASE
        WHEN d.days_to_discovery IS NOT NULL AND d.days_to_discovery <= 30 THEN 1.4
        WHEN d.days_to_discovery IS NOT NULL AND d.days_to_discovery <= 90 THEN 1.15
        ELSE 1.0
      END
  )::float AS ahead_score
FROM v_repository_discovery d
LEFT JOIN v_stars_at_discovery sad ON sad.repository_id = d.repository_id
LEFT JOIN LATERAL (
  SELECT s.stars
  FROM github_repo_snapshots s
  WHERE s.repository_id = d.repository_id
  ORDER BY s.captured_at ASC
  LIMIT 1
) earliest ON TRUE
WHERE d.first_discovered_at IS NOT NULL
  AND d.created_at_github IS NOT NULL
  AND d.days_to_discovery IS NOT NULL
  AND d.days_to_discovery >= 0;
