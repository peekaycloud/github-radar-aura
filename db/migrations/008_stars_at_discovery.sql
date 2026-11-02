-- Freeze stars at Telegram discovery. Write-once; current stars keep updating.

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS stars_at_discovery BIGINT;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS stars_at_discovery_at TIMESTAMPTZ;

-- Backfill only when a snapshot landed near first Telegram mention.
UPDATE repositories r
SET
  stars_at_discovery = s.stars,
  stars_at_discovery_at = s.captured_at
FROM (
  SELECT DISTINCT ON (disc.repository_id)
    disc.repository_id,
    snap.stars,
    snap.captured_at
  FROM mv_repository_discovery disc
  JOIN github_repo_snapshots snap ON snap.repository_id = disc.repository_id
  WHERE disc.first_discovered_at IS NOT NULL
    AND snap.stars IS NOT NULL
    AND snap.captured_at >= disc.first_discovered_at - INTERVAL '2 days'
    AND snap.captured_at <= disc.first_discovered_at + INTERVAL '7 days'
  ORDER BY
    disc.repository_id,
    ABS(EXTRACT(EPOCH FROM (snap.captured_at - disc.first_discovered_at)))
) s
WHERE r.id = s.repository_id
  AND r.stars_at_discovery IS NULL;

CREATE INDEX IF NOT EXISTS idx_repositories_stars_at_discovery
  ON repositories (stars_at_discovery)
  WHERE stars_at_discovery IS NOT NULL;
