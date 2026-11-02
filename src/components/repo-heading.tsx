import { formatDate, formatNumber } from "@/lib/format";
import type { RepoPreview } from "@/lib/repo-preview";

export function RepoHeading({
  repository,
  owner,
  repo,
}: {
  repository: RepoPreview;
  owner: string;
  repo: string;
}) {
  const name = repository.full_name || `${owner}/${repo}`;

  return (
    <>
      <header className="border-b border-[var(--rule)] pb-8">
        <p className="font-sans text-[11px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          Repository
        </p>
        <h1 className="mt-2 font-serif text-4xl text-[var(--ink)] sm:text-5xl">{name}</h1>
        {repository.description ? (
          <p className="mt-4 max-w-3xl font-sans text-base leading-relaxed text-[var(--ink-muted)]">
            {repository.description}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-4 font-sans text-sm text-[var(--ink-muted)]">
          <a
            href={repository.github_url || `https://github.com/${owner}/${repo}`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--ink)]"
          >
            View on GitHub
          </a>
          <span>★ {formatNumber(repository.stars)}</span>
          <span>⑂ {formatNumber(repository.forks)}</span>
          {repository.language ? <span>{repository.language}</span> : null}
          {repository.license ? <span>{repository.license}</span> : null}
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-3">
        <Meta
          label="Repository age"
          value={
            repository.created_at_github
              ? `Since ${formatDate(repository.created_at_github)}`
              : "Unknown"
          }
        />
        <Meta label="Last activity" value={formatDate(repository.pushed_at_github)} />
        <Meta
          label="Early discovery"
          value={
            repository.days_to_discovery != null
              ? `${Math.round(repository.days_to_discovery)}d after creation`
              : "—"
          }
        />
      </section>
    </>
  );
}

export function RepoMeta({ label, value }: { label: string; value: string }) {
  return <Meta label={label} value={value} />;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--rule)] bg-[var(--paper-elevated)] px-4 py-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        {label}
      </p>
      <p className="mt-2 font-serif text-lg text-[var(--ink)]">{value}</p>
    </div>
  );
}
