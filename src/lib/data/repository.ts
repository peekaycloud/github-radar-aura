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

/** Repos often linked in the same Telegram posts as this one. */
export async function getRelatedByCoMention(
  repositoryId: string,
  limit = 8
): Promise<(DiscoveryRow & { co_mention_count: number })[]> {
  "use cache";
  cacheReadModel("repo", "hours");
  return toPlain(
    await sql<(DiscoveryRow & { co_mention_count: number })[]>`
      WITH pairs AS (
        SELECT
          m2.repository_id AS other_id,
          COUNT(DISTINCT m1.telegram_post_id)::int AS co_mention_count
        FROM telegram_repo_mentions m1
        JOIN telegram_repo_mentions m2
          ON m1.telegram_post_id = m2.telegram_post_id
          AND m2.repository_id <> m1.repository_id
        WHERE m1.repository_id = ${repositoryId}::uuid
        GROUP BY m2.repository_id
        ORDER BY co_mention_count DESC
        LIMIT ${limit}
      )
      SELECT
        ${repositorySelect},
        ${discoverySelect},
        p.co_mention_count
      FROM pairs p
      JOIN repositories r ON r.id = p.other_id
      LEFT JOIN mv_repository_discovery disc ON disc.repository_id = r.id
      ORDER BY p.co_mention_count DESC
    `
  );
}
