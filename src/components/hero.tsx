import Link from "next/link";
import type { DiscoveryRow } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { repoPath } from "@/lib/repo-path";

export type HeroKpi = { label: string; value: string; hint?: string };

const SWEEP_SECONDS = 7;

type Blip = {
  key: string;
  name: string;
  href: string | null;
  x: number;
  y: number;
  delay: number;
  label: boolean;
  right: boolean;
};

/** Position discoveries on the radar: angle = golden-angle spread, distance = days from creation to discovery. */
function buildBlips(rows: DiscoveryRow[]): Blip[] {
  return rows.slice(0, 12).map((row, i) => {
    const name = row.full_name || `${row.owner}/${row.repo_name}`;
    const angle = (i * 137.508 + 18) % 360;
    const lag = Math.min(Math.max(Number(row.days_to_discovery ?? 5), 0), 14);
    const radius = 0.3 + Math.min(lag / 9, 1) * 0.5 + ((i * 0.37) % 1) * 0.1;
    const rad = (angle * Math.PI) / 180;
    const x = 50 + Math.sin(rad) * radius * 50;
    const y = 50 - Math.cos(rad) * radius * 50;
    // Flash when the sweep's leading edge crosses this angle.
    const delay = (angle / 360) * SWEEP_SECONDS - SWEEP_SECONDS;
    return {
      key: row.repository_id,
      name,
      href: repoPath(row.owner, row.repo_name),
      x,
      y,
      delay,
      label: i < 7,
      right: x < 56,
    };
  });
}

function RadarPanel({ rows }: { rows: DiscoveryRow[] }) {
  const blips = buildBlips(rows);

  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      {/* offset “print” shadow keeps the editorial feel */}
      <div
        aria-hidden
        className="absolute inset-0 translate-x-2.5 translate-y-2.5 border-2 border-[var(--ink)]"
      />
      <div className="hero-radar-panel relative aspect-square overflow-hidden border-2 border-[var(--ink)] bg-[var(--ink)]">
        {/* grid */}
        <div aria-hidden className="hero-radar-grid absolute inset-0" />

        {/* rings + crosshair */}
        <div aria-hidden className="absolute inset-[6%]">
          {[100, 74, 48, 22].map((size) => (
            <div
              key={size}
              className="absolute left-1/2 top-1/2 rounded-full border border-[rgba(232,235,228,0.2)]"
              style={{
                width: `${size}%`,
                height: `${size}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}
          <div className="absolute left-1/2 top-0 h-full w-px bg-[rgba(232,235,228,0.14)]" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-[rgba(232,235,228,0.14)]" />
        </div>

        {/* sweep */}
        <div
          aria-hidden
          className="hero-radar-sweep absolute inset-[6%] rounded-full"
          style={{ animationDuration: `${SWEEP_SECONDS}s` }}
        >
          <div className="absolute left-1/2 top-0 h-1/2 w-[2px] -translate-x-1/2 bg-[#ff4650] shadow-[0_0_14px_3px_rgba(255,70,80,0.55)]" />
        </div>

        {/* centre pip */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)]"
        />

        {/* blips */}
        <div className="absolute inset-[6%]">
          {blips.map((b) => {
            const dot = (
              <>
                <span
                  className="hero-blip absolute left-0 top-0 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)]"
                  style={{
                    animationDuration: `${SWEEP_SECONDS}s`,
                    animationDelay: `${b.delay}s`,
                  }}
                />
                {b.label ? (
                  <span
                    className={`hero-blip-label pointer-events-none absolute top-0 hidden -translate-y-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--paper)] sm:block ${
                      b.right ? "left-3.5" : "right-3.5"
                    }`}
                    style={{
                      animationDuration: `${SWEEP_SECONDS}s`,
                      animationDelay: `${b.delay}s`,
                    }}
                  >
                    {b.name.split("/")[1]?.slice(0, 16) ?? b.name}
                  </span>
                ) : null}
              </>
            );
            const style = { left: `${b.x}%`, top: `${b.y}%` };
            return b.href ? (
              <Link
                key={b.key}
                href={b.href}
                aria-label={b.name}
                className="absolute block h-5 w-5 -translate-x-1/2 -translate-y-1/2"
                style={style}
              >
                <span className="absolute left-1/2 top-1/2">{dot}</span>
              </Link>
            ) : (
              <span key={b.key} className="absolute" style={style}>
                {dot}
              </span>
            );
          })}
        </div>

        {/* compass */}
        {[
          ["N", "left-1/2 top-1.5 -translate-x-1/2"],
          ["E", "right-2 top-1/2 -translate-y-1/2"],
          ["S", "bottom-1.5 left-1/2 -translate-x-1/2"],
          ["W", "left-2 top-1/2 -translate-y-1/2"],
        ].map(([label, pos]) => (
          <span
            key={label}
            aria-hidden
            className={`absolute font-mono text-[9px] tracking-[0.2em] text-[rgba(232,235,228,0.45)] ${pos}`}
          >
            {label}
          </span>
        ))}

        {/* HUD */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--paper)]">
          <span className="hero-live-dot h-1.5 w-1.5 rounded-full bg-[#ff4650]" />
          Scanning
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-[rgba(232,235,228,0.55)]">
          {blips.length} signals in range
          <br />
          centre = fresh · edge = late
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[rgba(232,235,228,0.55)]">
          Δ {SWEEP_SECONDS}s sweep
        </div>
      </div>
    </div>
  );
}

function Ticker({ rows }: { rows: DiscoveryRow[] }) {
  if (rows.length === 0) return null;
  const items = rows.map((row) => ({
    key: row.repository_id,
    name: row.full_name || `${row.owner}/${row.repo_name}`,
    stars: row.stars,
    href: repoPath(row.owner, row.repo_name),
  }));
  const loop = [...items, ...items];

  return (
    <div className="flex items-stretch border-y-2 border-[var(--ink)] bg-[var(--paper-elevated)]">
      <div className="z-10 flex shrink-0 items-center gap-2 bg-[var(--ink)] px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--paper)]">
        <span className="hero-live-dot h-1.5 w-1.5 rounded-full bg-[#ff4650]" />
        Just spotted
      </div>
      <div className="hero-ticker-mask relative min-w-0 flex-1 overflow-hidden">
        <div className="hero-ticker flex w-max items-center gap-10 py-2.5 pl-6">
          {loop.map((item, i) => {
            const body = (
              <>
                <span className="font-serif text-sm font-semibold text-[var(--ink)]">
                  {item.name}
                </span>
                {item.stars != null ? (
                  <span className="ml-2 font-mono text-[11px] tabular-nums text-[var(--signal)]">
                    ★ {formatNumber(item.stars)}
                  </span>
                ) : null}
              </>
            );
            return item.href ? (
              <Link
                key={`${item.key}-${i}`}
                href={item.href}
                className="shrink-0 whitespace-nowrap hover:underline decoration-[var(--signal)] underline-offset-2"
              >
                {body}
              </Link>
            ) : (
              <span key={`${item.key}-${i}`} className="shrink-0 whitespace-nowrap">
                {body}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Hero({
  kpis,
  discoveries,
}: {
  kpis: HeroKpi[];
  discoveries: DiscoveryRow[];
}) {
  return (
    <section className="-mt-4">
      <div className="grid items-center gap-10 py-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14 lg:py-10">
        <div>
          <p className="animate-masthead flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--signal)]">
            <span className="hero-live-dot h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
            Live · Telegram × GitHub
          </p>

          <h1
            className="animate-masthead mt-4 font-serif text-[2.9rem] font-semibold leading-[0.98] tracking-tight text-[var(--ink)] sm:text-6xl lg:text-[4.6rem]"
            style={{ animationDelay: "0.08s" }}
          >
            Spot the repo
            <br />
            <span className="relative inline-block italic text-[var(--signal)]">
              before it trends.
              <svg
                aria-hidden
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                className="absolute -bottom-1.5 left-0 h-2.5 w-full"
              >
                <path
                  className="hero-scribble"
                  d="M2 8 C 50 2, 90 11, 150 6 S 250 3, 298 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  pathLength={1}
                />
              </svg>
            </span>
          </h1>

          <p
            className="animate-masthead mt-6 max-w-xl font-sans text-base leading-relaxed text-[var(--ink-muted)] sm:text-lg"
            style={{ animationDelay: "0.16s" }}
          >
            We listen to the channels where developers share what&rsquo;s new,
            then track every repo&rsquo;s stars to prove who found it first
            &mdash; and how early they were.
          </p>

          <div
            className="animate-masthead mt-7 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "0.24s" }}
          >
            <Link
              href="/timeline"
              className="group inline-flex items-center gap-2 border-2 border-[var(--ink)] bg-[var(--ink)] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--paper)] shadow-[4px_4px_0_var(--signal)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_var(--signal)]"
            >
              Open today&rsquo;s radar
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/knowledge-graph"
              className="inline-flex items-center gap-2 border-2 border-[var(--ink)] bg-transparent px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
            >
              Explore the graph
            </Link>
            <Link
              href="/hidden-gems"
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)] underline decoration-[var(--signal)] decoration-2 underline-offset-4 hover:text-[var(--signal)]"
            >
              Hidden gems
            </Link>
          </div>

          <div
            className="animate-masthead mt-9 grid grid-cols-2 gap-px border-2 border-[var(--ink)] bg-[var(--ink)] sm:grid-cols-4"
            style={{ animationDelay: "0.32s" }}
          >
            {kpis.slice(0, 4).map((k) => (
              <div key={k.label} className="bg-[var(--paper-elevated)] px-3 py-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
                  {k.label}
                </p>
                <p className="mt-1 font-serif text-2xl font-semibold tabular-nums leading-none text-[var(--ink)]">
                  {k.value}
                </p>
                {k.hint ? (
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    {k.hint}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="animate-masthead" style={{ animationDelay: "0.2s" }}>
          <RadarPanel rows={discoveries} />
        </div>
      </div>

      <Ticker rows={discoveries} />
    </section>
  );
}
