import { EmptyState, SectionRule } from "@/components/repo-card";
import { PageShell } from "@/components/page-shell";
import { RepoLink } from "@/components/repo-link";
import { formatDate, formatDateShort, formatDelta, formatNumber, getAheadOfCurve } from "@/lib/queries";
import { cacheReadModel } from "@/lib/data/cache";
import type { DiscoveryRow } from "@/lib/db";
import { repoPath } from "@/lib/repo-path";
import Link from "next/link";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  return (
    <PageShell>
      <AheadPage searchParams={searchParams} />
    </PageShell>
  );
}

async function AheadPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1) || 1);
  return <CachedAhead page={page} />;
}

async function CachedAhead({ page }: { page: number }) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const limit = 40;
  const rows = await getAheadOfCurve(limit, (page - 1) * limit);

  return (
    <div className="space-y-8">
      <SectionRule title="Ahead of the Curve" kicker="Signature ranking" />
      <p className="max-w-2xl font-sans text-sm leading-relaxed text-[var(--ink-muted)]">
        Ranked by how soon the channel spotted a repo after GitHub creation.
        The big number is current stars. The delta is change since we started
        tracking this month — not GitHub’s full history.
      </p>
      {rows.length === 0 ? (
        <EmptyState message="No creation dates yet. Enrichment is catching up — check back after the next enrich run." />
      ) : (
        <div className="space-y-0 divide-y divide-[var(--rule)] border-y-2 border-[var(--rule-strong)]">
          {rows.map((repo, idx) => {
            const href = repoPath(repo.owner, repo.repo_name);
            return (
              <article
                key={repo.repository_id}
                className="grid gap-4 py-7 lg:grid-cols-[3.5rem_1fr_auto]"
              >
                <p className="font-mono text-sm font-medium text-[var(--signal)]">
                  {String((page - 1) * limit + idx + 1).padStart(2, "0")}
                </p>
                <div>
                  {href ? (
                    <RepoLink
                      href={href}
                      repo={repo}
                      className="font-serif text-2xl font-semibold tracking-tight hover:underline decoration-[var(--signal)] underline-offset-4"
                    >
                      {repo.full_name}
                    </RepoLink>
                  ) : (
                    <span className="font-serif text-2xl font-semibold tracking-tight">
                      {repo.full_name}
                    </span>
                  )}
                  {repo.description ? (
                    <p className="mt-2 line-clamp-2 font-sans text-sm text-[var(--ink-muted)]">
                      {repo.description}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    <span>Created {formatDate(repo.created_at_github)}</span>
                    <span>Discovered {formatDate(repo.first_discovered_at)}</span>
                    {repo.days_to_discovery != null ? (
                      <span className="font-medium text-[var(--signal)]">
                        {Math.round(repo.days_to_discovery)} days after creation
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-[11rem] font-mono text-sm tabular-nums text-[var(--ink)]">
                  <AheadStars repo={repo} />
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="flex justify-between font-mono text-xs uppercase tracking-[0.12em]">
        {page > 1 ? (
          <Link href={`/ahead-of-curve?page=${page - 1}`}>← Previous</Link>
        ) : (
          <span />
        )}
        {rows.length === limit ? (
          <Link href={`/ahead-of-curve?page=${page + 1}`}>Next →</Link>
        ) : null}
      </div>
    </div>
  );
}

function AheadStars({ repo }: { repo: DiscoveryRow }) {
  const now = repo.current_stars ?? repo.stars;
  const then =
    repo.stars_at_discovery != null ? repo.stars_at_discovery : repo.baseline_stars;
  const fromDiscovery = repo.stars_at_discovery != null;
  const delta = then != null && now != null ? now - then : null;
  const since = fromDiscovery
    ? "discovery"
    : formatDateShort(repo.baseline_captured_at);

  return (
    <>
      <p>
        <span className="text-[var(--ink-faint)]">Now</span>
        <br />
        <strong className="text-base">★ {formatNumber(now)}</strong>
      </p>
      {delta != null && Math.abs(delta) >= 10 ? (
        <p className="mt-2 font-medium text-[var(--signal)]">
          {formatDelta(delta)} since {since}
        </p>
      ) : (
        <p className="mt-2 text-[var(--ink-faint)]">
          {repo.baseline_captured_at
            ? `Tracking since ${formatDateShort(repo.baseline_captured_at)}`
            : "Waiting on a second snapshot"}
        </p>
      )}
    </>
  );
}
