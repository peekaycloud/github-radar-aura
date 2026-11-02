import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GrowthPanel } from "@/components/charts";
import { PageShell } from "@/components/page-shell";
import { RepoHeading, RepoMeta } from "@/components/repo-heading";
import {
  formatDate,
  formatNumber,
  getRepoCategories,
  getRepoMentions,
  getRepoSnapshots,
  getRepository,
} from "@/lib/queries";
import { cacheReadModel } from "@/lib/data/cache";
import type { DiscoveryRow } from "@/lib/db";
import { AppLink } from "@/components/app-link";
import { buildWhyItMatters, signalLevel } from "@/lib/signals";

export default function Page({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  return (
    <PageShell>
      <RepoDetailPage params={params} />
    </PageShell>
  );
}

async function RepoDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const repository = await getRepository(owner, repo);
  if (!repository) notFound();

  return (
    <div className="space-y-12">
      <RepoHeading repository={repository} owner={owner} repo={repo} />

      <Suspense fallback={<SectionPlaceholder label="Loading discovery details…" />}>
        <RepoIntelligence repository={repository} />
      </Suspense>

      <p>
        <AppLink
          href="/repositories"
          className="font-sans text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          ← Back to repositories
        </AppLink>
      </p>
    </div>
  );
}

async function RepoIntelligence({
  repository,
}: {
  repository: DiscoveryRow;
}) {
  "use cache";
  cacheReadModel("repo", "hours");
  const [mentions, snapshots, categories] = await Promise.all([
    getRepoMentions(repository.repository_id),
    getRepoSnapshots(repository.repository_id),
    getRepoCategories(repository.repository_id),
  ]);

  const growthSnapshots = snapshots.map((s) => ({
    capturedAt:
      typeof s.captured_at === "string"
        ? s.captured_at
        : new Date(s.captured_at as string | number | Date).toISOString(),
    stars: s.stars == null ? null : Number(s.stars),
    forks: s.forks == null ? null : Number(s.forks),
  }));

  const first = mentions[0];
  const last = mentions[mentions.length - 1];
  const channel = first?.source_channel || "githubtrending";
  const why = buildWhyItMatters({ ...repository, categories });
  const level = signalLevel(repository);

  return (
    <>
      {categories.length ? (
        <div className="-mt-8 flex flex-wrap gap-2">
          {categories.map((c) => (
            <span
              key={c.slug}
              className="border border-[var(--rule)] px-2 py-0.5 font-sans text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]"
            >
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <section className="border-2 border-[var(--rule-strong)] border-l-[3px] border-l-[var(--signal)] bg-[var(--paper-elevated)] px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--signal)]">
            Why it’s on the radar
          </p>
          <p
            className={
              level === "High"
                ? "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--signal)]"
                : "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            }
          >
            Signal · {level}
          </p>
        </div>
        <ul className="mt-3 space-y-1.5 font-sans text-sm text-[var(--ink-muted)]">
          {why.map((s) => (
            <li key={s.label}>
              <span className="text-[var(--ink-faint)]">{s.label}: </span>
              <span
                className={
                  s.tone === "signal"
                    ? "text-[var(--signal)]"
                    : s.tone === "ink"
                      ? "text-[var(--ink)]"
                      : undefined
                }
              >
                {s.value}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 border-b border-[var(--rule)] pb-2 font-serif text-2xl">
          Telegram Discovery
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RepoMeta label="First discovered" value={formatDate(repository.first_discovered_at)} />
          <RepoMeta label="Last seen on channel" value={formatDate(repository.last_mentioned_at)} />
          <RepoMeta
            label="Days to discovery"
            value={
              repository.days_to_discovery != null
                ? `${Math.round(repository.days_to_discovery)} days`
                : "—"
            }
          />
        </div>
        <ul className="mt-6 space-y-4">
          {mentions.map((m) => (
            <li key={m.telegram_message_id} className="border-l-2 border-[var(--rule)] pl-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-xs text-[var(--ink-faint)]">
                  {formatDate(m.posted_at)}
                </span>
                <a
                  href={`https://t.me/${channel}/${m.telegram_message_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-sans text-xs uppercase tracking-[0.1em] text-[var(--signal)] hover:underline"
                >
                  Telegram #{m.telegram_message_id}
                </a>
              </div>
              {m.text ? (
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap font-sans text-sm text-[var(--ink-muted)]">
                  {m.text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        {first && last && first.telegram_message_id !== last.telegram_message_id ? (
          <p className="mt-4 font-sans text-xs text-[var(--ink-faint)]">
            First post #{first.telegram_message_id} · Last post #{last.telegram_message_id}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-4 border-b border-[var(--rule)] pb-2 font-serif text-2xl">
          Growth
        </h2>
        <GrowthPanel snapshots={growthSnapshots} />
      </section>

      <section>
        <h2 className="mb-4 border-b border-[var(--rule)] pb-2 font-serif text-2xl">
          Discovery
        </h2>
        <div className="space-y-2 font-sans text-sm leading-relaxed text-[var(--ink-muted)]">
          {repository.days_to_discovery != null ? (
            <p>
              Discovered{" "}
              <strong className="text-[var(--ink)]">
                {Math.round(repository.days_to_discovery)} days
              </strong>{" "}
              after repository creation.
            </p>
          ) : (
            <p>Creation date not yet enriched — discovery lag unavailable.</p>
          )}
          <p>
            Current stars:{" "}
            <strong className="text-[var(--ink)]">{formatNumber(repository.stars)}</strong>
          </p>
        </div>
      </section>
    </>
  );
}

function SectionPlaceholder({ label }: { label: string }) {
  return (
    <p className="border border-dashed border-[var(--rule)] px-4 py-8 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
      {label}
    </p>
  );
}
