"""Garmin Connect via the community `garminconnect` library (email + password).

This is the simplest way for a private person to get their own data: it logs in
like the Garmin Connect app and stores OAuth tokens in GARMIN_TOKENSTORE so the
password is only needed the first time (and when tokens expire).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from . import normalize_sport

log = logging.getLogger(__name__)


def _get(d: Any, *path, default=None):
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and len(d) > p:
            d = d[p]
        else:
            return default
        if d is None:
            return default
    return d


class GarminConnectSource:
    name = "garminconnect"

    def __init__(self, cfg):
        from garminconnect import Garmin

        # login() first tries the saved tokens and falls back to email/password,
        # then writes fresh tokens back to the tokenstore.
        cfg.tokenstore.mkdir(parents=True, exist_ok=True)
        self.api = Garmin(cfg.email, cfg.password, prompt_mfa=lambda: input("MFA-kod: "))
        try:
            self.api.login(str(cfg.tokenstore))
        except Exception as e:
            raise RuntimeError(
                f"Inloggning mot Garmin Connect misslyckades: {e}. Kontrollera GARMIN_EMAIL/"
                "GARMIN_PASSWORD i .env, eller kör `python -m garmin_dashboard.sync` i en "
                "terminal för att kunna skriva in en MFA-kod."
            ) from e

    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]:
        raw = self.api.get_activities_by_date(start.isoformat(), end.isoformat())
        return [self._activity(a) for a in raw]

    @staticmethod
    def _activity(a: dict[str, Any]) -> dict[str, Any]:
        type_key = _get(a, "activityType", "typeKey")
        start = (a.get("startTimeLocal") or "").replace(" ", "T")
        return {
            "id": str(a["activityId"]),
            "start_time": start,
            "sport": normalize_sport(type_key),
            "type_key": type_key,
            "name": a.get("activityName"),
            "duration_s": a.get("duration"),
            "distance_m": a.get("distance") or None,
            "elevation_m": a.get("elevationGain"),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "calories": a.get("calories"),
            "avg_speed": a.get("averageSpeed") or None,
            "aerobic_te": a.get("aerobicTrainingEffect"),
            "anaerobic_te": a.get("anaerobicTrainingEffect"),
            **{f"hr_z{i}": a.get(f"hrTimeInZone_{i}") for i in range(1, 6)},
            "raw": a,
        }

    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]:
        rows = []
        for d in days:
            ds = d.isoformat()
            row: dict[str, Any] = {"date": ds}
            try:
                stats = self.api.get_stats(ds) or {}
                row.update(
                    resting_hr=stats.get("restingHeartRate"),
                    steps=stats.get("totalSteps"),
                    stress_avg=stats.get("averageStressLevel"),
                    body_battery_high=stats.get("bodyBatteryHighestValue"),
                    body_battery_low=stats.get("bodyBatteryLowestValue"),
                )
            except Exception as e:  # one bad endpoint shouldn't stop the sync
                log.warning("stats %s: %s", ds, e)
            try:
                sleep = self.api.get_sleep_data(ds) or {}
                row["sleep_s"] = _get(sleep, "dailySleepDTO", "sleepTimeSeconds")
                row["sleep_score"] = _get(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
            except Exception as e:
                log.warning("sleep %s: %s", ds, e)
            try:
                row["hrv"] = _get(self.api.get_hrv_data(ds), "hrvSummary", "lastNightAvg")
            except Exception as e:
                log.warning("hrv %s: %s", ds, e)
            try:
                row["vo2max"] = _get(self.api.get_max_metrics(ds), 0, "generic", "vo2MaxPreciseValue")
            except Exception as e:
                log.warning("vo2max %s: %s", ds, e)
            rows.append(row)
        return rows
