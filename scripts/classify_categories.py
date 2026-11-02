"""Heuristic category classification for repositories.

Uses name, description, language, and topics — stores normalized links.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.db import get_connection  # noqa: E402

RULES: list[tuple[str, list[str]]] = [
    ("mcp", [r"\bmcp\b", r"model context protocol"]),
    ("ai-agents", [r"\bagents?\b", r"autogen", r"crewai", r"langchain agent"]),
    ("rag", [r"\brag\b", r"retrieval.?augmented", r"vector store"]),
    ("llm", [r"\bllm\b", r"large language", r"gpt", r"openai", r"anthropic", r"claude"]),
    ("machine-learning", [r"\bml\b", r"machine learning", r"pytorch", r"tensorflow", r"sklearn"]),
    ("computer-vision", [r"computer vision", r"\bcv\b", r"opencv", r"yolo", r"image segmentation"]),
    ("ai", [r"\bai\b", r"artificial intelligence", r"deep learning", r"neural"]),
    ("databases", [r"database", r"postgres", r"sqlite", r"mongodb", r"redis", r"sql"]),
    ("devops", [r"devops", r"kubernetes", r"k8s", r"docker", r"ci/?cd", r"terraform"]),
    ("security", [r"security", r"cve", r"vulnerability", r"auth", r"oauth", r"pentest"]),
    ("coding-tools", [r"vscode", r"neovim", r"lsp\b", r"formatter", r"linter", r"copilot"]),
    ("developer-tools", [r"developer tool", r"devtools", r"cli\b", r"sdk\b", r"framework"]),
    ("productivity", [r"productivity", r"notes?", r"todo", r"calendar"]),
    ("web-development", [r"react", r"next\.?js", r"vue", r"svelte", r"frontend", r"css"]),
    ("mobile", [r"android", r"ios\b", r"flutter", r"react native", r"swiftui"]),
    ("data-engineering", [r"etl\b", r"data pipeline", r"spark", r"airflow", r"dbt\b"]),
    ("robotics", [r"robot", r"ros\b", r"drone"]),
    ("infrastructure", [r"infrastructure", r"cloud", r"aws", r"gcp", r"azure"]),
]


def classify(text: str) -> list[str]:
    lowered = text.lower()
    hits: list[str] = []
    for slug, patterns in RULES:
        for pat in patterns:
            if re.search(pat, lowered):
                hits.append(slug)
                break
    if not hits:
        hits.append("open-source")
        hits.append("other")
    # Deduplicate preserving order
    seen = set()
    out = []
    for h in hits:
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out[:4]


def run(*, limit: int | None, dry_run: bool) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, slug FROM categories")
            cat_map = {r["slug"]: r["id"] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT
                  r.id,
                  r.full_name,
                  r.description,
                  r.language,
                  r.repo_name,
                  (
                    SELECT p.text
                    FROM telegram_repo_mentions m
                    JOIN telegram_posts p ON p.id = m.telegram_post_id
                    WHERE m.repository_id = r.id
                    ORDER BY COALESCE(m.discovered_at, p.posted_at) ASC
                    LIMIT 1
                  ) AS telegram_text
                FROM repositories r
                ORDER BY r.updated_at DESC NULLS LAST
                LIMIT %s
                """,
                (limit or 100000,),
            )
            rows = cur.fetchall()

            assigned = 0
            for row in rows:
                blob = " ".join(
                    filter(
                        None,
                        [
                            row.get("full_name"),
                            row.get("repo_name"),
                            row.get("description"),
                            row.get("language"),
                            row.get("telegram_text"),
                        ],
                    )
                )
                slugs = classify(blob)
                if dry_run:
                    print(f"{row['full_name']}: {slugs}")
                    continue
                for slug in slugs:
                    cat_id = cat_map.get(slug)
                    if not cat_id:
                        continue
                    cur.execute(
                        """
                        INSERT INTO repository_categories (repository_id, category_id, confidence)
                        VALUES (%s::uuid, %s::uuid, 0.7)
                        ON CONFLICT DO NOTHING
                        """,
                        (str(row["id"]), str(cat_id)),
                    )
                    assigned += 1
            if not dry_run:
                conn.commit()
            print(f"Category links written≈{assigned} for {len(rows)} repos")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
