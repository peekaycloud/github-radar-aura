"""Robust GitHub repository URL normalization.

Accepts common GitHub repository URL variants and returns a canonical form:
  https://github.com/{owner}/{repo}

Returns None for non-repository URLs (topics, search, issues, PRs, etc.).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse, unquote

# Paths that are never repositories even if they look like /owner/repo
BLOCKED_OWNERS = {
    "topics",
    "search",
    "issues",
    "pulls",
    "marketplace",
    "orgs",
    "sponsors",
    "features",
    "settings",
    "notifications",
    "explore",
    "collections",
    "events",
    "customer-stories",
    "enterprise",
    "pricing",
    "about",
    "login",
    "join",
    "signup",
    "site",
    "account",
    "apps",
    "codespaces",
    "copilot",
    "security",
    "premium-support",
    "git-guides",
    "readme",
    "discussions",
}

# Extra path segments after owner/repo that indicate non-repo resources
BLOCKED_EXTRA_SEGMENTS = {
    "issues",
    "pull",
    "pulls",
    "commit",
    "commits",
    "tree",
    "blob",
    "wiki",
    "actions",
    "projects",
    "security",
    "pulse",
    "graphs",
    "network",
    "settings",
    "releases",
    "tags",
    "packages",
    "discussions",
    "compare",
    "archive",
    "branches",
}

REPO_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")


@dataclass(frozen=True)
class NormalizedRepo:
    owner: str
    repo_name: str
    full_name: str
    github_url: str


def normalize_github_url(raw: str | None) -> NormalizedRepo | None:
    """Normalize a URL to a GitHub repository, or return None."""
    if not raw:
        return None

    text = raw.strip().strip("<>\"'`.,);]")
    if not text:
        return None

    # Bare owner/repo
    if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", text):
        text = f"https://github.com/{text}"

    if text.startswith("http://"):
        text = "https://" + text[len("http://") :]

    if text.startswith("github.com/") or text.startswith("www.github.com/"):
        text = "https://" + text

    try:
        parsed = urlparse(text)
    except Exception:
        return None

    host = (parsed.hostname or "").lower()
    if host not in {"github.com", "www.github.com"}:
        return None

    path = unquote(parsed.path or "")
    # strip query/fragment already ignored by urlparse path
    path = path.split("?")[0].split("#")[0]
    segments = [s for s in path.split("/") if s]
    if len(segments) < 2:
        return None

    owner, repo = segments[0], segments[1]

    # If URL includes extra resource path (issues/123 etc.), reject —
    # except trailing empty after strip. We only accept pure owner/repo.
    if len(segments) > 2:
        # Allow optional trailing .git already stripped from repo name;
        # anything else is not a repo root URL.
        return None

    owner = owner.strip()
    repo = repo.strip()
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    repo = repo.rstrip("/")

    if not owner or not repo:
        return None
    if owner.lower() in BLOCKED_OWNERS:
        return None
    if repo.lower() in BLOCKED_EXTRA_SEGMENTS:
        return None
    if not OWNER_RE.match(owner):
        return None
    if not REPO_NAME_RE.match(repo):
        return None
    if repo.lower() in {".", ".."}:
        return None

    full_name = f"{owner}/{repo}"
    return NormalizedRepo(
        owner=owner,
        repo_name=repo,
        full_name=full_name,
        github_url=f"https://github.com/{full_name}",
    )


def extract_github_urls(text: str | None) -> list[str]:
    """Extract candidate URLs from free text."""
    if not text:
        return []
    pattern = re.compile(r"https?://[^\s<>\"'`\]]+|github\.com/[^\s<>\"'`\]]+", re.I)
    return pattern.findall(text)
