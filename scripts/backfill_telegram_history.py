"""Walk full Telegram channel history and backfill message metadata.

Use when CSV lacks message_id / posted_at, or to reconcile history.
Idempotent upserts into telegram_posts / repositories / mentions.
Streams in batches so large channels do not require loading all messages first.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import timezone
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

from scripts.db import get_connection  # noqa: E402
from scripts.github_url import extract_github_urls, normalize_github_url  # noqa: E402
from scripts.import_historical import (  # noqa: E402
    update_ingestion_state,
    upsert_mention,
    upsert_post,
    upsert_repo,
)


async def backfill(*, channel: str, dry_run: bool, limit: int | None, batch_size: int) -> None:
    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]
    session = os.getenv("TELEGRAM_SESSION", "telegram_scraper")
    session_path = str(ROOT / session)

    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()

    scanned = 0
    new_repos = 0
    max_id = 0
    max_posted = None
    batch_count = 0
    chunk: list = []

    print(f"Backfilling @{channel} (batch_size={batch_size})…", flush=True)

    try:
        # Newest → oldest from Telegram; we reverse each chunk before write
        # so watermarks advance monotonically within a commit.
        async for message in client.iter_messages(channel):
            chunk.append(message)
            if limit and (scanned + len(chunk)) >= limit:
                # trim to remaining
                remaining = limit - scanned
                chunk = chunk[:remaining]
                await _commit_chunk(
                    chunk,
                    channel=channel,
                    dry_run=dry_run,
                )
                # update local counters from a lightweight recount below
                scanned += len(chunk)
                batch_count += 1
                print(f"Reached --limit={limit}. Stopped.", flush=True)
                break

            if len(chunk) >= batch_size:
                stats = await _commit_chunk(chunk, channel=channel, dry_run=dry_run)
                scanned += stats["scanned"]
                new_repos += stats["new_repos"]
                max_id = max(max_id, stats["max_id"])
                if stats["max_posted"] and (
                    max_posted is None or stats["max_posted"] > max_posted
                ):
                    max_posted = stats["max_posted"]
                batch_count += 1
                print(
                    f"Batch {batch_count}: scanned={scanned} "
                    f"new_repos≈{new_repos} cursor={max_id}",
                    flush=True,
                )
                chunk = []

        if chunk:
            stats = await _commit_chunk(chunk, channel=channel, dry_run=dry_run)
            scanned += stats["scanned"]
            new_repos += stats["new_repos"]
            max_id = max(max_id, stats["max_id"])
            if stats["max_posted"] and (
                max_posted is None or stats["max_posted"] > max_posted
            ):
                max_posted = stats["max_posted"]
            batch_count += 1
            print(
                f"Batch {batch_count}: scanned={scanned} "
                f"new_repos≈{new_repos} cursor={max_id}",
                flush=True,
            )

        print(
            f"Backfill complete @{channel}. scanned={scanned} new_repos≈{new_repos}",
            flush=True,
        )
    finally:
        await client.disconnect()


async def _commit_chunk(
    chunk: list,
    *,
    channel: str,
    dry_run: bool,
) -> dict:
    # Process oldest → newest within the chunk
    ordered = sorted(chunk, key=lambda m: m.id)
    scanned = 0
    new_repos = 0
    max_id = 0
    max_posted = None

    if dry_run:
        for m in ordered[:5]:
            text = m.text or m.message or ""
            urls = [
                n.github_url
                for u in extract_github_urls(text)
                if (n := normalize_github_url(u))
            ]
            print(f"[dry-run] {m.id} {m.date} {urls[:2]}", flush=True)
        return {
            "scanned": len(ordered),
            "new_repos": 0,
            "max_id": ordered[-1].id if ordered else 0,
            "max_posted": ordered[-1].date if ordered else None,
        }

    with get_connection() as conn:
        with conn.cursor() as cur:
            for message in ordered:
                scanned += 1
                text = message.text or message.message or ""
                posted_at = message.date
                if posted_at and posted_at.tzinfo is None:
                    posted_at = posted_at.replace(tzinfo=timezone.utc)

                post_id = upsert_post(
                    cur,
                    message_id=message.id,
                    posted_at=posted_at,
                    text=text,
                    channel=channel,
                )
                for raw in extract_github_urls(text):
                    norm = normalize_github_url(raw)
                    if not norm:
                        continue
                    repo_id, inserted = upsert_repo(
                        cur,
                        github_url=norm.github_url,
                        owner=norm.owner,
                        repo_name=norm.repo_name,
                        full_name=norm.full_name,
                    )
                    if inserted:
                        new_repos += 1
                    upsert_mention(
                        cur,
                        post_id=post_id,
                        repo_id=repo_id,
                        discovered_at=posted_at,
                    )
                max_id = max(max_id, message.id)
                if max_posted is None or (posted_at and posted_at > max_posted):
                    max_posted = posted_at

            update_ingestion_state(
                cur,
                channel=channel,
                max_message_id=max_id,
                max_posted_at=max_posted,
            )
            conn.commit()

    return {
        "scanned": scanned,
        "new_repos": new_repos,
        "max_id": max_id,
        "max_posted": max_posted,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Telegram history via Telethon")
    parser.add_argument("--channel", default=os.getenv("TELEGRAM_CHANNEL", "githubtrending"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args()
    asyncio.run(
        backfill(
            channel=args.channel.lstrip("@"),
            dry_run=args.dry_run,
            limit=args.limit,
            batch_size=args.batch_size,
        )
    )


if __name__ == "__main__":
    main()
