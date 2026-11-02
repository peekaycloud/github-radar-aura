import { EmptyState, RepoCard, SectionRule } from "@/components/repo-card";
import { PageShell } from "@/components/page-shell";
import { cacheReadModel } from "@/lib/data/cache";
import { getTrending } from "@/lib/queries";
import Link from "next/link";

const WINDOWS = [
  { key: "1d", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
] as const;

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; page?: string }>;
}) {
  return (
    <PageShell>
      <TrendingPage searchParams={searchParams} />
    </PageShell>
  );
}

async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; page?: string }>;
}) {
  const params = await searchParams;
  const window =
    (WINDOWS.find((w) => w.key === params.window)?.key as
      | "1d"
      | "7d"
      | "30d"
      | "all") ?? "7d";
  const page = Math.max(1, Number(params.page || 1) || 1);
  return <CachedTrending window={window} page={page} />;
}

async function CachedTrending({
  window,
  page,
}: {
  window: "1d" | "7d" | "30d" | "all";
  page: number;
}) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const limit = 40;
  const rows = await getTrending(window, limit, (page - 1) * limit);

  return (
    <div className="space-y-8">
      <SectionRule title="Trending" kicker="Momentum" />
      <p className="max-w-2xl font-sans text-sm text-[var(--ink-muted)]">
        Ranked by star gain between snapshots. If we don’t yet have a capture
        from 7 or 30 days ago, the oldest snapshot is the baseline — that
        history only started this month.
      </p>
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/trending?window=${w.key}`}
            className={
              window === w.key
                ? "border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.12em] text-[var(--paper)]"
                : "border border-[var(--rule)] px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:border-[var(--ink)]"
            }
          >
            {w.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No trending data yet." />
      ) : (
        <div>
          {rows.map((repo) => (
            <RepoCard key={repo.repository_id} repo={repo} />
          ))}
        </div>
      )}
      <div className="flex justify-between font-sans text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        {page > 1 ? (
          <Link href={`/trending?window=${window}&page=${page - 1}`}>← Previous</Link>
        ) : (
          <span />
        )}
        {rows.length === limit ? (
          <Link href={`/trending?window=${window}&page=${page + 1}`}>Next →</Link>
        ) : null}
      </div>
    </div>
  );
}
