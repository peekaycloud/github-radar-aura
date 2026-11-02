import { sql } from "@/lib/db";
import { cacheReadModel, toPlain } from "@/lib/data/cache";

export type GraphNodeKind = "repo" | "category" | "language";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  owner?: string | null;
  repo?: string | null;
  stars?: number | null;
  mention_count?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: "co-mention" | "category" | "language";
  weight: number;
};

export type KnowledgeGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generated_at: string;
};

const REPO_LIMIT = 56;
const MIN_CO_MENTION = 2;

export async function getKnowledgeGraph(): Promise<KnowledgeGraphData> {
  "use cache";
  cacheReadModel("catalog", "hours");

  const repoRows = await sql<
    {
      id: string;
      full_name: string;
      owner: string | null;
      repo_name: string | null;
      stars: number | null;
      language: string | null;
      mention_count: number;
    }[]
  >`
    SELECT
      r.id,
      r.full_name,
      r.owner,
      r.repo_name,
      r.stars,
      r.language,
      COUNT(DISTINCT m.id)::int AS mention_count
    FROM repositories r
    JOIN telegram_repo_mentions m ON m.repository_id = r.id
    JOIN telegram_posts p ON p.id = m.telegram_post_id
    WHERE COALESCE(m.discovered_at, p.posted_at) >= NOW() - INTERVAL '120 days'
    GROUP BY r.id
    ORDER BY mention_count DESC, r.stars DESC NULLS LAST
    LIMIT ${REPO_LIMIT}
  `;

  if (repoRows.length === 0) {
    return { nodes: [], edges: [], generated_at: new Date().toISOString() };
  }

  const repoIds = repoRows.map((r) => r.id);

  const coRows = await sql<
    { source_id: string; target_id: string; weight: number }[]
  >`
    SELECT
      m1.repository_id AS source_id,
      m2.repository_id AS target_id,
      COUNT(DISTINCT m1.telegram_post_id)::int AS weight
    FROM telegram_repo_mentions m1
    JOIN telegram_repo_mentions m2
      ON m1.telegram_post_id = m2.telegram_post_id
      AND m1.repository_id < m2.repository_id
    WHERE m1.repository_id = ANY(${repoIds})
      AND m2.repository_id = ANY(${repoIds})
    GROUP BY m1.repository_id, m2.repository_id
    HAVING COUNT(DISTINCT m1.telegram_post_id) >= ${MIN_CO_MENTION}
    ORDER BY weight DESC
    LIMIT 120
  `;

  const catRows = await sql<
    { repository_id: string; slug: string; name: string }[]
  >`
    SELECT rc.repository_id, c.slug, c.name
    FROM repository_categories rc
    JOIN categories c ON c.id = rc.category_id
    WHERE rc.repository_id = ANY(${repoIds})
      AND c.slug NOT IN ('other', 'open-source')
  `;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const r of repoRows) {
    const id = `repo:${r.id}`;
    nodeIds.add(id);
    nodes.push({
      id,
      kind: "repo",
      label: r.full_name ?? `${r.owner}/${r.repo_name}`,
      owner: r.owner,
      repo: r.repo_name,
      stars: r.stars,
      mention_count: r.mention_count,
    });

    if (r.language) {
      const langId = `lang:${r.language}`;
      if (!nodeIds.has(langId)) {
        nodeIds.add(langId);
        nodes.push({
          id: langId,
          kind: "language",
          label: r.language,
        });
      }
      edges.push({
        source: id,
        target: langId,
        kind: "language",
        weight: 1,
      });
    }
  }

  const catNodes = new Map<string, GraphNode>();
  for (const row of catRows) {
    const catId = `cat:${row.slug}`;
    if (!catNodes.has(catId)) {
      catNodes.set(catId, {
        id: catId,
        kind: "category",
        label: row.name,
      });
    }
    edges.push({
      source: `repo:${row.repository_id}`,
      target: catId,
      kind: "category",
      weight: 1,
    });
  }
  for (const cat of catNodes.values()) {
    nodeIds.add(cat.id);
    nodes.push(cat);
  }

  for (const e of coRows) {
    edges.push({
      source: `repo:${e.source_id}`,
      target: `repo:${e.target_id}`,
      kind: "co-mention",
      weight: e.weight,
    });
  }

  return toPlain({
    nodes,
    edges,
    generated_at: new Date().toISOString(),
  });
}
