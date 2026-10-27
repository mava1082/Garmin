from datetime import date, timedelta
from types import SimpleNamespace

from garmin_dashboard.sources.personal_api import PersonalApiSource, _chunks


class FakeClient:
    """Mimics garmin_personal_api.GarminPersonalApiClient with Garmin Connect-shaped JSON."""

    def __init__(self, n_activities=130):
        self.n_activities = n_activities
        self.calls = []

    def search_activities(self, *, start, limit, start_date, end_date):
        self.calls.append(("search", start, limit))
        items = [{"activityId": 1000 + i, "activityName": "Löpning", "startTimeLocal": "2026-10-20 07:00:00",
                  "activityType": {"typeKey": "trail_running"}, "duration": 3600.0, "distance": 10000.0,
                  "averageHR": 150.0, "averageSpeed": 2.78, "hrTimeInZone_2": 3000.0}
                 for i in range(self.n_activities)]
        return items[start:start + limit]

    def get_daily_summaries(self, lo, hi):
        days = [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]
        # Shape of /usersummary-service/v2/dailysummaries as returned by the real API
        return {"data": [{"uuid": "x", "calendarDate": d.isoformat(), "heartRate": {"restingValue": 48},
                          "movement": {"steps": {"value": 9000, "goal": 8000}},
                          "stress": {"avgLevel": 25}, "bodyBattery": {"minValue": 20, "maxValue": 80}}
                         for d in days]}

    def get_daily_hrv_summaries(self, lo, hi):
        return {"hrvSummaries": [{"calendarDate": lo.isoformat(), "lastNightAvg": 62, "weeklyAvg": 60}]}

    def get_daily_sleep_summaries(self, lo, hi):
        raise RuntimeError("HTTP 404")  # force the per-day fallback

    def get_daily_sleep(self, d):
        return {"dailySleepDTO": {"calendarDate": str(d), "sleepTimeSeconds": 27000,
                                  "sleepScores": {"overall": {"value": 81}}}}

    def get_heart_rate_zones(self):
        return [{"sport": "RUNNING", "maxHeartRateUsed": 188},
                {"sport": "DEFAULT", "maxHeartRateUsed": 192, "restingHeartRateUsed": 46}]


def source(client=None, sleeps=None):
    record = sleeps.append if sleeps is not None else (lambda s: None)
    return PersonalApiSource(SimpleNamespace(personal_api_key="x"), client=client or FakeClient(), sleep=record)


def test_activities_are_paged_and_mapped():
    client = FakeClient(n_activities=130)
    acts = source(client).fetch_activities(date(2026, 10, 1), date(2026, 10, 27))
    assert len(acts) == 130
    assert [c[1] for c in client.calls] == [0, 100]
    a = acts[0]
    assert a["sport"] == "running" and a["start_time"] == "2026-10-20T07:00:00" and a["hr_z2"] == 3000.0


class RateLimited(Exception):
    status_code = 429
    response_text = '{"count":101,"limit":100,"retryInSeconds":12}'


def test_rate_limit_waits_and_retries():
    calls = {"n": 0}

    def limited():
        calls["n"] += 1
        if calls["n"] <= 2:
            raise RateLimited()
        return "ok"

    sleeps = []
    assert source(sleeps=sleeps)._call(limited) == "ok"
    assert 13.0 in sleeps and sleeps.count(13.0) == 2


def test_requests_are_spaced_out():
    sleeps = []
    src = source(sleeps=sleeps)
    src._clock = lambda: 100.0  # no time passes between calls
    src._call(lambda: 1)
    src._call(lambda: 2)
    assert sleeps == [0.7]


def test_failed_days_are_left_out_for_retry():
    class Flaky(FakeClient):
        def get_daily_hrv_summaries(self, lo, hi):
            raise RuntimeError("HTTP 500")

    days = [date(2026, 10, 1) + timedelta(days=i) for i in range(3)]
    assert source(Flaky()).fetch_daily(days) == []


def test_daily_merges_endpoints_and_falls_back_for_sleep():
    days = [date(2026, 10, 1) + timedelta(days=i) for i in range(3)]
    rows = {r["date"]: r for r in source().fetch_daily(days)}
    first = rows["2026-10-01"]
    assert first["resting_hr"] == 48 and first["steps"] == 9000 and first["body_battery_high"] == 80
    assert first["body_battery_low"] == 20 and first["stress_avg"] == 25
    assert first["hrv"] == 62
    assert first["sleep_s"] == 27000 and first["sleep_score"] == 81
    assert rows["2026-10-03"].get("hrv") is None


def test_profile_prefers_default_zones():
    assert source().profile() == {"max_hr": 192, "resting_hr": 46}


def test_chunks_split_on_gaps_and_length():
    d0 = date(2026, 1, 1)
    days = [d0 + timedelta(days=i) for i in range(30)] + [d0 + timedelta(days=40)]
    assert _chunks(days) == [(d0, d0 + timedelta(days=27)), (d0 + timedelta(days=28), d0 + timedelta(days=29)),
                             (d0 + timedelta(days=40), d0 + timedelta(days=40))]


def test_token_is_refreshed_once_on_401():
    class Err(Exception):
        status_code = 401

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise Err()
        return "ok"

    src = source()
    tokens = []
    src._auth = SimpleNamespace(obtain_token=lambda key, force_refresh=False: tokens.append(force_refresh)
                                or SimpleNamespace(access_token="new"))
    src.client.update_bearer_token = lambda t: tokens.append(t)
    assert src._call(flaky) == "ok"
    assert tokens == [True, "new"]


def test_setup_endpoint_saves_key(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import garmin_dashboard.config as cfg_mod
    import garmin_dashboard.server as server
    import garmin_dashboard.sources.personal_api as pa

    env = tmp_path / ".env"
    env.write_text("# GARMIN_SOURCE=demo\nPORT=8000\n")
    monkeypatch.setattr(server, "save_env", lambda values: cfg_mod.save_env(values, env))
    monkeypatch.setattr(pa.PersonalApiSource, "__init__", lambda self, cfg: None)
    monkeypatch.setattr(server.config, "source", "demo")
    monkeypatch.setattr(server.config, "personal_api_key", None)

    r = TestClient(server.app).post("/api/setup", json={"api_key": "  my-secret-key  "})
    assert r.status_code == 200
    text = env.read_text()
    assert "GARMIN_SOURCE=personal_api" in text and "GARMIN_PERSONAL_API_KEY=my-secret-key" in text
    assert "PORT=8000" in text
    assert server.config.source == "personal_api" and server.config.personal_api_key == "my-secret-key"


def test_invalid_key_gives_friendly_error():
    import pytest

    class Err(Exception):
        status_code = 401

    class Auth:
        def obtain_token(self, key):
            raise Err("HTTP 401")

    with pytest.raises(RuntimeError, match="godkände inte nyckeln"):
        PersonalApiSource(SimpleNamespace(personal_api_key="bad-key"), authenticator=Auth())
