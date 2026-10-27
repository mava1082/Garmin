"""Parsing helpers for Garmin Connect JSON.

Both the official Personal API and the `garminconnect` library expose Garmin
Connect's own services, so the response formats are shared.
"""

from __future__ import annotations

from typing import Any, Iterator

from . import normalize_sport


def dig(d: Any, *path, default=None):
    """Safely walk nested dicts/lists: dig(x, "a", 0, "b")."""
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


def find_records(obj: Any, *keys: str) -> Iterator[dict[str, Any]]:
    """Yield every nested dict that has a calendar date and at least one of `keys`.

    Range endpoints wrap their per-day items differently ({"data": [...]},
    {"hrvSummaries": [...]}, a bare list...), so search instead of hard-coding.
    """
    if isinstance(obj, dict):
        day = obj.get("calendarDate") or obj.get("date")
        if isinstance(day, str) and any(k in obj for k in keys):
            yield obj
            return
        for v in obj.values():
            yield from find_records(v, *keys)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_records(v, *keys)


def record_date(rec: dict[str, Any]) -> str:
    return (rec.get("calendarDate") or rec.get("date"))[:10]


def connect_activity(a: dict[str, Any]) -> dict[str, Any]:
    """Map an activity from activitylist-service to our activities row."""
    type_key = dig(a, "activityType", "typeKey")
    return {
        "id": str(a["activityId"]),
        "start_time": (a.get("startTimeLocal") or "").replace(" ", "T"),
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


def daily_summary_fields(s: dict[str, Any]) -> dict[str, Any]:
    """Fields from a daily summary: flat usersummary format or the nested v2 dailysummaries format."""
    return {
        "resting_hr": s.get("restingHeartRate") or dig(s, "heartRate", "restingValue"),
        "steps": s.get("totalSteps") or dig(s, "movement", "steps", "value"),
        "stress_avg": s.get("averageStressLevel") or dig(s, "stress", "avgLevel"),
        "body_battery_high": s.get("bodyBatteryHighestValue") or dig(s, "bodyBattery", "maxValue"),
        "body_battery_low": s.get("bodyBatteryLowestValue") or dig(s, "bodyBattery", "minValue"),
    }


DAILY_SUMMARY_KEYS = ("restingHeartRate", "totalSteps", "heartRate", "movement", "bodyBattery", "stress")


def sleep_fields(s: dict[str, Any]) -> dict[str, Any]:
    """Fields from a sleep record (either a dailySleepDTO or a wrapper holding one)."""
    dto = s.get("dailySleepDTO") or s
    return {
        "sleep_s": dto.get("sleepTimeSeconds"),
        "sleep_score": dig(dto, "sleepScores", "overall", "value"),
    }


def hrv_value(s: dict[str, Any]) -> float | None:
    return (s.get("hrvSummary") or s).get("lastNightAvg")
