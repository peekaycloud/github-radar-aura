"""Configured Telegram source channels for GitHub Radar."""

from __future__ import annotations

import os

# Default discovery channels (username without @)
DEFAULT_CHANNELS = (
    "githubtrending",
    "github_repos",
    "github_repositories_bds",
)


def parse_channels(raw: str | None = None) -> list[str]:
    """Parse comma-separated TELEGRAM_CHANNELS / TELEGRAM_CHANNEL env."""
    value = raw
    if value is None:
        value = os.getenv("TELEGRAM_CHANNELS") or os.getenv("TELEGRAM_CHANNEL") or os.getenv(
            "SOURCE_CHANNEL"
        )
    if not value:
        return list(DEFAULT_CHANNELS)

    channels: list[str] = []
    seen: set[str] = set()
    for part in value.split(","):
        name = part.strip().lstrip("@")
        if not name or name in seen:
            continue
        seen.add(name)
        channels.append(name)
    return channels or list(DEFAULT_CHANNELS)
