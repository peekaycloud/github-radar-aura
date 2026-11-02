"""Idempotent historical import from telegram_links.csv into PostgreSQL.

Optimized for remote Supabase: batch upserts, fewer round-trips.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.db import get_connection  # noqa: E402
from scripts.github_url import normalize_github_url  # noqa: E402

DEFAULT_CSV = ROOT / "telegram_links.csv"
CHANNEL = "githubtrending"


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def update_ingestion_state(cur, *, channel: str, max_message_id: int, max_posted_at: datetime | None) -> None:
    cur.execute(
        """
        INSERT INTO ingestion_state (
          channel, last_telegram_message_id, last_posted_at, last_successful_run_at
        )
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (channel) DO UPDATE SET
          last_telegram_message_id = GREATEST(
            COALESCE(ingestion_state.last_telegram_message_id, 0),
            EXCLUDED.last_telegram_message_id
          ),
          last_posted_at = CASE
            WHEN ingestion_state.last_posted_at IS NULL THEN EXCLUDED.last_posted_at
            WHEN EXCLUDED.last_posted_at IS NULL THEN ingestion_state.last_posted_at
            ELSE GREATEST(ingestion_state.last_posted_at, EXCLUDED.last_posted_at)
          END,
          last_successful_run_at = NOW()
        """,
        (channel, max_message_id, max_posted_at),
    )


def import_csv(path: Path, *, channel: str, dry_run: bool, limit: int | None) -> None:
    if not path.exists():
        raise SystemExit(f"CSV not found: {path}")

    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required = {"message_id", "url"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise SystemExit(
                f"CSV must include at least message_id and url. Found: {reader.fieldnames}"
            )
        batch = []
        for i, row in enumerate(reader, start=1):
            if limit is not None and i > limit:
                break
            batch.append(row)

    print(f"Read {len(batch)} rows from {path.name}")
    if dry_run:
        sample_ok = 0
        for row in batch[:20]:
            norm = normalize_github_url(row.get("url"))
            if norm:
                sample_ok += 1
                print(f"  OK {norm.github_url}  msg={row.get('message_id')}")
            else:
                print(f"  SKIP {row.get('url')}")
        print(f"Dry-run complete. Sample normalized: {sample_ok}/min(20,rows)")
        return

    # Prepare normalized records in memory
    posts: dict[int, tuple[datetime, str | None]] = {}
    links: list[tuple[int, str, str, str, str, datetime]] = []
    skipped_non_github = 0
    skipped_bad = 0

    for row in batch:
        try:
            message_id = int(row["message_id"])
        except (TypeError, ValueError):
            skipped_bad += 1
            continue
        posted_at = parse_dt(row.get("date") or row.get("posted_at"))
        if posted_at is None:
            skipped_bad += 1
            continue
        text = row.get("text")
        # Prefer longest text if duplicate message_id rows
        prev = posts.get(message_id)
        if prev is None or (text and (not prev[1] or len(text) > len(prev[1]))):
            posts[message_id] = (posted_at, text)

        norm = normalize_github_url(row.get("url"))
        if norm is None:
            skipped_non_github += 1
            continue
        links.append(
            (
                message_id,
                norm.github_url,
                norm.owner,
                norm.repo_name,
                norm.full_name,
                posted_at,
            )
        )

    max_message_id = max(posts.keys()) if posts else 0
    max_posted_at = max((p[0] for p in posts.values()), default=None)
    print(
        f"Prepared posts={len(posts)} repo_links={len(links)} "
        f"skipped_non_github={skipped_non_github} skipped_bad={skipped_bad}"
    )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingestion_runs (status, started_at)
                VALUES ('running', NOW())
                RETURNING id
                """
            )
            run_id = cur.fetchone()["id"]
            conn.commit()

            try:
                # 1) Upsert posts in chunks
                post_items = [
                    (mid, posted_at, text, channel)
                    for mid, (posted_at, text) in posts.items()
                ]
                chunk = 500
                for i in range(0, len(post_items), chunk):
                    part = post_items[i : i + chunk]
                    cur.executemany(
                        """
                        INSERT INTO telegram_posts (
                          telegram_message_id, posted_at, text, source_channel, scraped_at
                        ) VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (source_channel, telegram_message_id) DO UPDATE SET
                          text = COALESCE(EXCLUDED.text, telegram_posts.text),
                          posted_at = COALESCE(telegram_posts.posted_at, EXCLUDED.posted_at)
                        """,
                        part,
                    )
                    conn.commit()
                    print(f"  posts {min(i + chunk, len(post_items))}/{len(post_items)}")

                # 2) Upsert repositories
                repo_rows = {(url, owner, name, full) for _, url, owner, name, full, _ in links}
                repo_list = list(repo_rows)
                for i in range(0, len(repo_list), chunk):
                    part = repo_list[i : i + chunk]
                    cur.executemany(
                        """
                        INSERT INTO repositories (
                          github_url, owner, repo_name, full_name, enrichment_status
                        ) VALUES (%s, %s, %s, %s, 'pending')
                        ON CONFLICT (github_url) DO UPDATE SET
                          owner = COALESCE(repositories.owner, EXCLUDED.owner),
                          repo_name = COALESCE(repositories.repo_name, EXCLUDED.repo_name),
                          full_name = COALESCE(repositories.full_name, EXCLUDED.full_name)
                        """,
                        part,
                    )
                    conn.commit()
                    print(f"  repos {min(i + chunk, len(repo_list))}/{len(repo_list)}")

                # 3) Build lookup maps
                cur.execute(
                    "SELECT id, telegram_message_id FROM telegram_posts WHERE source_channel = %s",
                    (channel,),
                )
                post_id_by_msg = {r["telegram_message_id"]: r["id"] for r in cur.fetchall()}

                cur.execute("SELECT id, github_url FROM repositories")
                repo_id_by_url = {r["github_url"]: str(r["id"]) for r in cur.fetchall()}

                # 4) Mentions
                mention_rows = []
                for message_id, url, _o, _n, _f, posted_at in links:
                    post_id = post_id_by_msg.get(message_id)
                    repo_id = repo_id_by_url.get(url)
                    if post_id is None or repo_id is None:
                        continue
                    mention_rows.append((post_id, repo_id, posted_at))

                for i in range(0, len(mention_rows), chunk):
                    part = mention_rows[i : i + chunk]
                    cur.executemany(
                        """
                        INSERT INTO telegram_repo_mentions (
                          telegram_post_id, repository_id, discovered_at
                        ) VALUES (%s, %s::uuid, %s)
                        ON CONFLICT (telegram_post_id, repository_id) DO NOTHING
                        """,
                        part,
                    )
                    conn.commit()
                    print(f"  mentions {min(i + chunk, len(mention_rows))}/{len(mention_rows)}")

                if max_message_id:
                    update_ingestion_state(
                        cur,
                        channel=channel,
                        max_message_id=max_message_id,
                        max_posted_at=max_posted_at,
                    )

                cur.execute("SELECT COUNT(*) AS c FROM repositories")
                repo_count = cur.fetchone()["c"]
                cur.execute("SELECT COUNT(*) AS c FROM telegram_posts")
                post_count = cur.fetchone()["c"]
                cur.execute("SELECT COUNT(*) AS c FROM telegram_repo_mentions")
                mention_count = cur.fetchone()["c"]

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
                        len(batch),
                        post_count,
                        len(links),
                        repo_count,
                        skipped_bad,
                        str(run_id),
                    ),
                )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                with conn.cursor() as cur2:
                    cur2.execute(
                        """
                        UPDATE ingestion_runs SET
                          completed_at = NOW(),
                          status = 'failed',
                          error_message = %s
                        WHERE id = %s::uuid
                        """,
                        (str(exc)[:2000], str(run_id)),
                    )
                    conn.commit()
                raise

    print(
        "Import complete:\n"
        f"  rows={len(batch)}\n"
        f"  posts={len(posts)}\n"
        f"  repo_links={len(links)}\n"
        f"  skipped_non_github={skipped_non_github}\n"
        f"  skipped_bad={skipped_bad}\n"
        f"  cursor_message_id={max_message_id}"
    )


# Re-export helpers used by telegram_ingest / backfill
def upsert_post(cur, *, message_id: int, posted_at: datetime, text: str | None, channel: str) -> int:
    cur.execute(
        """
        INSERT INTO telegram_posts (
          telegram_message_id, posted_at, text, source_channel, scraped_at
        ) VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (source_channel, telegram_message_id) DO UPDATE SET
          text = COALESCE(EXCLUDED.text, telegram_posts.text),
          posted_at = COALESCE(telegram_posts.posted_at, EXCLUDED.posted_at)
        RETURNING id
        """,
        (message_id, posted_at, text, channel),
    )
    return cur.fetchone()["id"]


def upsert_repo(cur, *, github_url: str, owner: str, repo_name: str, full_name: str) -> tuple[str, bool]:
    cur.execute(
        """
        INSERT INTO repositories (github_url, owner, repo_name, full_name, enrichment_status)
        VALUES (%s, %s, %s, %s, 'pending')
        ON CONFLICT (github_url) DO UPDATE SET
          owner = COALESCE(repositories.owner, EXCLUDED.owner),
          repo_name = COALESCE(repositories.repo_name, EXCLUDED.repo_name),
          full_name = COALESCE(repositories.full_name, EXCLUDED.full_name)
        RETURNING id, (xmax = 0) AS inserted
        """,
        (github_url, owner, repo_name, full_name),
    )
    row = cur.fetchone()
    return str(row["id"]), bool(row["inserted"])


def upsert_mention(cur, *, post_id: int, repo_id: str, discovered_at: datetime | None) -> bool:
    cur.execute(
        """
        INSERT INTO telegram_repo_mentions (telegram_post_id, repository_id, discovered_at)
        VALUES (%s, %s::uuid, %s)
        ON CONFLICT (telegram_post_id, repository_id) DO NOTHING
        RETURNING id
        """,
        (post_id, repo_id, discovered_at),
    )
    return cur.fetchone() is not None


def main() -> None:
    parser = argparse.ArgumentParser(description="Import historical telegram_links.csv")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--channel", default=CHANNEL)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    import_csv(args.csv, channel=args.channel, dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
