"""Synthetic but realistic training data so the dashboard works without credentials."""

from __future__ import annotations

import math
import random
from datetime import date, datetime, time, timedelta
from typing import Any

# (sport, kind, base minutes) per weekday, Monday = 0
WEEK_TEMPLATE: dict[int, list[tuple[str, str, int]]] = {
    0: [("strength", "strength", 40)],
    1: [("running", "intervals", 55)],
    2: [("cycling", "easy", 60)],
    3: [("running", "tempo", 50)],
    4: [],
    5: [("running", "long", 85)],
    6: [("cycling", "long", 120)],
}

# kind -> (avg HR fraction of HR reserve, zone distribution z1..z5)
INTENSITY = {
    "easy": (0.62, [0.30, 0.62, 0.08, 0.0, 0.0]),
    "long": (0.66, [0.20, 0.65, 0.13, 0.02, 0.0]),
    "tempo": (0.80, [0.10, 0.20, 0.45, 0.25, 0.0]),
    "intervals": (0.78, [0.15, 0.30, 0.15, 0.25, 0.15]),
    "strength": (0.50, [0.70, 0.25, 0.05, 0.0, 0.0]),
}

MAX_HR, REST_HR = 190, 48
HISTORY_DAYS = 400


class DemoSource:
    name = "demo"

    def __init__(self, today: date | None = None):
        self.today = today or date.today()
        self._activities, self._daily = self._simulate()

    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]:
        now = datetime.now().isoformat()
        return [a for a in self._activities
                if start.isoformat() <= a["start_time"][:10] <= end.isoformat() and a["start_time"] <= now]

    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]:
        wanted = {d.isoformat() for d in days}
        return [d for d in self._daily if d["date"] in wanted]

    # ------------------------------------------------------------------
    def _simulate(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        rng = random.Random(1082)
        start = self.today - timedelta(days=HISTORY_DAYS)
        activities: list[dict[str, Any]] = []
        daily: list[dict[str, Any]] = []
        fatigue = fitness = 0.0

        for i in range(HISTORY_DAYS + 1):
            day = start + timedelta(days=i)
            week = i // 7
            block_week = week % 4
            progression = 0.75 + 0.35 * min(week / 40, 1.0)
            volume = progression * (0.6 if block_week == 3 else 1.0 + 0.06 * block_week)
            sick = 180 <= i <= 186  # a week of illness for realism
            day_load = 0.0

            for sport, kind, minutes in WEEK_TEMPLATE[day.weekday()]:
                if sick or rng.random() < 0.08:  # missed session
                    continue
                if block_week == 3 and kind in ("intervals", "tempo"):
                    kind = "easy"
                act = self._activity(rng, day, sport, kind, minutes * volume * rng.uniform(0.85, 1.15), progression)
                activities.append(act)
                hrr = (act["avg_hr"] - REST_HR) / (MAX_HR - REST_HR)
                day_load += act["duration_s"] / 60 * hrr * 0.64 * math.exp(1.92 * hrr)

            fitness += (day_load - fitness) / 42
            fatigue += (day_load - fatigue) / 7
            strain = max(fatigue - fitness, 0) + (25 if sick else 0)
            daily.append(self._daily_row(rng, day, strain, progression, bool(day_load)))

        return activities, daily

    def _activity(self, rng: random.Random, day: date, sport: str, kind: str, minutes: float,
                  progression: float) -> dict[str, Any]:
        hrr, zones = INTENSITY["strength" if sport == "strength" else kind]
        avg_hr = REST_HR + (MAX_HR - REST_HR) * (hrr + rng.uniform(-0.03, 0.03))
        duration = minutes * 60
        speed = None
        distance = None
        if sport == "running":
            base = {"easy": 2.85, "long": 2.9, "tempo": 3.45, "intervals": 3.35}[kind]
            speed = base * (0.92 + 0.1 * progression) * rng.uniform(0.97, 1.03)
        elif sport == "cycling":
            speed = {"easy": 7.2, "long": 7.6}.get(kind, 8.0) * rng.uniform(0.92, 1.08)
        if speed:
            distance = speed * duration
        hour = 7 if day.weekday() >= 5 else rng.choice([6, 17, 18])
        start = datetime.combine(day, time(hour, rng.randint(0, 59)))
        names = {
            ("running", "easy"): "Lugn löpning", ("running", "long"): "Långpass",
            ("running", "tempo"): "Tempolöpning", ("running", "intervals"): "Intervaller 6x1000 m",
            ("cycling", "easy"): "Lugn cykling", ("cycling", "long"): "Lång cykeltur",
            ("strength", "strength"): "Styrketräning",
        }
        z = [duration * f * rng.uniform(0.9, 1.1) for f in zones]
        scale = duration / sum(z)
        return {
            "id": f"demo-{start:%Y%m%d%H%M}-{sport}",
            "start_time": start.isoformat(),
            "sport": sport,
            "type_key": {"running": "running", "cycling": "road_biking", "strength": "strength_training"}[sport],
            "name": names.get((sport, kind), sport.title()),
            "duration_s": round(duration),
            "distance_m": round(distance) if distance else None,
            "elevation_m": round(distance / 1000 * rng.uniform(4, 12)) if distance else None,
            "avg_hr": round(avg_hr),
            "max_hr": round(min(MAX_HR, avg_hr + rng.uniform(12, 25))),
            "calories": round(duration / 60 * (avg_hr / 15)),
            "avg_speed": speed,
            "aerobic_te": round(min(5.0, 1.5 + hrr * 3 + minutes / 120), 1),
            "anaerobic_te": round({"intervals": 2.8, "tempo": 1.6}.get(kind, 0.3) * rng.uniform(0.8, 1.2), 1),
            "hr_z1": round(z[0] * scale), "hr_z2": round(z[1] * scale), "hr_z3": round(z[2] * scale),
            "hr_z4": round(z[3] * scale), "hr_z5": round(z[4] * scale),
            "raw": None,
        }

    def _daily_row(self, rng: random.Random, day: date, strain: float, progression: float,
                   trained: bool) -> dict[str, Any]:
        sleep_h = rng.gauss(7.4 if day.weekday() < 5 else 8.0, 0.6)
        return {
            "date": day.isoformat(),
            "resting_hr": round(REST_HR + 3 - 3 * progression + strain * 0.12 + rng.gauss(0, 1.2)),
            "hrv": round(52 + 10 * progression - strain * 0.35 + (sleep_h - 7.5) * 2 + rng.gauss(0, 3.5)),
            "sleep_s": round(sleep_h * 3600),
            "sleep_score": round(max(30, min(98, 60 + (sleep_h - 6.5) * 12 - strain * 0.2 + rng.gauss(0, 5)))),
            "body_battery_high": round(max(20, min(100, 70 + (sleep_h - 7) * 10 - strain * 0.4 + rng.gauss(0, 6)))),
            "body_battery_low": round(max(5, rng.gauss(25 if trained else 35, 7))),
            "steps": round(max(1500, rng.gauss(9000, 2500))),
            "stress_avg": round(max(10, rng.gauss(28 + strain * 0.2, 6))),
            "vo2max": round(49 + 5 * progression, 1),
        }
