import { AppLink } from "@/components/app-link";
import { RepoLink } from "@/components/repo-link";
import { formatDate, formatNumber } from "@/lib/queries";
import type { DiscoveryRow } from "@/lib/db";
import { repoPath } from "@/lib/repo-path";

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <section className="grid grid-cols-2 gap-px border-2 border-[var(--rule-strong)] bg-[var(--rule-strong)] sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item, i) => (
        <div
          key={item.label}
          className="animate-metric bg-[var(--paper)] px-4 py-6 text-center sm:text-left"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            {item.label}
          </p>
          <p className="mt-2 font-serif text-3xl font-semibold leading-none tracking-tight text-[var(--ink)] tabular-nums">
            {item.value}
          </p>
        </div>
      ))}
    </section>
  );
}

export function SectionRule({
  title,
  kicker,
  href,
  compact,
}: {
  title: string;
  kicker?: string;
  href?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "mb-3 flex items-end justify-between gap-4"
          : "mb-7 flex items-end justify-between gap-4"
      }
    >
      <div className="min-w-0">
        {kicker ? (
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
            {kicker}
          </p>
        ) : null}
        <h2
          className={
            compact
              ? "font-serif text-xl font-semibold tracking-tight text-[var(--ink)] sm:text-2xl"
              : "font-serif text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl"
          }
        >
          {title}
        </h2>
        <div
          className={
            compact
              ? "animate-rule mt-2 h-[2px] w-12 bg-[var(--signal)]"
              : "animate-rule mt-3 h-[2px] w-16 bg-[var(--signal)]"
          }
        />
      </div>
      {href ? (
        <AppLink
          href={href}
          className="shrink-0 border-b border-[var(--ink)] pb-0.5 font-sans text-[11px] uppercase tracking-[0.14em] text-[var(--ink)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          View all →
        </AppLink>
      ) : null}
    </div>
  );
}

export function RepoCard({ repo, emphasis }: { repo: DiscoveryRow; emphasis?: "gem" | "ahead" }) {
  const name = repo.full_name || `${repo.owner}/${repo.repo_name}`;
  const href = repoPath(repo.owner, repo.repo_name);

  return (
    <article className="group grid gap-2 border-b border-[var(--rule)] py-6 first:pt-1 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-8">
      <div>
        {href ? (
          <RepoLink
            href={href}
            repo={repo}
            className="font-serif text-xl font-semibold tracking-tight text-[var(--ink)] decoration-[var(--signal)] underline-offset-4 transition-colors group-hover:underline sm:text-2xl"
          >
            {name}
          </RepoLink>
        ) : (
          <span className="font-serif text-xl font-semibold tracking-tight text-[var(--ink)] sm:text-2xl">
            {name}
          </span>
        )}
        {repo.description ? (
          <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-[var(--ink-muted)] line-clamp-2">
            {repo.description}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          <span>Discovered {formatDate(repo.first_discovered_at)}</span>
          {emphasis === "ahead" && repo.days_to_discovery != null ? (
            <span className="font-medium text-[var(--signal)]">
              {Math.round(repo.days_to_discovery)}d after creation
            </span>
          ) : null}
          {emphasis === "gem" ? (
            <span className="text-[var(--signal)]">Hidden gem</span>
          ) : null}
          {repo.discovery_score != null ? (
            <span>Score {repo.discovery_score.toFixed(2)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-3 font-mono text-xs tabular-nums text-[var(--ink)] sm:flex-col sm:items-end sm:gap-1">
        <span className="text-base font-medium">★ {formatNumber(repo.stars)}</span>
        {repo.forks != null ? (
          <span className="text-[var(--ink-muted)]">⑂ {formatNumber(repo.forks)}</span>
        ) : null}
        {repo.language ? (
          <span className="text-[var(--ink-faint)]">{repo.language}</span>
        ) : null}
        {repo.stars_gained_7d != null && repo.stars_gained_7d !== 0 ? (
          <span className="text-[var(--signal)]">
            {repo.stars_gained_7d > 0 ? "+" : ""}
            {formatNumber(repo.stars_gained_7d)} / 7d
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="border-2 border-dashed border-[var(--rule)] bg-[var(--paper-elevated)] px-6 py-16 text-center font-sans text-sm text-[var(--ink-muted)]">
      {message}
    </p>
  );
}
