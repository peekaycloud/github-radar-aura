import Link from "next/link";
import { Suspense } from "react";
import { SiteNav, SiteNavFallback } from "@/components/site-nav";

export const SOURCE_REPO_URL = "https://github.com/peekaycloud/github-radar";

export function SiteHeader() {
  return (
    <header className="border-b-2 border-[var(--rule-strong)] bg-[var(--paper)]/95 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="group inline-block">
              <p className="font-serif text-2xl font-semibold leading-none tracking-tight text-[var(--ink)] sm:text-3xl">
                GITHUB{" "}
                <span className="relative inline-block">
                  RADAR
                  <span className="absolute -bottom-1 left-0 h-[2px] w-full bg-[var(--signal)]" />
                </span>
              </p>
            </Link>
            <p className="mt-1.5 font-sans text-sm text-[var(--ink-muted)]">
              Open-source projects worth watching.
            </p>
          </div>
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
            <a
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--signal)] hover:underline"
            >
              ★ Star on GitHub
            </a>
            <form action="/repositories" method="get" className="w-full sm:w-56">
              <input
                type="search"
                name="q"
                placeholder="Search archive…"
                className="w-full border border-[var(--rule-strong)] bg-[var(--paper-elevated)] px-3 py-1.5 font-sans text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--signal)]"
              />
            </form>
          </div>
        </div>
        <Suspense fallback={<SiteNavFallback />}>
          <SiteNav />
        </Suspense>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-[var(--rule-strong)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-7 font-sans text-xs text-[var(--ink-muted)] sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="space-y-1">
          <p className="font-medium tracking-wide text-[var(--ink)]">GitHub Radar</p>
          <p>Discovery intelligence · Telegram × GitHub</p>
        </div>
        <p className="max-w-sm sm:text-right">
          This site is open source.{" "}
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-4 hover:text-[var(--signal)] hover:decoration-[var(--signal)]"
          >
            Read the original code
          </a>{" "}
          and star the repo if Radar is useful.
        </p>
      </div>
    </footer>
  );
}
