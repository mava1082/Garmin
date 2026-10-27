from datetime import date, timedelta

import pytest

from garmin_dashboard import analytics as an
from garmin_dashboard.db import Database
from garmin_dashboard.sources import normalize_sport

SETTINGS = {"max_hr": 190, "resting_hr": 50, "sex": "male", "weekly_goal_hours": 5}
TODAY = date(2026, 3, 18)  # a Wednesday


def act(day: date, minutes=60, hr=140, sport="running", **kw):
    return {"id": f"{day}-{sport}", "start_time": f"{day.isoformat()}T07:00:00", "sport": sport,
            "duration_s": minutes * 60, "avg_hr": hr, **kw}


def test_trimp_increases_with_intensity_and_has_fallback():
    easy = an.trimp(act(TODAY, hr=130), 190, 50)
    hard = an.trimp(act(TODAY, hr=170), 190, 50)
    assert 0 < easy < hard
    assert an.trimp(act(TODAY, minutes=30, hr=None), 190, 50) == 30
    assert an.trimp(act(TODAY, minutes=30, hr=None, sport="strength"), 190, 50) == 15


def test_fitness_series_converges_to_constant_load():
    loads = {TODAY - timedelta(days=i): 100.0 for i in range(400)}
    series = an.fitness_series(loads, TODAY - timedelta(days=10), TODAY)
    assert len(series) == 11
    assert series[-1]["ctl"] == pytest.approx(100, abs=1)
    assert series[-1]["atl"] == pytest.approx(100, abs=1)
    assert abs(series[-1]["tsb"]) < 1


def test_rest_raises_form():
    loads = {TODAY - timedelta(days=i): 100.0 for i in range(10, 200)}
    series = an.fitness_series(loads, TODAY - timedelta(days=12), TODAY)
    assert series[-1]["tsb"] > 20  # ten rest days -> fatigue drops faster than fitness


def test_intensity_uses_zone_times_or_estimates():
    with_zones = act(TODAY, hr_z1=600, hr_z2=1800, hr_z3=600, hr_z4=600, hr_z5=0)
    d = an.intensity_distribution([with_zones], 190)
    assert (d["low"], d["mid"], d["high"]) == (67, 17, 17)
    est = an.intensity_distribution([act(TODAY, hr=175)], 190)  # 92 % of max -> Z5
    assert est["high"] == 100


def test_weekly_summary_buckets_by_iso_week():
    acts = [act(TODAY, minutes=60), act(TODAY - timedelta(days=7), minutes=90, sport="cycling", distance_m=30000)]
    loads = an.daily_loads(acts, SETTINGS)
    weeks = an.weekly_summary(acts, loads, TODAY, weeks=2)
    assert [w["total_hours"] for w in weeks] == [1.5, 1.0]
    assert weeks[0]["hours"] == {"cycling": 1.5}
    assert weeks[0]["km"] == 30


def test_readiness_flags_bad_recovery():
    good_days = [{"date": (TODAY - timedelta(days=i)).isoformat(), "hrv": 60 + (i % 3), "resting_hr": 48,
                  "sleep_s": 8 * 3600, "sleep_score": 85} for i in range(60)]
    fitness = [{"ctl": 60, "atl": 55, "tsb": 5}]
    assert an.readiness(good_days, fitness, TODAY)["level"] == "high"

    bad = [dict(d) for d in good_days]
    for d in bad[:7]:
        d.update(hrv=45, resting_hr=56, sleep_s=5 * 3600, sleep_score=35)
    r = an.readiness(bad, [{"ctl": 60, "atl": 85, "tsb": -25}], TODAY)
    assert r["level"] == "rest"


def test_readiness_without_data():
    assert an.readiness([], [], TODAY)["score"] is None


def test_normalize_sport():
    assert normalize_sport("trail_running") == "running"
    assert normalize_sport("virtual_ride") == "cycling"
    assert normalize_sport("LAP_SWIMMING") == "swimming"
    assert normalize_sport("strength_training") == "strength"
    assert normalize_sport("yoga") == "other"


def test_demo_end_to_end():
    from garmin_dashboard.sources.demo import DemoSource

    src = DemoSource(today=TODAY)
    db = Database(":memory:")
    db.upsert_activities(src.fetch_activities(TODAY - timedelta(days=200), TODAY))
    db.upsert_daily(src.fetch_daily([TODAY - timedelta(days=i) for i in range(200)]))
    data = an.build_dashboard(db.activities(), db.daily(), db.settings(), days=90, today=TODAY)
    assert len(data["fitness"]) == 90
    assert len(data["weekly"]) == 12
    assert data["readiness"]["score"] is not None
    assert data["records"] and data["recent"] and data["efficiency"]
