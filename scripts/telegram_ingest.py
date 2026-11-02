"""Incremental Telegram channel ingestion (Telethon).

Primary watermark: posted_at (Telegram message date)
Secondary safety cursor: telegram_message_id (dedup / same-second ties)

Restart-safe and idempotent. Cursor advances only after a successful batch commit.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
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


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def ensure_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_cursor(channel: str) -> tuple[int | None, datetime | None]:
    """Load watermark from ingestion_state, bootstrapping from DB if needed."""
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
                return row["last_telegram_message_id"], ensure_aware(row["last_posted_at"])

            # Bootstrap watermark from already-imported history
            cur.execute(
                """
                SELECT
                  MAX(telegram_message_id) AS max_id,
                  MAX(posted_at) AS max_posted
                FROM telegram_posts
                WHERE source_channel = %s
                """,
                (channel,),
            )
            fallback = cur.fetchone()
            if fallback and (fallback["max_id"] or fallback["max_posted"]):
                return fallback["max_id"], ensure_aware(fallback["max_posted"])
            return None, None


def is_newer_than_watermark(
    *,
    message_id: int,
    posted_at: datetime | None,
    last_id: int | None,
    last_posted: datetime | None,
) -> bool:
    """True if this Telegram message is after the stored watermark."""
    posted_at = ensure_aware(posted_at)
    last_posted = ensure_aware(last_posted)

    if last_posted is None and last_id is None:
        return True

    if posted_at is not None and last_posted is not None:
        if posted_at > last_posted:
            return True
        if posted_at < last_posted:
            return False
        # Same timestamp: accept only newer message ids
        if last_id is not None:
            return message_id > last_id
        return True

    if last_id is not None:
        return message_id > last_id

    return True


async def ingest(*, dry_run: bool, batch_size: int, channel: str) -> list[str]:
    api_id = int(require_env("TELEGRAM_API_ID"))
    api_hash = require_env("TELEGRAM_API_HASH")
    session = os.getenv("TELEGRAM_SESSION", "telegram_scraper")
    session_path = str(ROOT / session)

    scan_limit: int | None = None
    if dry_run:
        # Dry-run must not block on DATABASE_URL (local pooler may be unreachable).
        last_id, last_posted = None, None
        scan_limit = min(batch_size * 2, 100)
        print(
            f"Channel={channel} dry-run: skipping DB watermark; "
            f"scanning up to {scan_limit} recent messages"
        )
    else:
        print(f"Channel={channel} loading watermark from database…")
        last_id, last_posted = get_cursor(channel)
        print(
            f"Channel={channel} watermark_posted_at={last_posted} "
            f"cursor_message_id={last_id}"
        )

    print(f"Channel={channel} connecting to Telegram…")
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()

    messages_scanned = 0
    new_messages = 0
    github_urls_found = 0
    new_repositories = 0
    errors = 0
    max_message_id = last_id or 0
    max_posted_at = last_posted
    pending_batch: list = []
    mentioned_ids: set[str] = set()

    run_id = None
    if not dry_run:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ingestion_runs (status, started_at)
                    VALUES ('running', NOW()) RETURNING id
                    """
                )
                run_id = cur.fetchone()["id"]
                conn.commit()

    try:
        # Newest → oldest. Stop once we cross the posted_at watermark.
        # Small overlap window catches same-second posts / clock skew.
        overlap = timedelta(minutes=2)
        stop_before = (last_posted - overlap) if last_posted else None

        async for message in client.iter_messages(channel, limit=scan_limit):
            posted_at = ensure_aware(message.date)

            if stop_before and posted_at and posted_at < stop_before:
                break

            if not is_newer_than_watermark(
                message_id=message.id,
                posted_at=posted_at,
                last_id=last_id,
                last_posted=last_posted,
            ):
                # Keep scanning a little further in case of out-of-order ids
                # at the watermark boundary, but bail if clearly older.
                if (
                    last_posted
                    and posted_at
                    and posted_at < last_posted - timedelta(seconds=1)
                ):
                    break
                continue

            pending_batch.append(message)

            # Safety: never pull full history when watermark is missing
            if last_posted is None and last_id is None and len(pending_batch) >= batch_size * 5:
                print(
                    "No watermark found — limiting first run. "
                    "Import historical CSV first for full history."
                )
                break

        pending_batch.sort(key=lambda m: (m.date or datetime.min.replace(tzinfo=timezone.utc), m.id))
        print(f"Delta candidates: {len(pending_batch)} messages newer than watermark")

        if dry_run:
            for message in pending_batch[:50]:
                text = message.text or message.message or ""
                urls = [
                    n.github_url
                    for u in extract_github_urls(text)
                    if (n := normalize_github_url(u))
                ]
                print(f"[dry-run] msg={message.id} at={message.date} repos={urls[:3]}")
            print(f"Dry-run: would process {len(pending_batch)} messages")
            await client.disconnect()
            return []

        if not pending_batch:
            if run_id:
                with get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE ingestion_runs SET
                              completed_at = NOW(),
                              status = 'success',
                              messages_scanned = 0,
                              new_messages = 0,
                              github_urls_found = 0,
                              new_repositories = 0,
                              errors = 0
                            WHERE id = %s::uuid
                            """,
                            (str(run_id),),
                        )
                        # Refresh last_successful_run_at even when idle
                        if last_id or last_posted:
                            update_ingestion_state(
                                cur,
                                channel=channel,
                                max_message_id=last_id or 0,
                                max_posted_at=last_posted,
                            )
                        conn.commit()
            print("No new messages since watermark — nothing to ingest.")
            return []

        for i in range(0, len(pending_batch), batch_size):
            chunk = pending_batch[i : i + batch_size]
            with get_connection() as conn:
                with conn.cursor() as cur:
                    chunk_max_id = max_message_id
                    chunk_max_posted = max_posted_at
                    try:
                        for message in chunk:
                            messages_scanned += 1
                            text = message.text or message.message or ""
                            posted_at = ensure_aware(message.date)

                            post_id = upsert_post(
                                cur,
                                message_id=message.id,
                                posted_at=posted_at,
                                text=text,
                                channel=channel,
                            )
                            new_messages += 1

                            for raw in extract_github_urls(text):
                                norm = normalize_github_url(raw)
                                if not norm:
                                    continue
                                github_urls_found += 1
                                repo_id, inserted = upsert_repo(
                                    cur,
                                    github_url=norm.github_url,
                                    owner=norm.owner,
                                    repo_name=norm.repo_name,
                                    full_name=norm.full_name,
                                )
                                mentioned_ids.add(str(repo_id))
                                if inserted:
                                    new_repositories += 1
                                upsert_mention(
                                    cur,
                                    post_id=post_id,
                                    repo_id=repo_id,
                                    discovered_at=posted_at,
                                )

                            chunk_max_id = max(chunk_max_id, message.id)
                            if chunk_max_posted is None or (
                                posted_at and posted_at > chunk_max_posted
                            ):
                                chunk_max_posted = posted_at

                        # Advance watermark only after successful batch commit
                        update_ingestion_state(
                            cur,
                            channel=channel,
                            max_message_id=chunk_max_id,
                            max_posted_at=chunk_max_posted,
                        )
                        conn.commit()
                        max_message_id = chunk_max_id
                        max_posted_at = chunk_max_posted
                        print(
                            f"Committed batch {i // batch_size + 1}: "
                            f"msgs={len(chunk)} watermark_posted_at={max_posted_at} "
                            f"cursor_id={max_message_id}"
                        )
                    except Exception:
                        conn.rollback()
                        errors += 1
                        raise

        if run_id:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE ingestion_runs SET
                          completed_at = NOW(),
                          status = 'success',
                          messages_scanned = %s,
                          new_messages = %s,
                          github_urls_found = %s,
                          new_repositories = %s,
                          errors = %s
                        WHERE id = %s::uuid
                        """,
                        (
                            messages_scanned,
                            new_messages,
                            github_urls_found,
                            new_repositories,
                            errors,
                            str(run_id),
                        ),
                    )
                    conn.commit()

        print(
            "Ingestion complete:\n"
            f"  scanned={messages_scanned}\n"
            f"  new_messages={new_messages}\n"
            f"  github_urls={github_urls_found}\n"
            f"  new_repos={new_repositories}\n"
            f"  watermark_posted_at={max_posted_at}\n"
            f"  cursor_message_id={max_message_id}"
        )
        return list(mentioned_ids)
    except Exception as exc:
        if run_id:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE ingestion_runs SET
                          completed_at = NOW(),
                          status = 'failed',
                          error_message = %s,
                          messages_scanned = %s,
                          new_messages = %s,
                          github_urls_found = %s,
                          new_repositories = %s,
                          errors = %s
                        WHERE id = %s::uuid
                        """,
                        (
                            str(exc)[:2000],
                            messages_scanned,
                            new_messages,
                            github_urls_found,
                            new_repositories,
                            errors + 1,
                            str(run_id),
                        ),
                    )
                    conn.commit()
        raise
    finally:
        await client.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Incremental Telegram ingestion")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("INGEST_BATCH_SIZE", "100")),
    )
    parser.add_argument(
        "--channel",
        default=None,
        help="Single channel username (default: first from TELEGRAM_CHANNELS)",
    )
    args = parser.parse_args()
    from scripts.channels import parse_channels

    channel = args.channel or parse_channels()[0]
    asyncio.run(
        ingest(dry_run=args.dry_run, batch_size=args.batch_size, channel=channel)
    )


if __name__ == "__main__":
    main()
