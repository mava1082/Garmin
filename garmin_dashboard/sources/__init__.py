"""Data sources. Each source yields normalized activity and daily rows (see db.py)."""

from __future__ import annotations

from datetime import date
from typing import Any, Protocol


class Source(Protocol):
    name: str

    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]: ...

    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]: ...


SPORT_KEYWORDS = [
    ("running", ("run",)),
    ("cycling", ("cycl", "bik", "ride", "spin")),
    ("swimming", ("swim",)),
    ("strength", ("strength", "weight", "hiit", "cardio_training", "fitness_equipment")),
    ("walking", ("walk", "hik")),
    ("skiing", ("ski",)),
]


def normalize_sport(type_key: str | None) -> str:
    key = (type_key or "").lower()
    for sport, needles in SPORT_KEYWORDS:
        if any(n in key for n in needles):
            return sport
    return "other"


def get_source(cfg) -> Source:
    if cfg.source == "demo":
        from .demo import DemoSource
        return DemoSource()
    if cfg.source == "garminconnect":
        from .garminconnect_source import GarminConnectSource
        return GarminConnectSource(cfg)
    if cfg.source == "health_api":
        from .health_api import HealthApiSource
        return HealthApiSource(cfg)
    raise ValueError(f"Okänd GARMIN_SOURCE: {cfg.source!r} (demo | garminconnect | health_api)")
