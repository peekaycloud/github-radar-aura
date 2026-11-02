"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { toRepoPreview, type RepoPreview } from "@/lib/repo-preview";
import type { DiscoveryRow } from "@/lib/db";

const STORAGE_KEY = "radar:repo-preview";

let lastPreview: RepoPreview | null = null;

export function rememberRepoPreview(preview: RepoPreview) {
  lastPreview = preview;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preview));
  } catch {
    /* private mode / quota */
  }
}

export function readRepoPreview(): RepoPreview | null {
  if (lastPreview) return lastPreview;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RepoPreview) : null;
  } catch {
    return null;
  }
}

type RepoLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  repo?: DiscoveryRow | RepoPreview;
};

/** Prefetches on hover and stashes card data so the next page can paint immediately. */
export function RepoLink({ repo, onPointerEnter, onPointerDown, ...props }: RepoLinkProps) {
  const router = useRouter();
  const href = typeof props.href === "string" ? props.href : null;

  return (
    <Link
      {...props}
      prefetch={true}
      onPointerEnter={(event) => {
        if (href) router.prefetch(href);
        onPointerEnter?.(event);
      }}
      onPointerDown={(event) => {
        if (repo) rememberRepoPreview(toRepoPreview(repo));
        onPointerDown?.(event);
      }}
    />
  );
}
