import { sql } from "@/lib/db";

/** Shared repository columns shaped as DiscoveryRow. */
export const repositorySelect = sql`
  r.id AS repository_id,
  r.github_url,
  r.owner,
  r.repo_name,
  r.full_name,
  r.description,
  r.homepage,
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
  r.enrichment_status
`;

export const discoverySelect = sql`
  disc.first_discovered_at,
  disc.last_mentioned_at,
  disc.mention_count,
  disc.days_to_discovery,
  EXTRACT(EPOCH FROM (NOW() - disc.first_discovered_at)) / 86400.0 AS discovery_age_days
`;

export const discoveryJoin = sql`
  LEFT JOIN mv_repository_discovery disc ON disc.repository_id = r.id
`;
