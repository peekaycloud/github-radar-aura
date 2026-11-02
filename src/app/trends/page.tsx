import { SectionRule } from "@/components/repo-card";
import { PageShell } from "@/components/page-shell";
import { cacheReadModel } from "@/lib/data/cache";
import { formatNumber, getCategories, getCommunityStats, getTopOwners } from "@/lib/queries";

export default function Page() {
  return (
    <PageShell>
      <TrendsPage />
    </PageShell>
  );
}

async function TrendsPage() {
  "use cache";
  cacheReadModel("stats", "hours");
  const [stats, owners, categories] = await Promise.all([
    getCommunityStats(),
    getTopOwners(25),
    getCategories(),
  ]);

  return (
    <div className="space-y-10">
      <SectionRule title="Trends" kicker="Community shape" />
      <p className="max-w-2xl font-sans text-sm text-[var(--ink-muted)]">
        Structural view of what the channel surfaces — prolific owners,
        category mix, and corpus scale.
      </p>

      <div className="grid gap-px border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-3">
        {[
          ["Corpus", formatNumber(stats.total_repositories)],
          ["Telegram posts", formatNumber(stats.total_telegram_posts)],
          ["Enriched", formatNumber(stats.repositories_enriched)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--paper)] px-5 py-6">
            <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {label}
            </p>
            <p className="mt-2 font-serif text-3xl">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h3 className="mb-4 border-b border-[var(--rule)] pb-2 font-serif text-xl">
            Most prolific owners
          </h3>
          <ul className="space-y-2">
            {owners.map((o) => (
              <li
                key={o.owner}
                className="flex items-baseline justify-between gap-3 font-sans text-sm"
              >
                <span>{o.owner}</span>
                <span className="tabular-nums text-[var(--ink-muted)]">
                  {o.repo_count} repos · ★ {formatNumber(Number(o.total_stars))}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-4 border-b border-[var(--rule)] pb-2 font-serif text-xl">
            Categories
          </h3>
          <ul className="space-y-2">
            {categories
              .filter((c) => c.count > 0)
              .map((c) => (
                <li
                  key={c.slug}
                  className="flex items-baseline justify-between gap-3 font-sans text-sm"
                >
                  <span>{c.name}</span>
                  <span className="tabular-nums text-[var(--ink-muted)]">{c.count}</span>
                </li>
              ))}
          </ul>
          {categories.every((c) => c.count === 0) ? (
            <p className="font-sans text-sm text-[var(--ink-muted)]">
              Run <code className="font-mono text-xs">scripts/classify_categories.py</code> after
              enrichment.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
