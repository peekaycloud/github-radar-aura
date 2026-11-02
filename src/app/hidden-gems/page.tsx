import { EmptyState, SectionRule } from "@/components/repo-card";
import { PageShell } from "@/components/page-shell";
import { RepoLink } from "@/components/repo-link";
import { cacheReadModel } from "@/lib/data/cache";
import { formatDateShort, formatNumber, getHiddenGems } from "@/lib/queries";
import { repoPath } from "@/lib/repo-path";
import Link from "next/link";

function daysAgo(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  return (
    <PageShell>
      <HiddenGemsPage searchParams={searchParams} />
    </PageShell>
  );
}

async function HiddenGemsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1) || 1);
  return <CachedHiddenGems page={page} />;
}

async function CachedHiddenGems({ page }: { page: number }) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const limit = 40;
  const rows = await getHiddenGems(limit, (page - 1) * limit);

  return (
    <div className="space-y-8">
      <SectionRule title="Hidden Gems" kicker="Small · selective" />
      <p className="max-w-2xl font-sans text-sm leading-relaxed text-[var(--ink-muted)]">
        Under 2K stars, not a fork, and either discovered in the last 45 days
        or showing measured star growth. The homepage count uses this same
        rule.
      </p>
      {rows.length === 0 ? (
        <EmptyState message="Gem rankings unlock after enrichment produces growth snapshots." />
      ) : (
        <div className="border-t-2 border-[var(--rule-strong)]">
          {rows.map((repo) => {
            const name = repo.full_name || `${repo.owner}/${repo.repo_name}`;
            const href = repoPath(repo.owner, repo.repo_name);
            const ago = daysAgo(repo.first_discovered_at);
            const early =
              repo.days_to_discovery != null &&
              repo.days_to_discovery >= 0 &&
              repo.days_to_discovery <= 90;
            const rising =
              Number(repo.stars_pct_growth_7d ?? repo.stars_pct_growth_observed ?? 0) >= 3;
            const active =
              repo.discovery_age_days != null && repo.discovery_age_days <= 30;

            return (
              <article
                key={repo.repository_id}
                className="border-b border-[var(--rule)] py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {href ? (
                    <RepoLink
                      href={href}
                      repo={repo}
                      className="font-serif text-xl font-semibold tracking-tight hover:underline decoration-[var(--signal)] underline-offset-2"
                    >
                      {name}
                    </RepoLink>
                  ) : (
                    <span className="font-serif text-xl font-semibold tracking-tight">
                      {name}
                    </span>
                  )}
                  <span className="font-mono text-sm tabular-nums text-[var(--ink)]">
                    {formatNumber(repo.stars)} ★
                    {ago ? (
                      <span className="ml-3 text-[var(--ink-faint)]">
                        · discovered {ago}
                      </span>
                    ) : null}
                  </span>
                </div>
                {repo.description ? (
                  <p className="mt-1 line-clamp-2 font-sans text-sm text-[var(--ink-muted)]">
                    {repo.description}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                  {early ? (
                    <span className="border border-[var(--signal)] px-1.5 py-0.5 text-[var(--signal)]">
                      Early
                    </span>
                  ) : null}
                  {active ? (
                    <span className="border border-[var(--rule-strong)] px-1.5 py-0.5 text-[var(--ink-muted)]">
                      Active
                    </span>
                  ) : null}
                  {rising ? (
                    <span className="border border-[var(--signal)] px-1.5 py-0.5 text-[var(--signal)]">
                      Rising
                    </span>
                  ) : null}
                  {!early && !active && !rising ? (
                    <span className="text-[var(--ink-faint)]">
                      Discovered {formatDateShort(repo.first_discovered_at)}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="flex justify-between font-sans text-xs uppercase tracking-[0.12em]">
        {page > 1 ? <Link href={`/hidden-gems?page=${page - 1}`}>← Previous</Link> : <span />}
        {rows.length === limit ? <Link href={`/hidden-gems?page=${page + 1}`}>Next →</Link> : null}
      </div>
    </div>
  );
}
