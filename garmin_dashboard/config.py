"""Configuration loaded from environment variables and an optional .env file."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env parser so we don't need python-dotenv."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Config:
    # demo | garminconnect | health_api
    source: str = os.environ.get("GARMIN_SOURCE", "demo")
    db_path: Path = Path(os.environ.get("DB_PATH", ROOT / "data" / "garmin.db"))

    # garminconnect (Garmin Connect username/password, unofficial API)
    email: str | None = os.environ.get("GARMIN_EMAIL")
    password: str | None = os.environ.get("GARMIN_PASSWORD")
    tokenstore: Path = Path(os.environ.get("GARMIN_TOKENSTORE", Path.home() / ".garminconnect"))

    # Official Garmin Connect Developer Program (Health/Activity API, OAuth 1.0a)
    consumer_key: str | None = os.environ.get("GARMIN_CONSUMER_KEY")
    consumer_secret: str | None = os.environ.get("GARMIN_CONSUMER_SECRET")
    access_token: str | None = os.environ.get("GARMIN_ACCESS_TOKEN")
    access_token_secret: str | None = os.environ.get("GARMIN_ACCESS_TOKEN_SECRET")

    host: str = os.environ.get("HOST", "127.0.0.1")
    port: int = int(os.environ.get("PORT", "8000"))


config = Config()
