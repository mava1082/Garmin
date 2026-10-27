"""Garmin Connect Personal API (official, self-service API key).

Create a key while logged in to Garmin Connect on the web (Developer -> Personal
API Key) and put it in GARMIN_PERSONAL_API_KEY. Garmin's own client exchanges the
key for a 24h bearer token and caches it in ~/.config/garmin/.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from typing import Any, Callable

from .connect_format import (
    connect_activity, daily_summary_fields, find_records, hrv_value, record_date, sleep_fields,
)

log = logging.getLogger(__name__)

CHUNK_DAYS = 28    # keep range requests modest
PAGE_SIZE = 100
MAX_PAGES = 100
# Garmin allows about 100 requests per minute; stay safely below it.
MIN_INTERVAL_S = 0.7
MAX_RATE_LIMIT_RETRIES = 3
FAILED = object()  # marker: the request failed, so the data is unknown (not just empty)


class PersonalApiSource:
    name = "personal_api"

    def __init__(self, cfg, client=None, authenticator=None, sleep=time.sleep, clock=time.monotonic):
        self._sleep, self._clock, self._last_call = sleep, clock, None
        if client is not None:  # injected in tests
            self.client, self._auth, self._key = client, None, None
            return
        from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator, resolve_api_key

        try:
            self._key = resolve_api_key(cfg.personal_api_key)
            self._auth = authenticator or PersonalApiAuthenticator()
            token = self._auth.obtain_token(self._key)
        except Exception as e:
            status = getattr(e, "status_code", None)
            if status in (400, 401, 403):
                msg = ("Garmin godkände inte nyckeln. Kontrollera att du klistrat in hela nyckeln "
                       "och att den inte har gått ut.")
            elif status is not None:
                msg = f"Garmin svarade med ett fel (HTTP {status}). Försök igen om en stund."
            else:
                msg = "Kunde inte nå Garmin. Kontrollera internetanslutningen och försök igen."
            log.warning("Token exchange failed: %s", e)
            raise RuntimeError(msg) from e
        self.client = GarminPersonalApiClient(token.access_token)

    def _throttled(self, fn: Callable[..., Any], *args, **kwargs) -> Any:
        if self._last_call is not None:
            wait = MIN_INTERVAL_S - (self._clock() - self._last_call)
            if wait > 0:
                self._sleep(wait)
        self._last_call = self._clock()
        return fn(*args, **kwargs)

    def _call(self, fn: Callable[..., Any], *args, **kwargs) -> Any:
        """Call the API at a safe pace, waiting out rate limits and renewing a rejected token once."""
        renewed = False
        for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
            try:
                return self._throttled(fn, *args, **kwargs)
            except Exception as e:
                status = getattr(e, "status_code", None)
                if status == 429 and attempt < MAX_RATE_LIMIT_RETRIES:
                    wait = _retry_after(e)
                    log.info("Rate limited by Garmin, waiting %.0f s", wait)
                    self._sleep(wait)
                elif status == 401 and self._auth is not None and not renewed:
                    log.info("Bearer token rejected, requesting a new one")
                    token = self._auth.obtain_token(self._key, force_refresh=True)
                    self.client.update_bearer_token(token.access_token)
                    renewed = True
                else:
                    raise
        raise RuntimeError("unreachable")

    def _try(self, label: str, fn: Callable[..., Any], *args, **kwargs) -> Any:
        try:
            return self._call(fn, *args, **kwargs)
        except Exception as e:  # one bad endpoint shouldn't stop the sync
            log.warning("%s: %s", label, e)
            return FAILED

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
        """Daily rows for `days`. Days where a request failed are left out so the next sync retries them."""
        rows: dict[str, dict[str, Any]] = {d.isoformat(): {"date": d.isoformat()} for d in days}
        failed: set[str] = set()
        for lo, hi in _chunks(sorted(days)):
            label = f"{lo}..{hi}"
            chunk = [(lo + timedelta(days=i)).isoformat() for i in range((hi - lo).days + 1)]

            summaries = self._try(f"dailysummaries {label}", self.client.get_daily_summaries, lo, hi)
            if summaries is FAILED:
                failed.update(chunk)
            for rec in find_records(summaries, "restingHeartRate", "totalSteps"):
                if (r := rows.get(record_date(rec))) is not None:
                    r.update({k: v for k, v in daily_summary_fields(rec).items() if v is not None})

            hrv = self._try(f"hrv {label}", self.client.get_daily_hrv_summaries, lo, hi)
            if hrv is FAILED:
                failed.update(chunk)
            for rec in find_records(hrv, "lastNightAvg", "hrvSummary"):
                if (r := rows.get(record_date(rec))) is not None:
                    r["hrv"] = hrv_value(rec)

            sleep = self._try(f"sleep {label}", self.client.get_daily_sleep_summaries, lo, hi)
            found = False
            for rec in find_records(sleep, "sleepTimeSeconds", "dailySleepDTO"):
                if (r := rows.get(record_date(rec))) is not None:
                    r.update(sleep_fields(rec))
                    found = True
            if not found:  # range endpoint failed or has an unknown format: one call per day instead
                for ds in chunk:
                    if ds in failed or (r := rows.get(ds)) is None:
                        continue
                    rec = self._try(f"sleep {ds}", self.client.get_daily_sleep, ds)
                    if rec is FAILED:
                        failed.add(ds)
                    elif isinstance(rec, dict):
                        r.update(sleep_fields(rec))
        if failed:
            log.warning("%d dagar kunde inte hämtas helt och försöks igen nästa gång", len(failed))
        return [r for ds, r in rows.items() if ds not in failed]

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


def _retry_after(e: Exception) -> float:
    """Seconds to wait after HTTP 429; Garmin sends {"retryInSeconds": n} in the body."""
    try:
        return float(json.loads(getattr(e, "response_text", "") or "{}").get("retryInSeconds", 60)) + 1
    except (ValueError, AttributeError):
        return 61.0


def _chunks(days: list[date]) -> list[tuple[date, date]]:
    """Split sorted days into contiguous ranges of at most CHUNK_DAYS days."""
    out: list[tuple[date, date]] = []
    for d in days:
        if out and (d - out[-1][1]).days == 1 and (d - out[-1][0]).days < CHUNK_DAYS:
            out[-1] = (out[-1][0], d)
        else:
            out.append((d, d))
    return out
