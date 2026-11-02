import { sql, type DiscoveryRow } from "@/lib/db";
import { cacheReadModel, toPlain } from "@/lib/data/cache";
import { discoverySelect, repositorySelect } from "@/lib/data/sql";

export async function getRepository(owner: string, repo: string) {
  "use cache";
  cacheReadModel("repo", "hours");
  const ownerKey = decodeURIComponent(owner);
  const repoKey = decodeURIComponent(repo);

  const rows = await sql<DiscoveryRow[]>`
    SELECT
      ${repositorySelect},
      ${discoverySelect}
    FROM repositories r
    LEFT JOIN mv_repository_discovery disc ON disc.repository_id = r.id
    WHERE lower(r.owner) = lower(${ownerKey})
      AND lower(r.repo_name) = lower(${repoKey})
    LIMIT 1
  `;
  return toPlain(rows[0] ?? null);
}

export async function getRepoMentions(repositoryId: string) {
  "use cache";
  cacheReadModel("repo", "hours");
  return toPlain(
    await sql<
      {
        telegram_message_id: number;
        posted_at: string;
        text: string | null;
        source_channel: string | null;
      }[]
    >`
      SELECT
        p.telegram_message_id,
        p.posted_at,
        p.text,
        p.source_channel
      FROM telegram_repo_mentions m
      JOIN telegram_posts p ON p.id = m.telegram_post_id
      WHERE m.repository_id = ${repositoryId}::uuid
      ORDER BY p.posted_at ASC
    `
  );
}

export async function getRepoSnapshots(repositoryId: string) {
  "use cache";
  cacheReadModel("repo", "hours");
  return toPlain(
    await sql<
      {
        captured_at: string;
        stars: number | null;
        forks: number | null;
        watchers: number | null;
        open_issues: number | null;
      }[]
    >`
      SELECT captured_at, stars, forks, watchers, open_issues
      FROM github_repo_snapshots
      WHERE repository_id = ${repositoryId}::uuid
      ORDER BY captured_at ASC
    `
  );
}

export async function getRepoCategories(repositoryId: string) {
  "use cache";
  cacheReadModel("repo", "hours");
  return toPlain(
    await sql<{ slug: string; name: string }[]>`
      SELECT c.slug, c.name
      FROM repository_categories rc
      JOIN categories c ON c.id = rc.category_id
      WHERE rc.repository_id = ${repositoryId}::uuid
      ORDER BY c.name
    `
  );
}
