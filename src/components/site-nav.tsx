"use client";

import { AppLink } from "@/components/app-link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Radar" },
  { href: "/timeline", label: "Discoveries" },
  { href: "/trending", label: "Trending" },
  { href: "/hidden-gems", label: "Hidden Gems" },
  { href: "/trends", label: "Trends" },
];

export function SiteNav() {
  const path = usePathname();

  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--rule)] pt-2.5">
      {NAV.map((item) => {
        const active =
          item.href === "/"
            ? path === "/"
            : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <AppLink
            key={item.href}
            href={item.href}
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
              active
                ? "text-[var(--signal)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            )}
          >
            {item.label}
          </AppLink>
        );
      })}
      <AppLink
        href="/ahead-of-curve"
        className={cn(
          "ml-auto font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
          path.startsWith("/ahead-of-curve")
            ? "text-[var(--signal)]"
            : "text-[var(--ink-faint)] hover:text-[var(--signal)]"
        )}
      >
        Ahead of Curve →
      </AppLink>
    </nav>
  );
}

export function SiteNavFallback() {
  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--rule)] pt-2.5">
      {NAV.map((item) => (
        <AppLink
          key={item.href}
          href={item.href}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]"
        >
          {item.label}
        </AppLink>
      ))}
      <AppLink
        href="/ahead-of-curve"
        className="ml-auto font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ink-faint)]"
      >
        Ahead of Curve →
      </AppLink>
    </nav>
  );
}
