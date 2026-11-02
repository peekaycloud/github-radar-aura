import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CACHE_TAGS, type CacheTag } from "@/lib/data/cache";

function authorized(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "REVALIDATE_SECRET is not set" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let requested: string[] = [...CACHE_TAGS];
  try {
    const body = (await request.json()) as { tags?: unknown };
    if (Array.isArray(body.tags) && body.tags.length > 0) {
      const allowed = new Set<string>(CACHE_TAGS);
      requested = body.tags.filter((tag): tag is CacheTag => typeof tag === "string" && allowed.has(tag));
    }
  } catch {
    // empty body → flush all radar tags
  }

  if (requested.length === 0) {
    requested = [...CACHE_TAGS];
  }

  for (const tag of requested) {
    revalidateTag(tag, "max");
  }

  return NextResponse.json({ revalidated: requested });
}
