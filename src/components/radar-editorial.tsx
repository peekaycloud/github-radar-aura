import { AppLink } from "@/components/app-link";
import { RepoLink } from "@/components/repo-link";
import type { DiscoveryRow } from "@/lib/db";
import { formatDateShort, formatNumber } from "@/lib/queries";
import { repoPath } from "@/lib/repo-path";

function growthPct(repo: DiscoveryRow): number | null {
  const candidates = [
    repo.stars_pct_growth_30d,
    repo.stars_pct_growth_7d,
    repo.stars_pct_growth_observed,
  ];
  for (const g of candidates) {
    if (g != null && Number.isFinite(Number(g)) && Math.abs(Number(g)) >= 1) {
      return Number(g);
    }
  }
  return null;
}

export function EditorialRadarCard({
  repo,
  index,
}: {
  repo: DiscoveryRow;
  index: number;
}) {
  const name = repo.full_name || `${repo.owner}/${repo.repo_name}`;
  const href = repoPath(repo.owner, repo.repo_name);
  const growth = growthPct(repo);
  const cats = (repo.categories ?? []).slice(0, 3);
  const earlyDays =
    repo.days_to_discovery != null &&
    repo.days_to_discovery >= 0 &&
    repo.days_to_discovery <= 90
      ? Math.round(repo.days_to_discovery)
      : null;

  return (
    <article className="border-b border-[var(--rule)] py-2.5 first:pt-1 last:border-b-0">
      <div className="grid gap-1 sm:grid-cols-[2rem_1fr_auto] sm:items-start sm:gap-3">
        <p className="font-mono text-xs font-medium tabular-nums text-[var(--signal)]">
          {String(index).padStart(2, "0")}
        </p>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            {href ? (
              <RepoLink
                href={href}
                repo={repo}
                className="font-serif text-base font-semibold tracking-tight text-[var(--ink)] hover:underline decoration-[var(--signal)] underline-offset-2 sm:text-lg"
              >
                {name}
              </RepoLink>
            ) : (
              <span className="font-serif text-base font-semibold tracking-tight text-[var(--ink)] sm:text-lg">
                {name}
              </span>
            )}
            <span className="font-mono text-sm tabular-nums text-[var(--ink)]">
              {repo.stars != null ? (
                <>
                  ★ {formatNumber(repo.stars)}
                  {growth != null ? (
                    <span className="ml-2 text-[var(--signal)]">
                      {growth > 0 ? "↑" : "↓"}
                      {Math.abs(growth).toFixed(0)}%
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-[var(--ink-faint)]">Enriching…</span>
              )}
            </span>
          </div>

          {repo.description ? (
            <p className="mt-0.5 line-clamp-1 font-sans text-sm text-[var(--ink-muted)]">
              {repo.description}
            </p>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            {cats.length > 0 ? (
              <span className="text-[var(--ink-muted)]">
                {cats.map((c) => c.name).join(" · ")}
              </span>
            ) : repo.language ? (
              <span className="text-[var(--ink-muted)]">{repo.language}</span>
            ) : null}
            <span>Discovered {formatDateShort(repo.first_discovered_at)}</span>
          </div>
        </div>

        <aside className="hidden w-[7.25rem] shrink-0 text-right sm:block">
          {earlyDays != null ? (
            <>
              <p className="font-serif text-lg font-semibold tabular-nums leading-none text-[var(--signal)]">
                {earlyDays}d
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                Created → discovered
              </p>
            </>
          ) : (
            <>
              <p className="font-serif text-base font-semibold leading-none text-[var(--ink)]">
                {formatDateShort(repo.first_discovered_at)}
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                Discovered
              </p>
            </>
          )}
        </aside>
      </div>
    </article>
  );
}

export function MomentumBars({
  items,
}: {
  items: { name: string; recent: number; delta: number }[];
}) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => Math.abs(i.delta) || i.recent), 1);

  return (
    <div className="divide-y divide-[var(--rule)]">
      {items.map((item) => (
        <div
          key={item.name}
          className="grid grid-cols-[6.5rem_1fr_5rem] items-center gap-2 py-2 first:pt-1 last:pb-1"
        >
          <span className="truncate font-sans text-sm text-[var(--ink)]">{item.name}</span>
          <div className="h-[5px] bg-[var(--rule)]/40">
            <div
              className="h-[5px] bg-[var(--ink)]"
              style={{
                width: `${Math.max(4, (Math.max(item.delta, 0) / max) * 100)}%`,
              }}
            />
          </div>
          <span className="text-right font-mono text-[11px] tabular-nums text-[var(--signal)]">
            {item.delta > 0 ? `+${item.delta}` : item.delta} repos
          </span>
        </div>
      ))}
    </div>
  );
}

export function CompactRepoRow({
  repo,
  metric,
}: {
  repo: DiscoveryRow;
  metric: string;
}) {
  const name = repo.full_name || `${repo.owner}/${repo.repo_name}`;
  const href = repoPath(repo.owner, repo.repo_name);
  const rowClass =
    "flex items-baseline justify-between gap-3 border-b border-[var(--rule)] py-2 first:pt-1 last:border-b-0 last:pb-1 hover:bg-[var(--paper)]/60";
  const body = (
    <>
      <span className="min-w-0 truncate font-sans text-sm text-[var(--ink)]">{name}</span>
      <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--signal)]">
        {metric}
      </span>
    </>
  );
  if (!href) return <div className={rowClass}>{body}</div>;
  return (
    <RepoLink href={href} repo={repo} className={rowClass}>
      {body}
    </RepoLink>
  );
}

export function MomentumWindowTabs({
  active,
}: {
  active: 7 | 30 | 90;
}) {
  const tabs: { days: 7 | 30 | 90; label: string }[] = [
    { days: 7, label: "7D" },
    { days: 30, label: "30D" },
    { days: 90, label: "90D" },
  ];
  return (
    <div className="flex gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
      {tabs.map((t) => (
        <AppLink
          key={t.days}
          href={t.days === 30 ? "/" : `/?m=${t.days}d`}
          scroll={false}
          className={
            active === t.days
              ? "text-[var(--signal)]"
              : "text-[var(--ink-faint)] hover:text-[var(--ink)]"
          }
        >
          {t.label}
        </AppLink>
      ))}
    </div>
  );
}
