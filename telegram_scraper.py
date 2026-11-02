"""Daily Telegram → Supabase → GitHub enrichment entrypoint.

Scrapes one or more Telegram channels (default: githubtrending, github_repos,
github_repositories_bds). Repositories are deduplicated by github_url.

Usage:
  python telegram_scraper.py
  python telegram_scraper.py --dry-run
  python telegram_scraper.py --channels github_repos,github_repositories_bds
  python telegram_scraper.py --backfill-missing
  python telegram_scraper.py --skip-enrich --enrich-limit 80
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")


def channel_has_watermark(channel: str) -> bool:
    from scripts.db import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT last_telegram_message_id, last_posted_at
                FROM ingestion_state
                WHERE channel = %s
                """,
                (channel,),
            )
            row = cur.fetchone()
            if row and (row["last_posted_at"] or row["last_telegram_message_id"]):
                return True
            cur.execute(
                """
                SELECT 1 FROM telegram_posts
                WHERE source_channel = %s
                LIMIT 1
                """,
                (channel,),
            )
            return cur.fetchone() is not None


async def run_pipeline(
    *,
    dry_run: bool,
    skip_enrich: bool,
    enrich_limit: int,
    channels: list[str],
    backfill_missing: bool,
) -> None:
    from scripts.backfill_telegram_history import backfill
    from scripts.telegram_ingest import ingest

    batch_size = int(os.getenv("INGEST_BATCH_SIZE", "100"))

    print(f"=== 1/3 Telegram ingest ({len(channels)} channel(s)) ===")
    mentioned_ids: list[str] = []
    for channel in channels:
        needs_backfill = backfill_missing and not channel_has_watermark(channel)
        if needs_backfill:
            print(f"\n--- Backfill full history: @{channel} ---")
            await backfill(
                channel=channel,
                dry_run=dry_run,
                limit=None,
                batch_size=max(batch_size, 250),
            )
        else:
            print(f"\n--- Delta ingest: @{channel} ---")
            mentioned_ids.extend(
                await ingest(dry_run=dry_run, batch_size=batch_size, channel=channel)
            )

    if dry_run or skip_enrich:
        print("\nSkipping enrichment.")
        if not dry_run:
            print("\n=== Refreshing read models ===")
            from scripts.refresh_read_models import refresh_read_models

            refresh_read_models()
        return

    print("\n=== 2/3 GitHub public-page enrichment ===")
    from scripts.github_enricher import run_enrichment

    await run_enrichment(
        limit=enrich_limit, dry_run=False, prefer_ids=mentioned_ids or None
    )

    print("\n=== 3/3 Category classification ===")
    from scripts.classify_categories import run as classify_run

    classify_run(limit=max(enrich_limit * 2, 200), dry_run=False)
    print("\n=== Refreshing read models ===")
    from scripts.refresh_read_models import refresh_read_models

    refresh_read_models()
    print("\nPipeline complete.")


def main() -> None:
    from scripts.channels import parse_channels

    parser = argparse.ArgumentParser(
        description="Delta scrape Telegram channels, upsert Supabase, enrich GitHub metadata"
    )
    parser.add_argument("--dry-run", action="store_true", help="Scan only; no DB writes")
    parser.add_argument("--skip-enrich", action="store_true", help="Ingest only")
    parser.add_argument(
        "--channels",
        default=None,
        help="Comma-separated channel usernames (default: TELEGRAM_CHANNELS or built-in list)",
    )
    parser.add_argument(
        "--backfill-missing",
        action="store_true",
        help="Full-history backfill for channels with no watermark yet",
    )
    parser.add_argument(
        "--enrich-limit",
        type=int,
        default=int(os.getenv("ENRICH_BATCH_SIZE", "80")),
        help="Max repos to enrich this run",
    )
    args = parser.parse_args()
    channels = parse_channels(args.channels)
    print("Channels:", ", ".join(f"@{c}" for c in channels))
    asyncio.run(
        run_pipeline(
            dry_run=args.dry_run,
            skip_enrich=args.skip_enrich,
            enrich_limit=args.enrich_limit,
            channels=channels,
            backfill_missing=args.backfill_missing,
        )
    )


if __name__ == "__main__":
    main()
