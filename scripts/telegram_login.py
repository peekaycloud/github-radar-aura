"""One-time Telethon login — creates telegram_scraper.session (interactive code prompt)."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient, utils

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing {name} in .env.local")
    return value


async def main() -> None:
    parser = argparse.ArgumentParser(description="Log in to Telegram (Telethon session file).")
    parser.add_argument(
        "--phone",
        help="E.164 phone number, e.g. +6591234567 (or set TELEGRAM_PHONE in .env.local)",
    )
    args = parser.parse_args()
    raw_phone = args.phone or os.getenv("TELEGRAM_PHONE")
    if not raw_phone:
        raise SystemExit(
            "Pass --phone '+6591234567' or set TELEGRAM_PHONE in .env.local "
            "(must run in an interactive terminal for the login code)."
        )
    phone = utils.parse_phone(raw_phone)
    if not phone:
        raise SystemExit(
            f"Invalid phone {raw_phone!r}. Use your real number in E.164 form, "
            "digits only after +, e.g. --phone '+6598765432' (not +65YOURNUMBER)."
        )

    if not sys.stdin.isatty():
        raise SystemExit(
            "This command needs an interactive terminal (Cursor Terminal or Terminal.app).\n"
            "Do not run it through a non-interactive runner."
        )

    session = os.getenv("TELEGRAM_SESSION", "telegram_scraper")
    client = TelegramClient(
        str(ROOT / session),
        int(require_env("TELEGRAM_API_ID")),
        require_env("TELEGRAM_API_HASH"),
    )

    # phone is normalized digits (no +); Telethon accepts that for sign-in.
    await client.start(
        phone=phone,
        password=lambda: getpass.getpass("Telegram 2FA password (Enter if none): "),
        code_callback=lambda: input("Login code from Telegram: "),
    )
    me = await client.get_me()
    print(f"Logged in as: {me.username or me.phone}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
