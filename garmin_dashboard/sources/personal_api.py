"""Garmin Connect Personal API (official, self-service API key).

Create a key while logged in to Garmin Connect on the web (Developer -> Personal
API Key) and put it in GARMIN_PERSONAL_API_KEY. Garmin's own client exchanges the
key for a 24h bearer token and caches it in ~/.config/garmin/.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Callable

from .connect_format import (
    connect_activity, daily_summary_fields, find_records, hrv_value, record_date, sleep_fields,
)

log = logging.getLogger(__name__)

CHUNK_DAYS = 28    # keep range requests modest
PAGE_SIZE = 100
MAX_PAGES = 100


class PersonalApiSource:
    name = "personal_api"

    def __init__(self, cfg, client=None, authenticator=None):
        if client is not None:  # injected in tests
            self.client, self._auth, self._key = client, None, None
            return
        from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator, resolve_api_key

        try:
            self._key = resolve_api_key(cfg.personal_api_key)
            self._auth = authenticator or PersonalApiAuthenticator()
            token = self._auth.obtain_token(self._key)
        except Exception as e:  # bad/expired key (HttpError) or no network
            raise RuntimeError(
                f"Kunde inte hämta token med Personal API-nyckeln: {e}. Kontrollera GARMIN_PERSONAL_API_KEY "
                "i .env, att nyckeln inte har gått ut och att datorn når personal.connectapi.garmin.com."
            ) from e
        self.client = GarminPersonalApiClient(token.access_token)

    def _call(self, fn: Callable[..., Any], *args, **kwargs) -> Any:
        """Call the API, minting a new bearer token once if the cached one was rejected."""
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if getattr(e, "status_code", None) != 401 or self._auth is None:
                raise
            log.info("Bearer token rejected, requesting a new one")
            self.client.update_bearer_token(self._auth.obtain_token(self._key, force_refresh=True).access_token)
            return fn(*args, **kwargs)

    def _try(self, label: str, fn: Callable[..., Any], *args, **kwargs) -> Any:
        try:
            return self._call(fn, *args, **kwargs)
        except Exception as e:  # one bad endpoint shouldn't stop the sync
            log.warning("%s: %s", label, e)
            return None

    # --- activities -------------------------------------------------------
    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for page in range(MAX_PAGES):
            batch = self._call(self.client.search_activities, start=page * PAGE_SIZE, limit=PAGE_SIZE,
                               start_date=start, end_date=end) or []
            out.extend(connect_activity(a) for a in batch if a.get("activityId"))
            if len(batch) < PAGE_SIZE:
                break
        return out

    # --- daily ------------------------------------------------------------
    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {d.isoformat(): {"date": d.isoformat()} for d in days}
        for lo, hi in _chunks(sorted(days)):
            label = f"{lo}..{hi}"

            summaries = self._try(f"dailysummaries {label}", self.client.get_daily_summaries, lo, hi)
            for rec in find_records(summaries, "restingHeartRate", "totalSteps"):
                if (r := rows.get(record_date(rec))) is not None:
                    r.update({k: v for k, v in daily_summary_fields(rec).items() if v is not None})

            hrv = self._try(f"hrv {label}", self.client.get_daily_hrv_summaries, lo, hi)
            for rec in find_records(hrv, "lastNightAvg", "hrvSummary"):
                if (r := rows.get(record_date(rec))) is not None:
                    r["hrv"] = hrv_value(rec)

            sleep = self._try(f"sleep {label}", self.client.get_daily_sleep_summaries, lo, hi)
            found = False
            for rec in find_records(sleep, "sleepTimeSeconds", "dailySleepDTO"):
                if (r := rows.get(record_date(rec))) is not None:
                    r.update(sleep_fields(rec))
                    found = True
            if not found:  # unknown range format or endpoint failed: fall back to one call per day
                for d in (lo + timedelta(days=i) for i in range((hi - lo).days + 1)):
                    if (r := rows.get(d.isoformat())) is None:
                        continue
                    rec = self._try(f"sleep {d}", self.client.get_daily_sleep, d)
                    if isinstance(rec, dict):
                        r.update(sleep_fields(rec))
        return list(rows.values())

    # --- profile ------------------------------------------------------------
    def profile(self) -> dict[str, Any]:
        """Max/resting HR from the user's Garmin heart rate zones, if available."""
        zones = self._try("heartRateZones", self.client.get_heart_rate_zones)
        if isinstance(zones, dict):
            zones = [zones]
        if not isinstance(zones, list) or not zones:
            return {}
        z = next((z for z in zones if isinstance(z, dict) and z.get("sport") == "DEFAULT"), zones[0])
        out = {}
        if isinstance(z, dict) and z.get("maxHeartRateUsed"):
            out["max_hr"] = int(z["maxHeartRateUsed"])
        if isinstance(z, dict) and z.get("restingHeartRateUsed"):
            out["resting_hr"] = int(z["restingHeartRateUsed"])
        return out


def _chunks(days: list[date]) -> list[tuple[date, date]]:
    """Split sorted days into contiguous ranges of at most CHUNK_DAYS days."""
    out: list[tuple[date, date]] = []
    for d in days:
        if out and (d - out[-1][1]).days == 1 and (d - out[-1][0]).days < CHUNK_DAYS:
            out[-1] = (out[-1][0], d)
        else:
            out.append((d, d))
    return out
