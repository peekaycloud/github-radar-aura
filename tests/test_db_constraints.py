"""Lightweight DB constraint / pagination smoke tests (require DATABASE_URL)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.db import get_connection  # noqa: E402


pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL") and not (ROOT / ".env.local").exists(),
    reason="DATABASE_URL not configured",
)


def test_unique_channel_message_id_constraint():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env.local")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT source_channel, telegram_message_id, COUNT(*) AS c
                FROM telegram_posts
                GROUP BY source_channel, telegram_message_id
                HAVING COUNT(*) > 1
                """
            )
            assert cur.fetchall() == []


def test_unique_github_url():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env.local")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT github_url, COUNT(*) AS c
                FROM repositories
                GROUP BY github_url
                HAVING COUNT(*) > 1
                """
            )
            assert cur.fetchall() == []


def test_mention_unique_pair():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env.local")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT telegram_post_id, repository_id, COUNT(*) AS c
                FROM telegram_repo_mentions
                GROUP BY telegram_post_id, repository_id
                HAVING COUNT(*) > 1
                """
            )
            assert cur.fetchall() == []


def test_ingestion_state_cursor_present():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env.local")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT last_telegram_message_id FROM ingestion_state WHERE channel = %s",
                ("githubtrending",),
            )
            row = cur.fetchone()
            assert row is not None
            assert row["last_telegram_message_id"] and row["last_telegram_message_id"] > 0


def test_pagination_stable_order():
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env.local")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT full_name FROM v_repository_discovery
                ORDER BY first_discovered_at DESC NULLS LAST
                LIMIT 10 OFFSET 0
                """
            )
            page1 = [r["full_name"] for r in cur.fetchall()]
            cur.execute(
                """
                SELECT full_name FROM v_repository_discovery
                ORDER BY first_discovered_at DESC NULLS LAST
                LIMIT 10 OFFSET 10
                """
            )
            page2 = [r["full_name"] for r in cur.fetchall()]
            assert len(set(page1) & set(page2)) == 0
