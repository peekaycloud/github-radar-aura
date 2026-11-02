import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { RepoLink } from "@/components/repo-link";
import { EmptyState, SectionRule } from "@/components/repo-card";
import {
  CompactRepoRow,
  EditorialRadarCard,
  MomentumBars,
  MomentumWindowTabs,
} from "@/components/radar-editorial";
import {
  formatNumber,
  getCategoryMomentum,
  getDiscoverySpotlight,
  getFastestMoving,
  getIntelligenceStats,
  getTodaysRadar,
  type MomentumWindow,
} from "@/lib/queries";
import { cacheReadModel } from "@/lib/data/cache";
import { repoPath } from "@/lib/repo-path";

function parseMomentumWindow(raw?: string): MomentumWindow {
  if (raw === "7d") return 7;
  if (raw === "90d") return 90;
  return 30;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  return (
    <PageShell>
      <HomePage searchParams={searchParams} />
    </PageShell>
  );
}

async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  return <CachedHome windowDays={parseMomentumWindow(params.m)} />;
}

async function CachedHome({ windowDays }: { windowDays: MomentumWindow }) {
  "use cache";
  cacheReadModel("catalog", "hours");

  const [stats, radar, momentum, fastest, spotlight] = await Promise.all([
    getIntelligenceStats(),
    getTodaysRadar(4),
    getCategoryMomentum(6, windowDays),
    getFastestMoving(6),
    getDiscoverySpotlight(),
  ]);

  const kpis: { label: string; value: string; hint?: string }[] = [
    { label: "Repos", value: formatNumber(stats.total_repositories) },
    {
      label: "New repos",
      value: formatNumber(stats.discoveries_this_month),
      hint: "30 days",
    },
    { label: "Hidden gems", value: formatNumber(stats.hidden_gems) },
    {
      label: "Median age",
      value:
        stats.median_discovery_age_days != null
          ? `${Math.round(stats.median_discovery_age_days)}d`
          : "—",
      hint: "created → discovered",
    },
  ];

  if (stats.fast_growers > 0) {
    kpis.splice(2, 0, {
      label: "Fast growers",
      value: formatNumber(stats.fast_growers),
    });
  }

  const spotlightName =
    spotlight?.full_name ||
    (spotlight ? `${spotlight.owner}/${spotlight.repo_name}` : null);
  const spotlightDays =
    spotlight?.days_to_discovery != null
      ? Math.round(spotlight.days_to_discovery)
      : null;
  const spotlightMultiple =
    spotlight?.growth_multiple != null && Number.isFinite(spotlight.growth_multiple)
      ? spotlight.growth_multiple
      : null;

  return (
    <div className="space-y-7">
      <section>
        <div
          className={`grid grid-cols-2 gap-px border-2 border-[var(--rule-strong)] bg-[var(--rule-strong)] ${
            kpis.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4"
          }`}
        >
          {kpis.map((k, i) => {
            const spanLastOnMobile =
              kpis.length % 2 === 1 && i === kpis.length - 1;
            return (
              <div
                key={k.label}
                className={
                  spanLastOnMobile
                    ? "col-span-2 bg-[var(--paper)] px-3 py-2.5 sm:col-span-1"
                    : "bg-[var(--paper)] px-3 py-2.5"
                }
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  {k.label}
                </p>
                <p className="mt-0.5 font-serif text-xl font-semibold tabular-nums leading-none text-[var(--ink)]">
                  {k.value}
                </p>
                {k.hint ? (
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    {k.hint}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionRule title="Today’s Radar" kicker="Latest discoveries" href="/timeline" />
        {radar.length === 0 ? (
          <EmptyState message="No discoveries yet." />
        ) : (
          <div className="border-t-2 border-[var(--rule-strong)]">
            {radar.map((repo, i) => (
              <EditorialRadarCard key={repo.repository_id} repo={repo} index={i + 1} />
            ))}
          </div>
        )}
      </section>

      {/* Matched two-column intelligence panels */}
      <section className="grid items-stretch gap-6 border-t border-[var(--rule)] pt-6 lg:grid-cols-2 lg:gap-8">
        <div className="flex min-h-0 flex-col">
          <SectionRule
            title="What’s accelerating"
            kicker="Trending categories"
            href="/trends"
            compact
          />
          <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              Additional repos vs prior {windowDays}d
            </p>
            <MomentumWindowTabs active={windowDays} />
          </div>
          <div className="flex flex-1 flex-col border border-[var(--rule-strong)] bg-[var(--paper-elevated)] px-3.5 py-2">
            {momentum.length === 0 ? (
              <p className="py-2 font-sans text-sm text-[var(--ink-muted)]">
                Category momentum appears as classifications accumulate.
              </p>
            ) : (
              <MomentumBars items={momentum} />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <SectionRule
            title="Fastest moving"
            kicker="Star growth · observed"
            href="/trending"
            compact
          />
          <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              Observed star growth
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              Top {fastest.length || 6}
            </span>
          </div>
          <div className="flex flex-1 flex-col border border-[var(--rule-strong)] bg-[var(--paper-elevated)] px-3.5 py-2">
            {fastest.length === 0 ? (
              <p className="py-2 font-sans text-sm text-[var(--ink-muted)]">
                Growth rankings unlock as daily snapshots accumulate.
              </p>
            ) : (
              fastest.map((repo) => (
                <CompactRepoRow
                  key={repo.repository_id}
                  repo={repo}
                  metric={`+${Number(repo.pct_growth_observed).toFixed(0)}% ★`}
                />
              ))
            )}
          </div>
        </div>
      </section>

      {/* Compact discovery story — one observation */}
      <section>
        <SectionRule title="Discovery story" kicker="Spotlight" compact />
        {spotlight && spotlightName ? (
          <div className="border-2 border-[var(--rule-strong)] border-l-[3px] border-l-[var(--signal)] bg-[var(--paper-elevated)] px-4 py-3.5">
            <p className="font-serif text-lg leading-snug text-[var(--ink)]">
              The channel spotted{" "}
              <RepoLink
                href={repoPath(spotlight.owner, spotlight.repo_name) ?? "/repositories"}
                repo={spotlight}
                className="underline decoration-[var(--signal)] underline-offset-2"
              >
                {spotlightName}
              </RepoLink>
              {spotlightDays != null ? (
                <>
                  {" "}
                  {spotlightDays} days after creation
                  {spotlight.stars_at_discovery != null ? (
                    <>, when it had {formatNumber(spotlight.stars_at_discovery)} stars</>
                  ) : null}
                  .
                </>
              ) : (
                "."
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs tabular-nums text-[var(--ink)]">
              {spotlight.stars_at_discovery != null ? (
                <span>
                  <span className="text-[var(--ink-faint)]">At discovery </span>
                  {formatNumber(spotlight.stars_at_discovery)} ★
                </span>
              ) : null}
              <span>
                <span className="text-[var(--ink-faint)]">Today </span>
                {formatNumber(spotlight.stars)} ★
              </span>
              {spotlightMultiple != null && spotlightMultiple >= 1.1 ? (
                <span className="text-[var(--signal)]">
                  {spotlightMultiple.toFixed(1)}× growth
                </span>
              ) : null}
              {spotlightDays != null ? (
                <span>
                  <span className="text-[var(--ink-faint)]">Lag </span>
                  {spotlightDays}d
                </span>
              ) : null}
            </div>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              <Link href="/ahead-of-curve" className="text-[var(--signal)] hover:underline">
                Ahead of Curve →
              </Link>
              <span className="mx-2 text-[var(--rule)]">·</span>
              Early discovery & star trajectory
            </p>
          </div>
        ) : (
          <div className="border border-[var(--rule-strong)] px-4 py-3 font-sans text-sm text-[var(--ink-muted)]">
            Spotlight unlocks once creation dates and stars-at-discovery are enriched.
          </div>
        )}
      </section>
    </div>
  );
}
