"""Fetch data from the configured source into SQLite.

Usage: python -m garmin_dashboard.sync [--days 180] [--full]
"""

from __future__ import annotations

import argparse
import logging
from datetime import date, datetime, timedelta

from .config import config
from .db import Database
from .sources import get_source

log = logging.getLogger(__name__)

REFRESH_DAYS = 3  # always re-fetch the most recent days; Garmin fills them in late


def sync(db: Database, days: int = 180, full: bool = False, today: date | None = None) -> dict:
    today = today or date.today()
    settings = db.settings()
    if settings.get("source") not in (None, config.source):
        log.info("Datakällan har bytts (%s -> %s), rensar gammal data", settings["source"], config.source)
        db.clear_data()
        full = True

    source = get_source(config)
    start = today - timedelta(days=days)
    existing = db.activities(since=start.isoformat())
    if existing and not full:
        last = datetime.fromisoformat(existing[-1]["start_time"]).date()
        act_start = max(start, last - timedelta(days=REFRESH_DAYS))
    else:
        act_start = start

    n_act = db.upsert_activities(source.fetch_activities(act_start, today))

    have = set() if full else db.daily_dates()
    window = [start + timedelta(days=i) for i in range(days + 1)]
    recent = {today - timedelta(days=i) for i in range(REFRESH_DAYS)}
    todo = [d for d in window if d.isoformat() not in have or d in recent]
    n_daily = db.upsert_daily(source.fetch_daily(todo))

    db.save_settings({"last_sync": datetime.now().isoformat(timespec="seconds"), "source": config.source})
    return {"source": source.name, "activities": n_act, "days": n_daily}


def main() -> None:
    parser = argparse.ArgumentParser(description="Synka Garmin-data till lokal databas")
    parser.add_argument("--days", type=int, default=180, help="antal dagar bakåt (default 180)")
    parser.add_argument("--full", action="store_true", help="hämta om allt i perioden")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    result = sync(Database(config.db_path), days=args.days, full=args.full)
    print(f"Klart: {result['activities']} aktiviteter och {result['days']} dagar från {result['source']}.")


if __name__ == "__main__":
    main()
