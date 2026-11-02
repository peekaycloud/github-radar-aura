import { KnowledgeGraphView } from "@/components/knowledge-graph-view";
import { PageShell } from "@/components/page-shell";
import { SectionRule } from "@/components/repo-card";
import { cacheReadModel } from "@/lib/data/cache";
import { getKnowledgeGraph } from "@/lib/data/graph";

export default function Page() {
  return (
    <PageShell>
      <KnowledgeGraphPage />
    </PageShell>
  );
}

async function KnowledgeGraphPage() {
  "use cache";
  cacheReadModel("catalog", "hours");
  const graph = await getKnowledgeGraph();

  return (
    <div className="space-y-8">
      <SectionRule title="Knowledge Graph" kicker="Connections" />
      <p className="max-w-2xl font-sans text-sm text-[var(--ink-muted)]">
        Repositories linked when they appear in the same Telegram post, plus
        taxonomy and language edges. A living map of how the channel clusters
        open source.
      </p>
      <KnowledgeGraphView data={graph} />
    </div>
  );
}
