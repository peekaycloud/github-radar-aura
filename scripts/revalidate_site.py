"""Ask the Next.js app to drop its tagged Data Cache after a pipeline run.

Uses only the existing deployment — no Redis or extra paid cache.
Set APP_URL + REVALIDATE_SECRET (GitHub Actions secrets and Vercel env).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

DEFAULT_TAGS = ["radar", "stats", "catalog", "repo"]
WARM_PATHS = (
    "/",
    "/trending",
    "/hidden-gems",
    "/ahead-of-curve",
    "/timeline",
    "/trends",
    "/repositories",
)


def revalidate_site(tags: list[str] | None = None) -> None:
    base = (os.getenv("APP_URL") or "").rstrip("/")
    secret = os.getenv("REVALIDATE_SECRET") or ""
    if not base or not secret:
        print("Skipping site cache revalidation (APP_URL / REVALIDATE_SECRET not set)")
        return

    url = f"{base}/api/revalidate"
    body = json.dumps({"tags": tags or DEFAULT_TAGS}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode()
            print(f"Revalidated {url}: {payload}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode() if exc.fp else ""
        raise SystemExit(f"Revalidate failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Revalidate failed: {exc}") from exc

    warm_site(base)


def warm_site(base: str) -> None:
    """Fill Data Cache so the next visitor is not the cold-start guinea pig."""
    for path in WARM_PATHS:
        url = f"{base}{path}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "github-radar-cache-warm"},
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                resp.read()
                print(f"Warmed {url}: {resp.status}")
        except Exception as exc:  # noqa: BLE001 — warming must not fail the pipeline
            print(f"Warm {url} failed: {exc}")


def main() -> None:
    extra = [t for t in sys.argv[1:] if t]
    revalidate_site(extra or None)


if __name__ == "__main__":
    main()
