"""Apply SQL migrations against DATABASE_URL."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.db import run_sql_file  # noqa: E402


def main() -> None:
    migrations = sorted((ROOT / "db" / "migrations").glob("*.sql"))
    if not migrations:
        raise SystemExit("No migrations found in db/migrations")
    for path in migrations:
        print(f"Applying {path.name}...")
        run_sql_file(path)
        print(f"  OK {path.name}")
    print("All migrations applied.")


if __name__ == "__main__":
    main()
