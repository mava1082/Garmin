"""Build the dashboard as a static, password-encrypted site (for GitHub Pages).

Usage: DASHBOARD_PASSWORD=... python -m garmin_dashboard.build_static --out site

Syncs from the configured source, computes the dashboard for every period and
writes it AES-256-GCM encrypted (key from PBKDF2-SHA256 of the password), so the
published site is unreadable without the password. The browser decrypts it
with WebCrypto.
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import secrets
import shutil
from pathlib import Path

from .analytics import build_dashboard
from .config import ROOT, config
from .db import Database
from .sync import sync

PERIODS = (30, 90, 180, 365)
PBKDF2_ITERATIONS = 600_000
STATIC = Path(__file__).parent / "static"
SETTINGS_FILE = ROOT / "settings.json"
EDITABLE_SETTINGS = ("weekly_goal_hours", "sex", "max_hr", "resting_hr")

log = logging.getLogger(__name__)


def encrypt(payload: bytes, password: str) -> dict:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS).derive(
        password.encode("utf-8"))
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": PBKDF2_ITERATIONS, "salt": b64(salt), "iv": b64(iv),
            "data": b64(AESGCM(key).encrypt(iv, payload, None))}


def apply_settings_file(db: Database, path: Path = SETTINGS_FILE) -> None:
    """settings.json in the repo replaces the settings dialog. null HR = take it from Garmin."""
    if not path.exists():
        return
    values = {k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items() if k in EDITABLE_SETTINGS}
    manual_hr = {k: values.pop(k) for k in ("max_hr", "resting_hr") if k in values}
    manual_hr = {k: v for k, v in manual_hr.items() if v is not None}
    values.update(manual_hr, hr_auto=not manual_hr)
    db.save_settings(values)


def build(out: Path, password: str, repo: str | None = None, branch: str | None = None) -> dict:
    if len(password) < 8:
        raise SystemExit("DASHBOARD_PASSWORD måste vara minst 8 tecken.")
    db = Database(config.db_path)
    apply_settings_file(db)
    result = sync(db, days=max(PERIODS) + 60)  # extra history warms up the fitness curve
    apply_settings_file(db)  # manual HR in settings.json wins over Garmin's zones

    acts, daily, settings = db.activities(), db.daily(), db.settings()
    bundle = {"periods": {}}
    for days in PERIODS:
        data = build_dashboard(acts, daily, settings, days=days)
        data["source"] = config.source
        bundle["periods"][str(days)] = data

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)
    index = (out / "index.html").read_text(encoding="utf-8").replace('"/static/', '"./')
    static_cfg = {"repo": repo, "branch": branch}
    index = index.replace(
        '<script src="./app.js"></script>',
        f"<script>window.DASHBOARD_STATIC = {json.dumps(static_cfg)};</script>\n  <script src=\"./app.js\"></script>",
    )
    (out / "index.html").write_text(index, encoding="utf-8")
    (out / "data.enc.json").write_text(
        json.dumps(encrypt(json.dumps(bundle, separators=(",", ":")).encode("utf-8"), password)), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Bygg krypterad statisk dashboard")
    parser.add_argument("--out", type=Path, default=ROOT / "site")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    password = os.environ.get("DASHBOARD_PASSWORD", "")
    repo = os.environ.get("GITHUB_REPOSITORY")
    branch = os.environ.get("GITHUB_REF_NAME")
    result = build(args.out, password, repo, branch)
    print(f"Byggt till {args.out}: {result['activities']} aktiviteter, {result['days']} dagar från {result['source']}.")


if __name__ == "__main__":
    main()
