"""Shared database helpers for GitHub Radar scripts."""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env.local and fill values."
        )
    # GitHub Actions (and many CI runners) cannot reach IPv6-only Supabase
    # direct hosts. Prefer the pooler URL in DATABASE_URL for CI.
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def _connect_timeout() -> int:
    raw = os.getenv("DATABASE_CONNECT_TIMEOUT", "12")
    try:
        return max(3, int(raw))
    except ValueError:
        return 12


@contextmanager
def get_connection(*, autocommit: bool = False) -> Iterator[psycopg.Connection]:
    url = get_database_url()
    try:
        conn = psycopg.connect(
            url,
            row_factory=dict_row,
            autocommit=autocommit,
            connect_timeout=_connect_timeout(),
        )
    except psycopg.OperationalError as exc:
        host_hint = "pooler.supabase.com" if "pooler.supabase.com" in url else "supabase.co"
        raise RuntimeError(
            "Could not connect to Supabase Postgres (DATABASE_URL). "
            f"This machine cannot reach {host_hint} — common on networks that block "
            "outbound DB ports. Use phone hotspot/VPN, run ingest via GitHub Actions, "
            "or apply data through the Supabase dashboard. "
            f"Original error: {exc}"
        ) from exc
    try:
        yield conn
    finally:
        conn.close()


def run_sql_file(path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
