"""Web server: JSON API + static dashboard.

Usage: python -m garmin_dashboard.server   (then open http://127.0.0.1:8000)
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .analytics import build_dashboard
from .config import config, save_env
from .db import Database
from .sync import sync

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Garmin träningsdashboard")
db = Database(config.db_path)
_sync_lock = threading.Lock()


class SetupIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=4096)


class SettingsIn(BaseModel):
    max_hr: int = Field(ge=120, le=230)
    resting_hr: int = Field(ge=25, le=100)
    sex: Literal["male", "female"]
    weekly_goal_hours: float = Field(ge=0, le=40)


def _run_sync(days: int, full: bool) -> dict:
    if not _sync_lock.acquire(blocking=False):
        raise HTTPException(409, "En synkning pågår redan")
    try:
        return sync(db, days=days, full=full)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("sync failed")
        raise HTTPException(502, f"Synkningen misslyckades: {e}") from e
    finally:
        _sync_lock.release()


@app.on_event("startup")
async def _bootstrap() -> None:
    # Demo mode should show something immediately on first start.
    if config.source == "demo" and not db.activities():
        await run_in_threadpool(_run_sync, 400, True)


@app.get("/api/dashboard")
def dashboard(days: int = 90) -> dict:
    days = max(14, min(days, 365))
    data = build_dashboard(db.activities(), db.daily(), db.settings(), days=days)
    data["source"] = config.source
    return data


@app.post("/api/sync")
async def trigger_sync(days: int = 180, full: bool = False) -> dict:
    return await run_in_threadpool(_run_sync, max(1, min(days, 730)), full)


@app.post("/api/setup")
def setup(body: SetupIn) -> dict:
    """Connect the Personal API from the browser: verify the key, then store it in .env."""
    from types import SimpleNamespace

    from .sources.personal_api import PersonalApiSource

    key = body.api_key.strip()
    try:
        PersonalApiSource(SimpleNamespace(personal_api_key=key))
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from e
    save_env({"GARMIN_PERSONAL_API_KEY": key, "GARMIN_SOURCE": "personal_api"})
    config.personal_api_key, config.source = key, "personal_api"
    return {"ok": True, "source": config.source}


@app.get("/api/settings")
def get_settings() -> dict:
    return db.settings()


@app.put("/api/settings")
def put_settings(body: SettingsIn) -> dict:
    values = body.model_dump()
    current = db.settings()
    if (values["max_hr"], values["resting_hr"]) != (current["max_hr"], current["resting_hr"]):
        values["hr_auto"] = False  # the user's own numbers win over Garmin's from now on
    return db.save_settings(values)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def main() -> None:
    import argparse
    import webbrowser

    import uvicorn

    parser = argparse.ArgumentParser(description="Starta träningsdashboarden")
    parser.add_argument("--open", action="store_true", help="öppna webbläsaren automatiskt")
    args = parser.parse_args()

    url = f"http://{config.host}:{config.port}"
    logging.basicConfig(level=logging.INFO)
    print(f"\nDashboarden körs på {url}  (källa: {config.source})")
    print("Låt det här fönstret vara öppet. Stäng det för att avsluta.\n")
    if args.open:
        threading.Timer(2.0, webbrowser.open, args=[url]).start()
    uvicorn.run(app, host=config.host, port=config.port, log_level="warning")


if __name__ == "__main__":
    main()
