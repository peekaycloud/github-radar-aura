import { EmptyState, RepoCard, SectionRule } from "@/components/repo-card";
import { cacheReadModel } from "@/lib/data/cache";
import { getCategories, getLanguages, searchRepositories } from "@/lib/queries";
import Link from "next/link";
import { Suspense } from "react";

export const preferredRegion = "sin1";

type SearchFields = {
  q?: string;
  language?: string;
  category?: string;
  minStars?: string;
  page?: string;
};

export default function Page({
  searchParams,
}: {
  searchParams: Promise<SearchFields>;
}) {
  return (
    <div className="space-y-8">
      <SectionRule title="Repositories" kicker="Catalog" />
      <Suspense fallback={<CatalogFallback />}>
        <CatalogGate searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CatalogGate({
  searchParams,
}: {
  searchParams: Promise<SearchFields>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1) || 1);
  return (
    <CachedCatalog
      q={params.q?.trim() ?? ""}
      language={params.language ?? ""}
      category={params.category ?? ""}
      minStars={params.minStars ?? ""}
      page={page}
    />
  );
}

async function CachedCatalog({
  q,
  language,
  category,
  minStars,
  page,
}: {
  q: string;
  language: string;
  category: string;
  minStars: string;
  page: number;
}) {
  "use cache";
  cacheReadModel("catalog", "hours");
  const limit = 40;
  const [rows, languages, categories] = await Promise.all([
    searchRepositories({
      q: q || undefined,
      language: language || undefined,
      category: category || undefined,
      minStars: minStars ? Number(minStars) : undefined,
      limit,
      offset: (page - 1) * limit,
    }),
    getLanguages(),
    getCategories(),
  ]);

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (language) qs.set("language", language);
  if (category) qs.set("category", category);
  if (minStars) qs.set("minStars", minStars);

  return (
    <>
      <form
        action="/repositories"
        method="get"
        className="grid gap-3 border border-[var(--rule)] bg-[var(--paper-elevated)] p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, owner, description…"
          className="border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 font-sans text-sm outline-none focus:border-[var(--ink)] lg:col-span-2"
        />
        <select
          name="language"
          defaultValue={language}
          className="border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 font-sans text-sm"
        >
          <option value="">All languages</option>
          {languages.map((l) => (
            <option key={l.language} value={l.language}>
              {l.language} ({l.count})
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={category}
          className="border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 font-sans text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 font-sans text-[11px] uppercase tracking-[0.14em] text-[var(--paper)]"
        >
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState message="No repositories matched these filters." />
      ) : (
        <div>
          {rows.map((repo) => (
            <RepoCard key={repo.repository_id} repo={repo} />
          ))}
        </div>
      )}

      <div className="flex justify-between font-sans text-xs uppercase tracking-[0.12em]">
        {page > 1 ? (
          <Link href={`/repositories?${qs.toString()}&page=${page - 1}`}>← Previous</Link>
        ) : (
          <span />
        )}
        {rows.length === limit ? (
          <Link href={`/repositories?${qs.toString()}&page=${page + 1}`}>Next →</Link>
        ) : null}
      </div>
    </>
  );
}

function CatalogFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-24 border border-[var(--rule)] bg-[var(--paper-elevated)]" />
      <div className="space-y-3 border-t-2 border-[var(--rule-strong)] pt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-2"
          >
            <div className="h-4 w-2/5 bg-[var(--rule)]/50" />
            <div className="h-4 w-16 bg-[var(--rule)]/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
