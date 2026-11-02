"""Tests for GitHub Radar core logic."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.github_url import normalize_github_url, extract_github_urls  # noqa: E402
from scripts.classify_categories import classify  # noqa: E402
from scripts.github_enricher import parse_repo_html, _parse_count  # noqa: E402


class TestNormalizeGitHubUrl:
    def test_standard(self):
        n = normalize_github_url("https://github.com/owner/repo")
        assert n is not None
        assert n.github_url == "https://github.com/owner/repo"
        assert n.full_name == "owner/repo"

    def test_trailing_slash_and_git(self):
        n = normalize_github_url("https://github.com/owner/repo.git/")
        assert n is not None
        assert n.github_url == "https://github.com/owner/repo"

    def test_query_and_www(self):
        n = normalize_github_url("https://www.github.com/owner/repo?foo=bar#frag")
        assert n is not None
        assert n.github_url == "https://github.com/owner/repo"

    def test_rejects_owner_only(self):
        assert normalize_github_url("https://github.com/owner") is None

    def test_rejects_topics(self):
        assert normalize_github_url("https://github.com/topics/ai") is None

    def test_rejects_issues(self):
        assert normalize_github_url("https://github.com/owner/repo/issues/1") is None

    def test_rejects_pulls(self):
        assert normalize_github_url("https://github.com/owner/repo/pull/2") is None

    def test_rejects_search(self):
        assert normalize_github_url("https://github.com/search?q=test") is None

    def test_rejects_marketplace(self):
        assert normalize_github_url("https://github.com/marketplace/actions/x") is None


class TestExtractUrls:
    def test_extracts_from_text(self):
        text = "See https://github.com/a/b and also github.com/c/d"
        urls = extract_github_urls(text)
        assert len(urls) >= 1


class TestParseCount:
    def test_k_suffix(self):
        assert _parse_count("1.2k") == 1200

    def test_plain(self):
        assert _parse_count("12,345") == 12345


class TestParseRepoHtml:
    def test_parses_basic_counters(self):
        html = """
        <html><body>
          <meta name="description" content="A cool project">
          <span id="repo-stars-counter-star" title="1234">1.2k</span>
          <span id="repo-network-counter" title="56">56</span>
          <span itemprop="programmingLanguage">Rust</span>
          <p>This repository has been archived by the owner</p>
        </body></html>
        """
        result = parse_repo_html(html, owner="o", repo="r")
        assert result.description == "A cool project"
        assert result.stars == 1234
        assert result.forks == 56
        assert result.language == "Rust"
        assert result.is_archived is True


class TestClassify:
    def test_mcp(self):
        assert "mcp" in classify("An MCP server for databases")

    def test_fallback(self):
        cats = classify("completely unrelated gardening tips")
        assert "other" in cats or "open-source" in cats


class TestChannelsConfig:
    def test_default_channels(self):
        from scripts.channels import DEFAULT_CHANNELS, parse_channels

        assert "githubtrending" in DEFAULT_CHANNELS
        assert "github_repos" in DEFAULT_CHANNELS
        assert "github_repositories_bds" in DEFAULT_CHANNELS
        assert parse_channels("github_repos, github_repositories_bds") == [
            "github_repos",
            "github_repositories_bds",
        ]

    def test_strips_at_and_dedupes(self):
        from scripts.channels import parse_channels

        assert parse_channels("@a, a, @b") == ["a", "b"]


class TestPostedAtWatermark:
    def test_newer_posted_at(self):
        from datetime import datetime, timezone
        from scripts.telegram_ingest import is_newer_than_watermark

        watermark = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
        assert is_newer_than_watermark(
            message_id=100,
            posted_at=datetime(2026, 8, 10, 13, 0, tzinfo=timezone.utc),
            last_id=50,
            last_posted=watermark,
        )
        assert not is_newer_than_watermark(
            message_id=100,
            posted_at=datetime(2026, 8, 10, 11, 0, tzinfo=timezone.utc),
            last_id=50,
            last_posted=watermark,
        )

    def test_same_timestamp_uses_message_id(self):
        from datetime import datetime, timezone
        from scripts.telegram_ingest import is_newer_than_watermark

        ts = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
        assert is_newer_than_watermark(
            message_id=51, posted_at=ts, last_id=50, last_posted=ts
        )
        assert not is_newer_than_watermark(
            message_id=50, posted_at=ts, last_id=50, last_posted=ts
        )


class TestDiscoveryScoreFormulaDoc:
    """Ensure analytics view SQL documents the discovery score formula."""

    def test_migration_contains_weights(self):
        sql = (ROOT / "db/migrations/002_analytics_views.sql").read_text()
        assert "0.30 * LN" in sql
        assert "Discovery Score" in sql
        assert "v_ahead_of_curve" in sql
        assert "v_hidden_gems" in sql
