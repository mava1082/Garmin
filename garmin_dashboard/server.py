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
from .config import config
from .db import Database
from .sync import sync

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Garmin träningsdashboard")
db = Database(config.db_path)
_sync_lock = threading.Lock()


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


@app.get("/api/settings")
def get_settings() -> dict:
    return db.settings()


@app.put("/api/settings")
def put_settings(body: SettingsIn) -> dict:
    return db.save_settings(body.model_dump())


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    print(f"Dashboard: http://{config.host}:{config.port}  (källa: {config.source})")
    uvicorn.run(app, host=config.host, port=config.port)


if __name__ == "__main__":
    main()
