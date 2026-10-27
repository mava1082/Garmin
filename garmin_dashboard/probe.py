"""Check what the Personal API returns, without printing your actual values.

Usage: python -m garmin_dashboard.probe
Prints the structure (keys and types) of each endpoint the dashboard uses, plus
what the dashboard parsed out of it. Safe to share when something looks off.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from .config import config
from .sources.personal_api import PersonalApiSource


def shape(obj: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if isinstance(obj, dict):
        return {k: shape(v, depth + 1) for k, v in list(obj.items())[:40]}
    if isinstance(obj, list):
        return [shape(obj[0], depth + 1), f"({len(obj)} st)"] if obj else []
    return type(obj).__name__


def main() -> None:
    src = PersonalApiSource(config)
    c = src.client
    day = date.today() - timedelta(days=1)
    week = day - timedelta(days=6)
    checks = {
        "search_activities": lambda: c.search_activities(limit=1, start_date=week, end_date=day),
        "get_daily_summaries": lambda: c.get_daily_summaries(day, day),
        "get_daily_hrv_summaries": lambda: c.get_daily_hrv_summaries(week, day),
        "get_daily_sleep_summaries": lambda: c.get_daily_sleep_summaries(day, day),
        "get_daily_sleep": lambda: c.get_daily_sleep(day),
        "get_heart_rate_zones": c.get_heart_rate_zones,
    }
    for name, fn in checks.items():
        print(f"\n== {name}")
        try:
            print(json.dumps(shape(fn()), indent=1, ensure_ascii=False)[:2500])
        except Exception as e:
            print(f"FEL: {e}")
    print("\n== Tolkat av dashboarden för", day)
    parsed = (src.fetch_daily([day]) or [{"date": day}])[0]
    print({k: ("✓" if v is not None else "saknas") for k, v in parsed.items() if k != "date"})
    print("Profil:", {k: "✓" for k in src.profile()} or "saknas")


if __name__ == "__main__":
    main()
