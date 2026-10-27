"""Training analytics: load, fitness/fatigue/form, readiness and insights.

Terminology (Swedish UI labels in parentheses):
- Load / TRIMP (belastning): Banister training impulse from duration and HR reserve.
- CTL (fitness): 42-day exponentially weighted average of daily load.
- ATL (trötthet): 7-day exponentially weighted average of daily load.
- TSB (form): yesterday's CTL - ATL. Positive = rested, very negative = overreached.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

CTL_DAYS, ATL_DAYS = 42, 7
SPORT_LABELS = {
    "running": "Löpning", "cycling": "Cykling", "swimming": "Simning", "strength": "Styrka",
    "walking": "Promenad", "skiing": "Skidor", "other": "Övrigt",
}
SPORT_ORDER = list(SPORT_LABELS)


# --- load ----------------------------------------------------------------
def trimp(act: dict[str, Any], max_hr: float, rest_hr: float, sex: str = "male") -> float:
    """Banister TRIMP. Falls back to a duration estimate when HR is missing."""
    minutes = (act.get("duration_s") or 0) / 60
    hr = act.get("avg_hr")
    if not hr or max_hr <= rest_hr:
        return minutes * (0.5 if act.get("sport") in ("strength", "walking") else 1.0)
    hrr = min(max((hr - rest_hr) / (max_hr - rest_hr), 0.0), 1.0)
    a, b = (0.86, 1.67) if sex == "female" else (0.64, 1.92)
    return minutes * hrr * a * math.exp(b * hrr)


def daily_loads(activities: list[dict[str, Any]], settings: dict[str, Any]) -> dict[date, float]:
    out: dict[date, float] = defaultdict(float)
    for a in activities:
        d = datetime.fromisoformat(a["start_time"]).date()
        out[d] += trimp(a, settings["max_hr"], settings["resting_hr"], settings.get("sex", "male"))
    return out


def fitness_series(loads: dict[date, float], start: date, end: date) -> list[dict[str, Any]]:
    """CTL/ATL/TSB per day. Computed from the first load so the warm-up is included."""
    if not loads:
        return []
    first = min(min(loads), start)
    ctl = atl = 0.0
    out = []
    d = first
    while d <= end:
        tsb = ctl - atl  # form = state going into the day
        load = loads.get(d, 0.0)
        ctl += (load - ctl) / CTL_DAYS
        atl += (load - atl) / ATL_DAYS
        if d >= start:
            out.append({"date": d.isoformat(), "load": round(load, 1), "ctl": round(ctl, 1),
                        "atl": round(atl, 1), "tsb": round(tsb, 1)})
        d += timedelta(days=1)
    return out


# --- zones ---------------------------------------------------------------
def zone_seconds(act: dict[str, Any], max_hr: float) -> list[float]:
    """Seconds per HR zone (1-5). Uses Garmin's zone times, else estimates from avg HR."""
    z = [act.get(f"hr_z{i}") for i in range(1, 6)]
    if any(z):
        return [float(v or 0) for v in z]
    dur, hr = act.get("duration_s") or 0, act.get("avg_hr")
    out = [0.0] * 5
    if hr and max_hr:
        pct = hr / max_hr
        idx = 0 if pct < 0.6 else 1 if pct < 0.7 else 2 if pct < 0.8 else 3 if pct < 0.9 else 4
        out[idx] = dur
    return out


def intensity_distribution(activities: list[dict[str, Any]], max_hr: float) -> dict[str, Any]:
    zones = [0.0] * 5
    for a in activities:
        for i, s in enumerate(zone_seconds(a, max_hr)):
            zones[i] += s
    total = sum(zones) or 1
    low, mid, high = zones[0] + zones[1], zones[2], zones[3] + zones[4]
    return {
        "zones_min": [round(z / 60) for z in zones],
        "low": round(low / total * 100), "mid": round(mid / total * 100), "high": round(high / total * 100),
        "has_data": sum(zones) > 0,
    }


# --- summaries -----------------------------------------------------------
def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def weekly_summary(activities: list[dict[str, Any]], loads: dict[date, float], today: date,
                   weeks: int = 12) -> list[dict[str, Any]]:
    first = week_start(today) - timedelta(weeks=weeks - 1)
    buckets = {first + timedelta(weeks=i): {"hours": defaultdict(float), "km": 0.0, "load": 0.0, "count": 0}
               for i in range(weeks)}
    for a in activities:
        d = datetime.fromisoformat(a["start_time"]).date()
        b = buckets.get(week_start(d))
        if b is None:
            continue
        b["hours"][a["sport"]] += (a.get("duration_s") or 0) / 3600
        b["km"] += (a.get("distance_m") or 0) / 1000
        b["count"] += 1
    for d, load in loads.items():
        b = buckets.get(week_start(d))
        if b is not None:
            b["load"] += load
    return [
        {"week": wk.isoformat(), "label": f"v{wk.isocalendar()[1]}",
         "hours": {s: round(h, 2) for s, h in b["hours"].items()},
         "total_hours": round(sum(b["hours"].values()), 2), "km": round(b["km"], 1),
         "load": round(b["load"]), "count": b["count"]}
        for wk, b in sorted(buckets.items())
    ]


def aerobic_efficiency(activities: list[dict[str, Any]], max_hr: float) -> list[dict[str, Any]]:
    """Speed per heartbeat on easy runs (higher = fitter). Meters per beat."""
    out = []
    for a in activities:
        if a["sport"] != "running" or not a.get("avg_speed") or not a.get("avg_hr"):
            continue
        if a["avg_hr"] > 0.82 * max_hr or (a.get("duration_s") or 0) < 20 * 60:
            continue  # only steady aerobic runs are comparable
        out.append({"date": a["start_time"][:10], "value": round(a["avg_speed"] * 60 / a["avg_hr"], 3),
                    "pace": pace_str(a["avg_speed"]), "hr": round(a["avg_hr"])})
    return out


def pace_str(speed: float | None) -> str | None:
    if not speed:
        return None
    sec = 1000 / speed
    return f"{int(sec // 60)}:{int(round(sec % 60)):02d}"


def records(activities: list[dict[str, Any]], weekly: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    runs = [a for a in activities if a["sport"] == "running" and a.get("distance_m")]
    rides = [a for a in activities if a["sport"] == "cycling" and a.get("distance_m")]
    if runs:
        r = max(runs, key=lambda a: a["distance_m"])
        out.append({"label": "Längsta löprunda", "value": f"{r['distance_m'] / 1000:.1f} km",
                    "date": r["start_time"][:10]})
        for km in (5, 10, 21.1):
            eligible = [a for a in runs if a["distance_m"] >= km * 1000 and a.get("avg_speed")]
            if eligible:
                r = max(eligible, key=lambda a: a["avg_speed"])
                out.append({"label": f"Snabbaste snittempo ≥ {km:g} km", "value": f"{pace_str(r['avg_speed'])} /km",
                            "date": r["start_time"][:10]})
    if rides:
        r = max(rides, key=lambda a: a["distance_m"])
        out.append({"label": "Längsta cykeltur", "value": f"{r['distance_m'] / 1000:.0f} km",
                    "date": r["start_time"][:10]})
    if weekly:
        w = max(weekly, key=lambda w: w["total_hours"])
        if w["total_hours"]:
            out.append({"label": "Största veckan (12 v)", "value": f"{w['total_hours']:.1f} h", "date": w["week"]})
    return out


# --- readiness -----------------------------------------------------------
def _baseline(values: list[float]) -> tuple[float, float] | None:
    if len(values) < 10:
        return None
    return statistics.mean(values), statistics.pstdev(values) or 1.0


def readiness(daily: list[dict[str, Any]], fitness: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """Combine form, HRV, resting HR and sleep into a 0-100 score + recommendation."""
    by_date = {d["date"]: d for d in daily}
    last60 = [by_date.get((today - timedelta(days=i)).isoformat()) for i in range(1, 61)]
    last60 = [d for d in last60 if d]
    latest = by_date.get(today.isoformat()) or by_date.get((today - timedelta(days=1)).isoformat()) or {}
    components: list[dict[str, Any]] = []

    def add(key: str, label: str, score: float, detail: str, weight: float) -> None:
        components.append({"key": key, "label": label, "score": round(max(0, min(100, score))),
                           "detail": detail, "weight": weight})

    if fitness:
        tsb = fitness[-1]["tsb"]
        ctl = max(fitness[-1]["ctl"], 1)
        rel = tsb / ctl * 100  # form relative to fitness, in %
        # -30% (deep fatigue) -> 10, 0% -> 70, +15% -> 95
        score = 70 + rel * 2 if rel < 0 else 70 + rel * 1.7
        add("form", "Form (TSB)", score, f"{tsb:+.0f} ({rel:+.0f} % av fitness)", 0.35)

    hrv_base = _baseline([d["hrv"] for d in last60 if d.get("hrv")])
    hrv_week = [by_date[k]["hrv"] for k in ((today - timedelta(days=i)).isoformat() for i in range(7))
                if k in by_date and by_date[k].get("hrv")]
    if hrv_base and hrv_week:
        mean, sd = hrv_base
        z = (statistics.mean(hrv_week) - mean) / sd
        add("hrv", "HRV (7 d snitt)", 70 + z * 20,
            f"{statistics.mean(hrv_week):.0f} ms mot normalt {mean:.0f} ± {sd:.0f}", 0.25)

    rhr_base = _baseline([d["resting_hr"] for d in last60 if d.get("resting_hr")])
    if rhr_base and latest.get("resting_hr"):
        mean, _ = rhr_base
        diff = latest["resting_hr"] - mean
        add("rhr", "Vilopuls", 75 - diff * 8, f"{latest['resting_hr']:.0f} slag/min ({diff:+.1f} mot snitt)", 0.2)

    if latest.get("sleep_s"):
        hours = latest["sleep_s"] / 3600
        score = latest.get("sleep_score") or (100 - abs(8 - hours) * 18 if hours < 8 else 95)
        detail = f"{int(hours)} h {int(round(hours % 1 * 60)):02d} min"
        if latest.get("sleep_score"):
            detail += f", sömnpoäng {latest['sleep_score']:.0f}"
        add("sleep", "Sömn i natt", score, detail, 0.2)

    if not components:
        return {"score": None, "level": "unknown", "title": "För lite data",
                "advice": "Synka minst ett par veckor med data för att få en rekommendation.", "components": []}

    total_w = sum(c["weight"] for c in components)
    score = round(sum(c["score"] * c["weight"] for c in components) / total_w)
    # A single red flag caps the score: one very bad night or crashed HRV matters.
    worst = min(c["score"] for c in components)
    if worst < 25:
        score = min(score, 45)

    if score >= 75:
        level, title = "high", "Redo för ett kvalitetspass"
        advice = "Kroppen är återhämtad. Bra dag för intervaller, tempo eller ett långt pass."
    elif score >= 55:
        level, title = "moderate", "Normal träning"
        advice = "Kör enligt plan, men håll de hårda delarna kontrollerade."
    elif score >= 35:
        level, title = "low", "Lugnt pass"
        advice = "Välj lätt distans i zon 1–2 eller rörlighet. Spara intensiteten till en annan dag."
    else:
        level, title = "rest", "Vila eller återhämtning"
        advice = "Flera signaler pekar på trötthet. Vila, promenad eller mycket lätt rörelse idag."
    return {"score": score, "level": level, "title": title, "advice": advice, "components": components}


# --- insights ------------------------------------------------------------
def insights(fitness: list[dict[str, Any]], weekly: list[dict[str, Any]], intensity: dict[str, Any],
             daily: list[dict[str, Any]], activities: list[dict[str, Any]], settings: dict[str, Any],
             today: date) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []

    def add(level: str, title: str, text: str) -> None:
        out.append({"level": level, "title": title, "text": text})

    if len(fitness) >= 8:
        now, week_ago = fitness[-1], fitness[-8]
        ramp = now["ctl"] - week_ago["ctl"]
        acwr = now["atl"] / now["ctl"] if now["ctl"] > 5 else None
        if ramp > 7:
            add("warning", "Snabb ökning", f"Fitness har ökat {ramp:.1f} på en vecka. Över ~7/vecka ökar "
                "skaderisken – planera in en lättare vecka snart.")
        elif ramp < -5:
            add("info", "Minskande fitness", f"Fitness har sjunkit {abs(ramp):.1f} senaste veckan. "
                "Helt rätt om du nedtrappar inför tävling, annars dags att öka igen.")
        if acwr and acwr > 1.5:
            add("critical", "Hög akut belastning", f"Trötthet/fitness-kvoten är {acwr:.2f} (över 1,5). "
                "Belastningen senaste veckan är mycket högre än du är van vid.")
        elif acwr and acwr < 0.8 and now["ctl"] > 20:
            add("info", "Utrymme att öka", f"Kvoten trötthet/fitness är {acwr:.2f} – du tränar mindre "
                "än din vana just nu och kan öka försiktigt.")
        if now["tsb"] > 15:
            add("good", "Utvilad", "Formen är hög – perfekt läge för tävling eller ett test.")

    if intensity["has_data"]:
        if intensity["mid"] > 25:
            add("warning", "Mycket tid i grå zon", f"{intensity['mid']} % av tiden i zon 3 senaste 4 veckorna. "
                "De flesta utvecklas bäst med ~80 % lätt och ~20 % hårt – gör de lätta passen lättare.")
        elif intensity["low"] >= 75 and intensity["high"] >= 8:
            add("good", "Bra intensitetsfördelning", f"{intensity['low']} % lätt / {intensity['high']} % hårt "
                "– nära den polariserade 80/20-modellen.")
        elif intensity["high"] < 5:
            add("info", "Lite intensitet", "Under 5 % av tiden i zon 4–5. Ett intervallpass i veckan "
                "kan ge mycket om grundformen är på plats.")

    if weekly:
        goal = float(settings.get("weekly_goal_hours") or 0)
        cur = weekly[-1]["total_hours"]
        if goal:
            left = goal - cur
            days_left = 6 - today.weekday()
            if left <= 0:
                add("good", "Veckomålet nått", f"{cur:.1f} av {goal:g} h denna vecka. Snyggt!")
            elif days_left >= 0:
                add("info", "Veckomål", f"{cur:.1f} av {goal:g} h – {left:.1f} h kvar på {days_left + 1} dagar.")

    hrvs = [d["hrv"] for d in daily[-4:] if d.get("hrv")]
    if len(hrvs) == 4 and hrvs[0] > hrvs[1] > hrvs[2] > hrvs[3]:
        add("warning", "HRV sjunker", "HRV har sjunkit tre nätter i rad – ett tidigt tecken på trötthet, "
            "stress eller sjukdom.")
    sleeps = [d["sleep_s"] / 3600 for d in daily[-7:] if d.get("sleep_s")]
    if len(sleeps) >= 5 and statistics.mean(sleeps) < 6.5:
        add("warning", "Sömnbrist", f"Snitt {statistics.mean(sleeps):.1f} h sömn senaste veckan. "
            "Sömn är den viktigaste återhämtningen.")

    if activities:
        last = datetime.fromisoformat(activities[-1]["start_time"]).date()
        gap = (today - last).days
        if gap >= 5:
            add("info", "Uppehåll", f"{gap} dagar sedan senaste passet. Börja om lugnt.")
    return out


# --- main entry ----------------------------------------------------------
def build_dashboard(activities: list[dict[str, Any]], daily: list[dict[str, Any]], settings: dict[str, Any],
                    days: int = 90, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    loads = daily_loads(activities, settings)
    fitness = fitness_series(loads, start, today)
    weekly = weekly_summary(activities, loads, today)
    recent28 = [a for a in activities if a["start_time"][:10] >= (today - timedelta(days=27)).isoformat()]
    intensity = intensity_distribution(recent28, settings["max_hr"])
    daily_window = [d for d in daily if d["date"] >= start.isoformat()]
    in_window = [a for a in activities if a["start_time"][:10] >= start.isoformat()]

    recent = []
    for a in reversed(activities[-15:]):
        recent.append({
            "id": a["id"], "date": a["start_time"][:16].replace("T", " "), "name": a.get("name"),
            "sport": a["sport"], "sport_label": SPORT_LABELS.get(a["sport"], a["sport"]),
            "duration_min": round((a.get("duration_s") or 0) / 60),
            "km": round(a["distance_m"] / 1000, 2) if a.get("distance_m") else None,
            "pace": pace_str(a.get("avg_speed")) if a["sport"] == "running" else None,
            "speed_kmh": round(a["avg_speed"] * 3.6, 1) if a.get("avg_speed") and a["sport"] != "running" else None,
            "avg_hr": round(a["avg_hr"]) if a.get("avg_hr") else None,
            "load": round(trimp(a, settings["max_hr"], settings["resting_hr"], settings.get("sex", "male"))),
            "aerobic_te": a.get("aerobic_te"),
        })

    sports_present = [s for s in SPORT_ORDER if any(s in w["hours"] for w in weekly)]
    latest_daily = next((d for d in reversed(daily) if d.get("resting_hr") or d.get("hrv")), {})
    vo2 = next((d["vo2max"] for d in reversed(daily) if d.get("vo2max")), None)

    return {
        "today": today.isoformat(),
        "settings": settings,
        "readiness": readiness(daily, fitness, today),
        "current": {
            **(fitness[-1] if fitness else {"ctl": 0, "atl": 0, "tsb": 0}),
            "ctl_week_ago": fitness[-8]["ctl"] if len(fitness) >= 8 else None,
            "resting_hr": latest_daily.get("resting_hr"), "hrv": latest_daily.get("hrv"), "vo2max": vo2,
            "week_hours": weekly[-1]["total_hours"] if weekly else 0,
            "week_km": weekly[-1]["km"] if weekly else 0,
        },
        "fitness": fitness,
        "weekly": weekly,
        "sports": [{"key": s, "label": SPORT_LABELS[s]} for s in sports_present],
        "intensity": intensity,
        "daily": daily_window,
        "efficiency": aerobic_efficiency(in_window, settings["max_hr"]),
        "records": records(activities, weekly),
        "insights": insights(fitness, weekly, intensity, daily, activities, settings, today),
        "recent": recent,
        "counts": {"activities": len(activities), "days": len(daily)},
    }
