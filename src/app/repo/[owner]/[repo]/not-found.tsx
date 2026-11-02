import Link from "next/link";

export default function RepoNotFound() {
  return (
    <div className="space-y-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--signal)]">
        Not found
      </p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Repository not in the radar</h1>
      <p className="max-w-xl font-sans text-sm text-[var(--ink-muted)]">
        This repo is not in the discovery archive yet, or the link was malformed.
      </p>
      <p>
        <Link
          href="/repositories"
          className="font-sans text-xs uppercase tracking-[0.14em] text-[var(--signal)] hover:underline"
        >
          Back to repositories →
        </Link>
      </p>
    </div>
  );
}
