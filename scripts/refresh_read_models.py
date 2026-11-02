"""Refresh Postgres materialized views used by the Next.js read path."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.db import get_connection  # noqa: E402

VIEWS = (
    "mv_repo_snapshot_stats",
    "mv_repository_discovery",
    "mv_discovery_timeline",
)


def refresh_read_models() -> None:
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            for name in VIEWS:
                print(f"Refreshing {name}…")
                try:
                    cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {name}")
                except Exception as exc:
                    print(f"  Concurrent refresh failed ({exc}); retrying without CONCURRENTLY")
                    cur.execute(f"REFRESH MATERIALIZED VIEW {name}")
                print(f"  OK {name}")


def main() -> None:
    refresh_read_models()
    print("Read models refreshed.")


if __name__ == "__main__":
    main()
