"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { GraphEdge, GraphNode, KnowledgeGraphData } from "@/lib/data/graph";
import { repoPath } from "@/lib/repo-path";
import { cn } from "@/lib/utils";

type SimNode = SimulationNodeDatum &
  GraphNode & {
    x: number;
    y: number;
  };

type SimLink = SimulationLinkDatum<SimNode> & {
  kind: GraphEdge["kind"];
  weight: number;
};

const WIDTH = 920;
const HEIGHT = 520;
const SIM_TICKS = 220;

function nodeRadius(node: GraphNode): number {
  if (node.kind === "category") return 10;
  if (node.kind === "language") return 8;
  const mentions = node.mention_count ?? 1;
  return 6 + Math.min(14, Math.log2(mentions + 1) * 3);
}

function nodeFill(kind: GraphNode["kind"], active: boolean): string {
  if (kind === "category") return active ? "var(--signal)" : "#c45c4a";
  if (kind === "language") return active ? "var(--ink)" : "#8a8478";
  return active ? "var(--signal)" : "var(--ink-muted)";
}

function layoutGraph(data: KnowledgeGraphData): {
  nodes: SimNode[];
  links: SimLink[];
} {
  const simNodes: SimNode[] = data.nodes.map((n, i) => ({
    ...n,
    x: WIDTH / 2 + Math.cos((i / Math.max(data.nodes.length, 1)) * Math.PI * 2) * 160,
    y: HEIGHT / 2 + Math.sin((i / Math.max(data.nodes.length, 1)) * Math.PI * 2) * 120,
  }));
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = data.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({
      source: byId.get(e.source)!,
      target: byId.get(e.target)!,
      kind: e.kind,
      weight: e.weight,
    }));

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.kind === "co-mention" ? 88 : 52))
        .strength((l) => (l.kind === "co-mention" ? 0.12 + l.weight * 0.03 : 0.3))
    )
    .force("charge", forceManyBody().strength(-90))
    .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => nodeRadius(d) + 5)
    )
    .stop();

  for (let i = 0; i < SIM_TICKS; i += 1) {
    sim.tick();
  }

  return { nodes: simNodes, links: simLinks };
}

export function KnowledgeGraphView({ data }: { data: KnowledgeGraphData }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");

  const { nodes, links } = useMemo(() => layoutGraph(data), [data]);

  const nodeMap = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n])),
    [data.nodes]
  );

  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const related = new Set<string>([focusId]);
    for (const l of links) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (s.id === focusId) related.add(t.id);
      if (t.id === focusId) related.add(s.id);
    }
    return related;
  }, [focusId, links]);

  const topLinks = useMemo(
    () =>
      [...data.edges]
        .filter((e) => e.kind === "co-mention")
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 16),
    [data.edges]
  );

  const repoNodes = useMemo(
    () =>
      [...data.nodes]
        .filter((n) => n.kind === "repo")
        .sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0)),
    [data.nodes]
  );

  if (data.nodes.length === 0) {
    return (
      <p className="font-sans text-sm text-[var(--ink-muted)]">
        Not enough recent Telegram links yet to draw a graph. Run ingest or widen
        the time window after more posts arrive.
      </p>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <div className="border border-[var(--rule-strong)] bg-[var(--paper-elevated)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rule)] px-4 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            Static layout · use list on mobile
          </p>
          <div className="flex gap-1">
            {(["graph", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                  view === mode
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--rule)] text-[var(--ink-muted)] hover:border-[var(--ink)]"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {view === "graph" ? (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="hidden h-auto w-full sm:block"
            role="img"
            aria-label="Knowledge graph of repositories and categories"
          >
            <rect width={WIDTH} height={HEIGHT} fill="var(--paper)" />
            {links.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              const dim =
                focusSet &&
                !focusSet.has(s.id) &&
                !focusSet.has(t.id);
              const opacity = dim ? 0.06 : l.kind === "co-mention" ? 0.4 : 0.22;
              return (
                <line
                  key={`${s.id}-${t.id}-${i}`}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={l.kind === "co-mention" ? "var(--signal)" : "var(--rule-strong)"}
                  strokeWidth={l.kind === "co-mention" ? 1 + Math.min(3, l.weight) : 1}
                  strokeOpacity={opacity}
                />
              );
            })}
            {nodes.map((n) => {
              const active = !focusSet || focusSet.has(n.id);
              const r = nodeRadius(n);
              const href =
                n.kind === "repo" ? repoPath(n.owner, n.repo) : undefined;
              const g = (
                <>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={nodeFill(n.kind, focusId === n.id)}
                    fillOpacity={active ? 0.9 : 0.18}
                    stroke="var(--ink)"
                    strokeWidth={focusId === n.id ? 1.5 : 0.5}
                    strokeOpacity={active ? 0.35 : 0.08}
                  />
                  {n.kind === "repo" && (
                    <text
                      x={n.x}
                      y={n.y + r + 10}
                      textAnchor="middle"
                      className="fill-[var(--ink-muted)] font-mono text-[9px]"
                      opacity={active ? 1 : 0.2}
                      pointerEvents="none"
                    >
                      {n.label.split("/").pop()?.slice(0, 16)}
                    </text>
                  )}
                </>
              );
              if (href) {
                return (
                  <Link key={n.id} href={href} aria-label={n.label}>
                    <g className="cursor-pointer">{g}</g>
                  </Link>
                );
              }
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  onClick={() => setFocusId(focusId === n.id ? null : n.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={n.label}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setFocusId(focusId === n.id ? null : n.id);
                    }
                  }}
                >
                  {g}
                </g>
              );
            })}
          </svg>
        ) : null}

        <ul
          className={cn(
            "max-h-[520px] divide-y divide-[var(--rule)] overflow-y-auto px-4 py-2",
            view === "graph" ? "sm:hidden" : "block"
          )}
        >
          {repoNodes.map((n) => {
            const href = repoPath(n.owner, n.repo);
            if (!href) return null;
            return (
              <li key={n.id}>
                <Link
                  href={href}
                  className="flex items-baseline justify-between gap-3 py-2 font-sans text-sm hover:text-[var(--signal)]"
                >
                  <span className="min-w-0 truncate">{n.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--ink-muted)]">
                    {n.mention_count ?? 0} mentions
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-4 border-t border-[var(--rule)] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--ink-muted)]" />
            Repo
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#c45c4a]" />
            Category
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#8a8478]" />
            Language
          </span>
          <span className="text-[var(--signal)]">— Co-mentioned on Telegram</span>
        </div>
      </div>

      <aside className="space-y-6">
        <section>
          <h3 className="border-b border-[var(--rule)] pb-2 font-serif text-lg">
            Strongest links
          </h3>
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto font-sans text-sm">
            {topLinks.map((e) => {
              const a = nodeMap.get(e.source);
              const b = nodeMap.get(e.target);
              if (!a || !b) return null;
              return (
                <li key={`${e.source}-${e.target}`} className="leading-snug">
                  <button
                    type="button"
                    className="text-left hover:text-[var(--signal)]"
                    onClick={() => setFocusId(e.source)}
                  >
                    {a.label}
                  </button>
                  <span className="text-[var(--ink-faint)]"> ↔ </span>
                  <button
                    type="button"
                    className="text-left hover:text-[var(--signal)]"
                    onClick={() => setFocusId(e.target)}
                  >
                    {b.label}
                  </button>
                  <span className="ml-1 font-mono text-[10px] text-[var(--ink-muted)]">
                    ×{e.weight}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h3 className="border-b border-[var(--rule)] pb-2 font-serif text-lg">
            Explore
          </h3>
          <p className="mt-2 font-sans text-xs leading-relaxed text-[var(--ink-muted)]">
            Open a repo from the list or graph. Tap a link here to highlight its
            neighborhood. Data spans the last 120 days of channel mentions.
          </p>
          {focusId && (
            <button
              type="button"
              className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--signal)]"
              onClick={() => setFocusId(null)}
            >
              Clear focus
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}
