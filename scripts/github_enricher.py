"""Public GitHub HTML enrichment — no api.github.com, no tokens.

Parses public repository pages with multiple fallback selectors.
Conservative rate limiting, retries, and daily snapshot creation.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

from scripts.db import get_connection  # noqa: E402

USER_AGENT = (
    "GitHubRadarBot/1.0 (+https://github.com/local/github-radar; research; respectful)"
)


class RateLimitedError(Exception):
    pass


class ForbiddenError(Exception):
    pass


@dataclass
class EnrichmentResult:
    owner: str | None = None
    repo_name: str | None = None
    description: str | None = None
    homepage: str | None = None
    language: str | None = None
    license: str | None = None
    stars: int | None = None
    forks: int | None = None
    watchers: int | None = None
    open_issues: int | None = None
    contributors_count: int | None = None
    size_kb: int | None = None
    default_branch: str | None = None
    is_fork: bool | None = None
    is_archived: bool | None = None
    created_at_github: datetime | None = None
    updated_at_github: datetime | None = None
    pushed_at_github: datetime | None = None
    topics: list[str] = field(default_factory=list)
    raw_error: str | None = None


def _parse_count(text: str | None) -> int | None:
    if not text:
        return None
    t = text.strip().lower().replace(",", "").replace("\xa0", "")
    if not t:
        return None
    mult = 1.0
    if t.endswith("k"):
        mult = 1_000.0
        t = t[:-1]
    elif t.endswith("m"):
        mult = 1_000_000.0
        t = t[:-1]
    try:
        return int(float(t) * mult)
    except ValueError:
        m = re.search(r"([\d.]+)", t)
        if not m:
            return None
        try:
            return int(float(m.group(1)) * mult)
        except ValueError:
            return None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def parse_repo_html(html: str, *, owner: str, repo: str) -> EnrichmentResult:
    """Parse GitHub repository HTML with multiple fallbacks. Missing → None."""
    soup = BeautifulSoup(html, "lxml")
    result = EnrichmentResult(owner=owner, repo_name=repo)

    # Archived banner
    archived = soup.select_one("#repository-container-header .Label--secondary")
    page_text = soup.get_text(" ", strip=True).lower()
    if "this repository has been archived" in page_text:
        result.is_archived = True
    elif archived and "archived" in archived.get_text(" ", strip=True).lower():
        result.is_archived = True
    else:
        result.is_archived = False

    # Fork indicator
    result.is_fork = bool(
        soup.select_one('span[title*="forked from" i], a[href*="/network/members"]')
    ) or ("forked from" in page_text[:2000])

    # Description — several selectors used by GitHub over time
    desc_el = (
        soup.select_one('meta[name="description"]')
        or soup.select_one('meta[property="og:description"]')
        or soup.select_one("p.f4.my-3")
        or soup.select_one('[data-pjax="#repo-content-pjax-container"] p.f4')
        or soup.select_one("#repo-content-pjax-container .BorderGrid-cell p")
    )
    if desc_el:
        if desc_el.name == "meta":
            result.description = (desc_el.get("content") or "").strip() or None
        else:
            result.description = desc_el.get_text(" ", strip=True) or None

    # Social counts via #repo-stars-counter-star etc.
    # Prefer title/aria-label (exact "364,110") over visible "365k".
    for attr, field_name in (
        ("#repo-stars-counter-star", "stars"),
        ("#repo-network-counter", "forks"),
        ("#repo-notifications-counter", "watchers"),
    ):
        el = soup.select_one(attr)
        if el:
            raw = el.get("title") or el.get("aria-label") or el.get_text()
            setattr(result, field_name, _parse_count(raw))

    count_match = re.search(r'"stargazerCount"\s*:\s*(\d+)', html)
    if count_match:
        result.stars = int(count_match.group(1))
    fork_match = re.search(r'"forkCount"\s*:\s*(\d+)', html)
    if fork_match:
        result.forks = int(fork_match.group(1))

    # Fallback: aria-label counters in sidebar
    if result.stars is None:
        for a in soup.select('a[href$="/stargazers"]'):
            n = _parse_count(a.get_text(" ", strip=True))
            if n is not None:
                result.stars = n
                break
    if result.forks is None:
        for a in soup.select('a[href$="/forks"], a[href$="/network/members"]'):
            n = _parse_count(a.get_text(" ", strip=True))
            if n is not None:
                result.forks = n
                break

    # Language
    lang_el = (
        soup.select_one('span[itemprop="programmingLanguage"]')
        or soup.select_one(".BorderGrid .f6 span[itemprop]")
        or soup.select_one('a[href*="/search?l="] span')
        or soup.select_one('li.d-inline a[href*="/search?l="]')
    )
    if lang_el:
        result.language = lang_el.get_text(" ", strip=True) or None
    if result.language is None:
        for a in soup.select('a[href*="/search?l="]'):
            text = a.get_text(" ", strip=True)
            if text and "%" not in text and len(text) < 40:
                result.language = text
                break
    if result.language is None:
        # Fallback: repository language color span adjacent text
        for span in soup.select("span.color-fg-default.text-bold.mr-1"):
            text = span.get_text(" ", strip=True)
            if text:
                result.language = text
                break

    # License
    for a in soup.select('a[href*="/blob/"][href*="LICENSE"], a[href*="/blob/"][href*="LICENCE"]'):
        text = a.get_text(" ", strip=True)
        if text:
            result.license = text
            break
    if result.license is None:
        lic = soup.select_one('a[data-analytics-event*="license"], .octicon-law')
        if lic:
            parent = lic.find_parent("a") or lic.parent
            if parent:
                result.license = parent.get_text(" ", strip=True) or None

    # Homepage
    for a in soup.select('span.octicon-link ~ a, a[rel="nofollow"][href^="http"]'):
        href = a.get("href") or ""
        if "github.com" in href:
            continue
        if href.startswith("http"):
            result.homepage = href
            break

    # Topics
    for a in soup.select('a.topic-tag, a[data-octo-click="topic_click"]'):
        t = a.get_text(" ", strip=True)
        if t:
            result.topics.append(t)

    # Default branch from branch picker button
    menu = soup.select_one('summary[data-hotkey="w"] span.css-truncate-target')
    if menu:
        result.default_branch = menu.get_text(" ", strip=True) or None
    if result.default_branch is None:
        branch_btn = soup.select_one(
            '#branch-select-menu summary span.css-truncate-target'
        )
        if branch_btn:
            result.default_branch = branch_btn.get_text(" ", strip=True) or None

    # Relative time / datetime attributes for activity
    for time_el in soup.select("relative-time, time-ago, time"):
        dt = _parse_datetime(time_el.get("datetime"))
        if dt and result.pushed_at_github is None:
            # First relative-time on page is often last push / latest commit
            label = (time_el.get("aria-label") or "").lower()
            parent_text = time_el.parent.get_text(" ", strip=True).lower() if time_el.parent else ""
            if "commit" in label or "commit" in parent_text or result.pushed_at_github is None:
                result.pushed_at_github = dt

    # Open issues from issues tab counter
    issues = soup.select_one('#issues-repo-tab-count, a[data-selected-links*="repo_issues"] span.Counter')
    if issues:
        result.open_issues = _parse_count(issues.get_text(" ", strip=True))

    # Structured JSON-LD if present
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            import json

            data = json.loads(script.string or "")
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("@type") in {"SoftwareSourceCode", "WebPage"}:
                if not result.description and item.get("description"):
                    result.description = str(item["description"])[:2000]
                date_created = item.get("dateCreated") or item.get("datePublished")
                if date_created:
                    result.created_at_github = _parse_datetime(str(date_created))

    # GitHub embeds createdAt in application/json payloads (no API needed)
    if result.created_at_github is None:
        for script in soup.select('script[type="application/json"]'):
            blob = script.string or ""
            if "createdAt" not in blob:
                continue
            match = re.search(
                r'"createdAt"\s*:\s*"([^"]+)"',
                blob,
            )
            if match:
                result.created_at_github = _parse_datetime(match.group(1))
                if result.created_at_github:
                    break
    if result.created_at_github is None:
        match = re.search(r'"createdAt"\s*:\s*"([^"]+)"', html)
        if match:
            result.created_at_github = _parse_datetime(match.group(1))

    # About sidebar "Used by" / watchers fallback via strong counters
    for row in soup.select(".BorderGrid-row, .BorderGrid-cell"):
        text = row.get_text(" ", strip=True)
        if "watching" in text.lower() and result.watchers is None:
            result.watchers = _parse_count(text)
        if "stars" in text.lower() and result.stars is None:
            result.stars = _parse_count(text)

    return result


class GitHubEnricher:
    def __init__(
        self,
        *,
        concurrency: int = 2,
        delay_seconds: float = 1.5,
        dry_run: bool = False,
    ) -> None:
        self.concurrency = max(1, concurrency)
        self.delay_seconds = delay_seconds
        self.dry_run = dry_run
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    async def _throttle(self) -> None:
        async with self._lock:
            elapsed = time.monotonic() - self._last_request
            if elapsed < self.delay_seconds:
                await asyncio.sleep(self.delay_seconds - elapsed)
            self._last_request = time.monotonic()

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, RateLimitedError)),
        wait=wait_exponential(multiplier=2, min=2, max=120),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    async def fetch(self, client: httpx.AsyncClient, url: str) -> httpx.Response:
        await self._throttle()
        resp = await client.get(url, follow_redirects=True)
        if resp.status_code == 429:
            retry_after = float(resp.headers.get("Retry-After", "30"))
            await asyncio.sleep(retry_after)
            raise RateLimitedError(f"429 for {url}")
        if resp.status_code == 403:
            raise ForbiddenError(f"403 for {url}")
        if resp.status_code == 404:
            raise FileNotFoundError(f"404 for {url}")
        resp.raise_for_status()
        return resp

    async def enrich_one(
        self, client: httpx.AsyncClient, owner: str, repo: str
    ) -> EnrichmentResult:
        url = f"https://github.com/{owner}/{repo}"
        resp = await self.fetch(client, url)
        result = parse_repo_html(resp.text, owner=owner, repo=repo)
        path = [p for p in resp.url.path.split("/") if p]
        if len(path) >= 2:
            result.owner = path[0]
            result.repo_name = path[1]
        return result


_QUEUE_COLS = """
      r.id, r.owner, r.repo_name, r.full_name, r.github_url, r.stars,
      r.last_enriched_at, r.enrichment_status
"""


def select_enrichment_queue(
    limit: int, *, prefer_ids: list[str] | None = None
) -> list[dict[str, Any]]:
    """New Telegram finds first, then discovery baselines, then backlog.

    Today's Radar shows Enriching… until `stars` is set. A 15k pending
    catalog used to consume every batch (ORDER BY stars DESC), so new
    unstarred repos never got a first scrape.
    """
    limit = max(int(limit), 1)
    # Daily scrape only adds a handful of repos; reserve real slots for them.
    fresh_n = min(max(limit // 2, 16), 80)
    rest = max(limit - fresh_n, 1)
    baseline_n = max(rest // 3, 1)
    refresh_n = max(rest // 3, 1)
    first_n = max(rest - baseline_n - refresh_n, 1)

    prefer_sql = f"""
      SELECT {_QUEUE_COLS}, 250 AS priority
      FROM repositories r
      WHERE r.id = ANY(%s::uuid[])
        AND r.owner IS NOT NULL AND r.repo_name IS NOT NULL
      ORDER BY (r.stars IS NULL) DESC, r.created_at DESC
    """
    fresh_sql = f"""
      SELECT {_QUEUE_COLS}, 200 AS priority
      FROM repositories r
      WHERE r.owner IS NOT NULL AND r.repo_name IS NOT NULL
        AND r.stars IS NULL
        AND r.created_at >= NOW() - INTERVAL '14 days'
        AND (
          r.last_enriched_at IS NULL
          OR r.last_enriched_at < NOW() - INTERVAL '12 hours'
        )
      ORDER BY r.created_at DESC
      LIMIT %s
    """
    baseline_sql = f"""
      SELECT {_QUEUE_COLS}, 120 AS priority
      FROM repositories r
      WHERE r.owner IS NOT NULL AND r.repo_name IS NOT NULL
        AND r.stars_at_discovery IS NULL
        AND (
          SELECT MIN(COALESCE(m.discovered_at, p.posted_at))
          FROM telegram_repo_mentions m
          JOIN telegram_posts p ON p.id = m.telegram_post_id
          WHERE m.repository_id = r.id
        ) >= NOW() - INTERVAL '7 days'
      ORDER BY r.created_at DESC
      LIMIT %s
    """
    first_sql = f"""
      SELECT {_QUEUE_COLS}, 100 AS priority
      FROM repositories r
      WHERE r.owner IS NOT NULL AND r.repo_name IS NOT NULL
        AND (
          r.last_enriched_at IS NULL
          OR r.enrichment_status IS NULL
          OR r.enrichment_status IN ('pending', 'failed', 'partial')
          OR r.stars IS NULL
          OR r.created_at_github IS NULL
        )
      ORDER BY
        (r.stars IS NULL) DESC,
        r.created_at DESC,
        r.last_enriched_at NULLS FIRST
      LIMIT %s
    """
    refresh_sql = f"""
      SELECT {_QUEUE_COLS}, 70 AS priority
      FROM repositories r
      WHERE r.owner IS NOT NULL AND r.repo_name IS NOT NULL
        AND r.enrichment_status = 'success'
        AND r.stars IS NOT NULL
        AND r.last_enriched_at < NOW() - INTERVAL '3 hours'
      ORDER BY
        (r.stars_at_discovery IS NOT NULL) DESC,
        COALESCE(r.stars, 0) DESC,
        r.last_enriched_at ASC
      LIMIT %s
    """

    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    with get_connection() as conn:
        with conn.cursor() as cur:
            batches: list[tuple[str, tuple[Any, ...]]] = []
            if prefer_ids:
                batches.append((prefer_sql, (prefer_ids,)))
            batches.extend(
                (
                    (fresh_sql, (fresh_n,)),
                    (baseline_sql, (baseline_n,)),
                    (refresh_sql, (refresh_n,)),
                    (first_sql, (first_n,)),
                )
            )
            for query, params in batches:
                cur.execute(query, params)
                for row in cur.fetchall():
                    rid = str(row["id"])
                    if rid in seen:
                        continue
                    seen.add(rid)
                    rows.append(row)
    rows.sort(key=lambda r: int(r.get("priority") or 0), reverse=True)
    return rows[:limit]


def should_write_snapshot(
    cur,
    repository_id: str,
    *,
    stars: int | None,
    forks: int | None,
    watchers: int | None,
    open_issues: int | None,
    contributors_count: int | None,
    pushed_at_github: datetime | None,
) -> bool:
    """Prefer daily snapshots; skip identical same-day duplicates."""
    cur.execute(
        """
        SELECT stars, forks, watchers, open_issues, contributors_count, pushed_at_github, captured_at
        FROM github_repo_snapshots
        WHERE repository_id = %s::uuid
        ORDER BY captured_at DESC
        LIMIT 1
        """,
        (repository_id,),
    )
    prev = cur.fetchone()
    if prev is None:
        return True

    same_values = (
        prev["stars"] == stars
        and prev["forks"] == forks
        and prev["watchers"] == watchers
        and prev["open_issues"] == open_issues
        and prev["contributors_count"] == contributors_count
    )
    captured = prev["captured_at"]
    if captured and captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)
    same_day = (
        captured is not None
        and captured.astimezone(timezone.utc).date()
        == datetime.now(timezone.utc).date()
    )
    if same_day and same_values:
        return False
    if same_values and captured and (datetime.now(timezone.utc) - captured).total_seconds() < 20 * 3600:
        return False
    return True


def persist_enrichment(repository_id: str, result: EnrichmentResult, *, success: bool) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if success:
                status = "success" if result.stars is not None else "partial"
                cur.execute(
                    """
                    UPDATE repositories SET
                      description = COALESCE(%s, description),
                      homepage = COALESCE(%s, homepage),
                      language = COALESCE(%s, language),
                      license = COALESCE(%s, license),
                      stars = COALESCE(%s, stars),
                      forks = COALESCE(%s, forks),
                      watchers = COALESCE(%s, watchers),
                      open_issues = COALESCE(%s, open_issues),
                      contributors_count = COALESCE(%s, contributors_count),
                      size_kb = COALESCE(%s, size_kb),
                      default_branch = COALESCE(%s, default_branch),
                      is_fork = COALESCE(%s, is_fork),
                      is_archived = COALESCE(%s, is_archived),
                      created_at_github = COALESCE(%s, created_at_github),
                      updated_at_github = COALESCE(%s, updated_at_github),
                      pushed_at_github = COALESCE(%s, pushed_at_github),
                      last_enriched_at = NOW(),
                      enrichment_status = %s,
                      enrichment_error = NULL
                    WHERE id = %s::uuid
                    """,
                    (
                        result.description,
                        result.homepage,
                        result.language,
                        result.license,
                        result.stars,
                        result.forks,
                        result.watchers,
                        result.open_issues,
                        result.contributors_count,
                        result.size_kb,
                        result.default_branch,
                        result.is_fork,
                        result.is_archived,
                        result.created_at_github,
                        result.updated_at_github,
                        result.pushed_at_github,
                        status,
                        repository_id,
                    ),
                )
                # Freeze stars at first Telegram mention once, only if we
                # scraped close enough to discovery that the count is real.
                if result.stars is not None:
                    cur.execute(
                        """
                        UPDATE repositories r
                        SET
                          stars_at_discovery = %s,
                          stars_at_discovery_at = NOW()
                        WHERE r.id = %s::uuid
                          AND r.stars_at_discovery IS NULL
                          AND (
                            SELECT MIN(COALESCE(m.discovered_at, p.posted_at))
                            FROM telegram_repo_mentions m
                            JOIN telegram_posts p ON p.id = m.telegram_post_id
                            WHERE m.repository_id = r.id
                          ) BETWEEN NOW() - INTERVAL '7 days'
                            AND NOW() + INTERVAL '2 days'
                        """,
                        (result.stars, repository_id),
                    )
                if result.stars is not None and should_write_snapshot(
                    cur,
                    repository_id,
                    stars=result.stars,
                    forks=result.forks,
                    watchers=result.watchers,
                    open_issues=result.open_issues,
                    contributors_count=result.contributors_count,
                    pushed_at_github=result.pushed_at_github,
                ):
                    cur.execute(
                        """
                        INSERT INTO github_repo_snapshots (
                          repository_id, captured_at, stars, forks, watchers,
                          open_issues, contributors_count, pushed_at_github
                        ) VALUES (%s::uuid, NOW(), %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            repository_id,
                            result.stars,
                            result.forks,
                            result.watchers,
                            result.open_issues,
                            result.contributors_count,
                            result.pushed_at_github,
                        ),
                    )
            else:
                cur.execute(
                    """
                    UPDATE repositories SET
                      last_enriched_at = NOW(),
                      enrichment_status = 'failed',
                      enrichment_error = %s
                    WHERE id = %s::uuid
                    """,
                    ((result.raw_error or "enrichment failed")[:2000], repository_id),
                )
            conn.commit()


async def run_enrichment(
    *,
    limit: int,
    dry_run: bool,
    prefer_ids: list[str] | None = None,
) -> None:
    concurrency = int(os.getenv("ENRICH_CONCURRENCY", "2"))
    delay = float(os.getenv("ENRICH_DELAY_SECONDS", "1.5"))
    queue = select_enrichment_queue(limit, prefer_ids=prefer_ids)
    print(f"Enrichment queue size: {len(queue)} (limit={limit})")
    if not queue:
        return

    enricher = GitHubEnricher(concurrency=concurrency, delay_seconds=delay, dry_run=dry_run)
    sem = asyncio.Semaphore(concurrency)
    success = 0
    failed = 0

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        timeout=httpx.Timeout(30.0),
    ) as client:

        async def worker(row: dict[str, Any]) -> None:
            nonlocal success, failed
            async with sem:
                owner, repo = row["owner"], row["repo_name"]
                rid = str(row["id"])
                if dry_run:
                    print(f"[dry-run] would enrich {owner}/{repo}")
                    return
                try:
                    result = await enricher.enrich_one(client, owner, repo)
                    if result.stars is None and result.created_at_github is None:
                        persist_enrichment(
                            rid,
                            EnrichmentResult(raw_error="parsed neither stars nor createdAt"),
                            success=False,
                        )
                        failed += 1
                        print(f"EMPTY {owner}/{repo} — no stars/createdAt in HTML")
                        return
                    persist_enrichment(rid, result, success=True)
                    success += 1
                    print(
                        f"OK {owner}/{repo} stars={result.stars} lang={result.language}"
                    )
                except FileNotFoundError as exc:
                    persist_enrichment(
                        rid, EnrichmentResult(raw_error=str(exc)), success=False
                    )
                    failed += 1
                    print(f"404 {owner}/{repo}")
                except ForbiddenError as exc:
                    persist_enrichment(
                        rid, EnrichmentResult(raw_error=str(exc)), success=False
                    )
                    failed += 1
                    print(f"403 {owner}/{repo} — slowing down")
                    await asyncio.sleep(60)
                except Exception as exc:  # noqa: BLE001
                    persist_enrichment(
                        rid, EnrichmentResult(raw_error=str(exc)), success=False
                    )
                    failed += 1
                    print(f"FAIL {owner}/{repo}: {exc}")

        await asyncio.gather(*(worker(r) for r in queue))

    print(f"Enrichment done. success={success} failed={failed}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich GitHub repos via public HTML")
    parser.add_argument("--limit", type=int, default=int(os.getenv("ENRICH_BATCH_SIZE", "50")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_enrichment(limit=args.limit, dry_run=args.dry_run))
    if not args.dry_run:
        from scripts.refresh_read_models import refresh_read_models

        print("Refreshing read models…")
        refresh_read_models()


if __name__ == "__main__":
    main()
