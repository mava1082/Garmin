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


@dataclass
class Config:
    # demo | personal_api | garminconnect. Defaults to personal_api when a key is set.
    source: str = os.environ.get("GARMIN_SOURCE") or (
        "personal_api" if os.environ.get("GARMIN_PERSONAL_API_KEY") else "demo")
    db_path: Path = Path(os.environ.get("DB_PATH", ROOT / "data" / "garmin.db"))

    # Official Garmin Connect Personal API (self-service key from Garmin Connect)
    personal_api_key: str | None = os.environ.get("GARMIN_PERSONAL_API_KEY") or None

    # garminconnect (Garmin Connect username/password, unofficial API)
    email: str | None = os.environ.get("GARMIN_EMAIL")
    password: str | None = os.environ.get("GARMIN_PASSWORD")
    tokenstore: Path = Path(os.environ.get("GARMIN_TOKENSTORE", Path.home() / ".garminconnect"))

    host: str = os.environ.get("HOST", "127.0.0.1")
    port: int = int(os.environ.get("PORT", "8000"))


config = Config()


def save_env(values: dict[str, str], path: Path = ROOT / ".env") -> None:
    """Write/replace KEY=value lines in .env, keeping everything else as is."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = dict(values)
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip().lstrip("# ").strip()
        if key in pending and "=" in line:
            lines[i] = f"{key}={pending.pop(key)}"
    lines += [f"{k}={v}" for k, v in pending.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if os.name == "posix":
        path.chmod(0o600)  # the file holds an API key
    os.environ.update(values)
