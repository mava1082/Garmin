"""Official Garmin Connect Developer Program (Health API + Activity API).

Requires an approved developer account. Garmin gives you a *consumer key* and
*consumer secret*; each user (you) then authorizes the app once via OAuth 1.0a,
which yields an access token + secret. Run `python -m garmin_dashboard.health_auth`
to do that step.

Data is pulled from the summary endpoints in 24h windows of *upload time*.
Note: Garmin's pull endpoints only serve data within their retention window,
and some app configurations are push-only - check your developer portal settings.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from . import normalize_sport

log = logging.getLogger(__name__)

BASE = "https://apis.garmin.com/wellness-api/rest"


class HealthApiSource:
    name = "health_api"

    def __init__(self, cfg):
        from requests_oauthlib import OAuth1Session

        missing = [k for k in ("consumer_key", "consumer_secret", "access_token", "access_token_secret")
                   if not getattr(cfg, k)]
        if missing:
            raise RuntimeError(
                "Health API kräver GARMIN_CONSUMER_KEY, GARMIN_CONSUMER_SECRET, GARMIN_ACCESS_TOKEN och "
                "GARMIN_ACCESS_TOKEN_SECRET. Kör `python -m garmin_dashboard.health_auth` för att få "
                "access-token."
            )
        self.session = OAuth1Session(
            cfg.consumer_key,
            client_secret=cfg.consumer_secret,
            resource_owner_key=cfg.access_token,
            resource_owner_secret=cfg.access_token_secret,
        )
        self._cache: dict[tuple[str, date], list[dict[str, Any]]] = {}

    def _pull(self, endpoint: str, day: date) -> list[dict[str, Any]]:
        key = (endpoint, day)
        if key not in self._cache:
            start = int(datetime.combine(day, time.min, tzinfo=timezone.utc).timestamp())
            resp = self.session.get(
                f"{BASE}/{endpoint}",
                params={"uploadStartTimeInSeconds": start, "uploadEndTimeInSeconds": start + 86400},
                timeout=30,
            )
            if resp.status_code != 200:
                log.warning("%s %s: HTTP %s %s", endpoint, day, resp.status_code, resp.text[:200])
                self._cache[key] = []
            else:
                self._cache[key] = resp.json() or []
        return self._cache[key]

    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]:
        out = []
        d = start
        while d <= end:
            for a in self._pull("activities", d):
                out.append(self._activity(a))
            d += timedelta(days=1)
        return out

    @staticmethod
    def _activity(a: dict[str, Any]) -> dict[str, Any]:
        offset = a.get("startTimeOffsetInSeconds") or 0
        start = datetime.fromtimestamp(a["startTimeInSeconds"] + offset, tz=timezone.utc).replace(tzinfo=None)
        type_key = (a.get("activityType") or "").lower()
        return {
            "id": str(a.get("summaryId") or a.get("activityId")),
            "start_time": start.isoformat(),
            "sport": normalize_sport(type_key),
            "type_key": type_key,
            "name": a.get("activityName") or type_key.replace("_", " ").title(),
            "duration_s": a.get("durationInSeconds"),
            "distance_m": a.get("distanceInMeters"),
            "elevation_m": a.get("totalElevationGainInMeters"),
            "avg_hr": a.get("averageHeartRateInBeatsPerMinute"),
            "max_hr": a.get("maxHeartRateInBeatsPerMinute"),
            "calories": a.get("activeKilocalories"),
            "avg_speed": a.get("averageSpeedInMetersPerSecond"),
            "raw": a,
        }

    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]:
        # Summaries are keyed by upload time, so scan each day plus the next one
        # (sleep/HRV for night N is usually uploaded the morning of N+1).
        rows: dict[str, dict[str, Any]] = {d.isoformat(): {"date": d.isoformat()} for d in days}
        scan = sorted({d for day in days for d in (day, day + timedelta(days=1)) if d <= date.today()})
        for d in scan:
            for s in self._pull("dailies", d):
                r = rows.get(s.get("calendarDate"))
                if r is not None:
                    r.update(
                        resting_hr=s.get("restingHeartRateInBeatsPerMinute"),
                        steps=s.get("steps"),
                        stress_avg=s.get("averageStressLevel"),
                        body_battery_high=s.get("bodyBatteryHighestValue"),
                        body_battery_low=s.get("bodyBatteryLowestValue"),
                    )
            for s in self._pull("sleeps", d):
                r = rows.get(s.get("calendarDate"))
                if r is not None:
                    r["sleep_s"] = s.get("durationInSeconds")
                    r["sleep_score"] = (s.get("overallSleepScore") or {}).get("value")
            for s in self._pull("hrv", d):
                r = rows.get(s.get("calendarDate"))
                if r is not None:
                    r["hrv"] = s.get("lastNightAvg")
        return list(rows.values())
