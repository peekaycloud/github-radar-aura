import { EmptyState, RepoCard, SectionRule } from "@/components/repo-card";
import { PageShell } from "@/components/page-shell";
import { TimelineBars } from "@/components/charts";
import { cacheReadModel } from "@/lib/data/cache";
import { formatDate, getReposForDate, getTimeline } from "@/lib/queries";
import Link from "next/link";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  return (
    <PageShell>
      <TimelinePage searchParams={searchParams} />
    </PageShell>
  );
}

async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  return <CachedTimeline date={params.date ?? ""} />;
}

async function CachedTimeline({ date }: { date: string }) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const timeline = await getTimeline(45);
  const selected = date || timeline[0]?.discovery_date;
  const dayRepos = selected ? await getReposForDate(selected) : [];

  return (
    <div className="space-y-10">
      <SectionRule title="Discoveries" kicker="Day-by-day archive" />
      <p className="max-w-2xl font-sans text-sm text-[var(--ink-muted)]">
        Each day is a dispatch from the channels — repositories first seen on
        that date.
      </p>

      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="border border-[var(--rule)] bg-[var(--paper-elevated)] p-4">
          <TimelineBars data={timeline.slice(0, 30)} />
          <ul className="mt-6 max-h-[28rem] space-y-2 overflow-y-auto border-t border-[var(--rule)] pt-4">
            {timeline.map((d) => (
              <li key={d.discovery_date}>
                <Link
                  href={`/timeline?date=${d.discovery_date}`}
                  className={
                    selected === d.discovery_date
                      ? "flex justify-between font-sans text-sm text-[var(--signal)]"
                      : "flex justify-between font-sans text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }
                >
                  <span className="uppercase tracking-[0.08em]">
                    {formatDate(d.discovery_date)}
                  </span>
                  <span className="tabular-nums">
                    {d.repositories_discovered} repositories
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 font-serif text-2xl">
            {selected ? formatDate(selected) : "Select a date"}
          </h3>
          {dayRepos.length === 0 ? (
            <EmptyState message="No repositories for this date." />
          ) : (
            <div>
              {dayRepos.map((repo) => (
                <RepoCard key={repo.repository_id} repo={repo} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
