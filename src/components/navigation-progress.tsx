"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function isInternalNavigation(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = (event.target as HTMLElement | null)?.closest("a");
  if (!target) return false;
  const href = target.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  if (target.target && target.target !== "_self") return false;
  if (target.hasAttribute("download")) return false;
  let url: URL;
  try {
    url = new URL(target.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return false;
  }
  return true;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setActive(false);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }, [pathname, searchParams]);

  useEffect(() => {
    const start = () => {
      setActive(true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setActive(false), 12000);
    };

    const onClick = (event: MouseEvent) => {
      if (isInternalNavigation(event)) start();
    };

    const onSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.method.toLowerCase() !== "get") return;
      const action = form.getAttribute("action") || window.location.pathname;
      try {
        const url = new URL(action, window.location.href);
        if (url.origin === window.location.origin) start();
      } catch {
        /* ignore */
      }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] overflow-hidden"
      aria-hidden={!active}
    >
      <div
        className={
          active
            ? "h-full origin-left bg-[var(--signal)] transition-none nav-progress-run"
            : "h-full w-0 bg-[var(--signal)]"
        }
      />
    </div>
  );
}
