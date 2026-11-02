export function PageLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--signal)]">
        Loading…
      </p>
      <div className="grid grid-cols-2 gap-px border-2 border-[var(--rule-strong)] bg-[var(--rule-strong)] sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--paper)] px-3 py-4">
            <div className="h-2 w-12 bg-[var(--rule)]/70" />
            <div className="mt-2 h-6 w-16 bg-[var(--rule)]/50" />
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t-2 border-[var(--rule-strong)] pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-2">
            <div className="h-4 w-2/5 bg-[var(--rule)]/50" />
            <div className="h-4 w-16 bg-[var(--rule)]/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
