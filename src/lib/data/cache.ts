import { cacheLife, cacheTag } from "next/cache";

export const CACHE_TAGS = ["radar", "stats", "catalog", "repo"] as const;
export type CacheTag = (typeof CACHE_TAGS)[number];

export function toPlain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? Number(inner) : inner
    )
  ) as T;
}

/** Call only inside a `'use cache'` function. */
export function cacheReadModel(
  scope: Exclude<CacheTag, "radar">,
  profile: "minutes" | "hours" | "search" = "minutes"
) {
  cacheTag("radar", scope);
  if (profile === "hours") {
    cacheLife("hours");
  } else if (profile === "search") {
    cacheLife("hours");
  } else {
    cacheLife("minutes");
  }
}
