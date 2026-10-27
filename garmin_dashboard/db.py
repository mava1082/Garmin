"""SQLite storage for activities, daily wellness metrics and user settings."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,          -- local time, ISO 8601
    sport TEXT NOT NULL,               -- normalized: running, cycling, swimming, strength, walking, other
    type_key TEXT,                     -- raw Garmin activity type
    name TEXT,
    duration_s REAL,
    distance_m REAL,
    elevation_m REAL,
    avg_hr REAL,
    max_hr REAL,
    calories REAL,
    avg_speed REAL,                    -- m/s
    aerobic_te REAL,
    anaerobic_te REAL,
    hr_z1 REAL, hr_z2 REAL, hr_z3 REAL, hr_z4 REAL, hr_z5 REAL,   -- seconds in HR zone
    raw TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(start_time);

CREATE TABLE IF NOT EXISTS daily (
    date TEXT PRIMARY KEY,             -- YYYY-MM-DD
    resting_hr REAL,
    hrv REAL,                          -- last night average, ms
    sleep_s REAL,
    sleep_score REAL,
    body_battery_high REAL,
    body_battery_low REAL,
    steps REAL,
    stress_avg REAL,
    vo2max REAL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

ACTIVITY_COLUMNS = [
    "id", "start_time", "sport", "type_key", "name", "duration_s", "distance_m",
    "elevation_m", "avg_hr", "max_hr", "calories", "avg_speed", "aerobic_te",
    "anaerobic_te", "hr_z1", "hr_z2", "hr_z3", "hr_z4", "hr_z5", "raw",
]
DAILY_COLUMNS = [
    "date", "resting_hr", "hrv", "sleep_s", "sleep_score", "body_battery_high",
    "body_battery_low", "steps", "stress_avg", "vo2max",
]

DEFAULT_SETTINGS: dict[str, Any] = {
    "max_hr": 190,
    "resting_hr": 50,
    "sex": "male",              # affects Banister TRIMP weighting
    "weekly_goal_hours": 6.0,
    "last_sync": None,
    "source": None,
}


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._conn:
            yield self._conn

    # --- activities -------------------------------------------------------
    def upsert_activities(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        cols = ", ".join(ACTIVITY_COLUMNS)
        marks = ", ".join("?" for _ in ACTIVITY_COLUMNS)
        values = []
        for r in rows:
            r = dict(r)
            if isinstance(r.get("raw"), (dict, list)):
                r["raw"] = json.dumps(r["raw"])
            values.append([r.get(c) for c in ACTIVITY_COLUMNS])
        with self.tx() as c:
            c.executemany(f"INSERT OR REPLACE INTO activities ({cols}) VALUES ({marks})", values)
        return len(rows)

    def activities(self, since: str | None = None) -> list[dict[str, Any]]:
        q = "SELECT * FROM activities"
        args: list[Any] = []
        if since:
            q += " WHERE start_time >= ?"
            args.append(since)
        q += " ORDER BY start_time"
        return [dict(r) for r in self._conn.execute(q, args)]

    # --- daily ------------------------------------------------------------
    def upsert_daily(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        cols = ", ".join(DAILY_COLUMNS)
        marks = ", ".join("?" for _ in DAILY_COLUMNS)
        with self.tx() as c:
            c.executemany(
                f"INSERT OR REPLACE INTO daily ({cols}) VALUES ({marks})",
                [[r.get(col) for col in DAILY_COLUMNS] for r in rows],
            )
        return len(rows)

    def daily(self, since: str | None = None) -> list[dict[str, Any]]:
        q = "SELECT * FROM daily"
        args: list[Any] = []
        if since:
            q += " WHERE date >= ?"
            args.append(since)
        q += " ORDER BY date"
        return [dict(r) for r in self._conn.execute(q, args)]

    def daily_dates(self) -> set[str]:
        return {r[0] for r in self._conn.execute("SELECT date FROM daily")}

    # --- settings ---------------------------------------------------------
    def settings(self) -> dict[str, Any]:
        out = dict(DEFAULT_SETTINGS)
        for row in self._conn.execute("SELECT key, value FROM settings"):
            out[row["key"]] = json.loads(row["value"])
        return out

    def save_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        with self.tx() as c:
            c.executemany(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [(k, json.dumps(v)) for k, v in values.items()],
            )
        return self.settings()

    def clear_data(self) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM activities")
            c.execute("DELETE FROM daily")
