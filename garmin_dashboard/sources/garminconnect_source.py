"""Garmin Connect via the community `garminconnect` library (email + password).

Unofficial alternative to the Personal API: it logs in like the Garmin Connect
app and stores tokens in GARMIN_TOKENSTORE, so the password is only needed the
first time (and when tokens expire).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from .connect_format import connect_activity, daily_summary_fields, dig, hrv_value, sleep_fields

log = logging.getLogger(__name__)


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
        return [connect_activity(a) for a in raw]

    def fetch_daily(self, days: list[date]) -> list[dict[str, Any]]:
        rows = []
        for d in days:
            ds = d.isoformat()
            row: dict[str, Any] = {"date": ds}
            try:
                row.update(daily_summary_fields(self.api.get_stats(ds) or {}))
            except Exception as e:  # one bad endpoint shouldn't stop the sync
                log.warning("stats %s: %s", ds, e)
            try:
                row.update(sleep_fields(self.api.get_sleep_data(ds) or {}))
            except Exception as e:
                log.warning("sleep %s: %s", ds, e)
            try:
                row["hrv"] = hrv_value(self.api.get_hrv_data(ds) or {})
            except Exception as e:
                log.warning("hrv %s: %s", ds, e)
            try:
                row["vo2max"] = dig(self.api.get_max_metrics(ds), 0, "generic", "vo2MaxPreciseValue")
            except Exception as e:
                log.warning("vo2max %s: %s", ds, e)
            rows.append(row)
        return rows
