import { addDays, range, weekday } from "./dates";
import { weekType } from "./plan";
import { defaultProfile } from "./profile";
import type { Activity, ActivityStreams, CheckIn, DataBundle, DailyWellness, HrZones, WeightEntry } from "./types";

/** Wall clock for minutes relative to midnight starting `date` (negative = evening before). */
function wallClock(date: string, minutes: number): string {
  const day = minutes < 0 ? addDays(date, -1) : date;
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Deterministic pseudo-random numbers so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const DEMO_ZONES: HrZones[] = [
  { sport: "DEFAULT", method: "HR_MAX", source: "demo", maxHr: 193, restingHr: null, thresholdHr: null, floors: [97, 116, 135, 154, 174] },
];

/**
 * Builds a clearly fictional data set for demo mode. It is generated in the
 * browser, never stored on the server and never mixed with real data.
 */
export function demoBundle(today: string): DataBundle {
  const r = rng(255);
  const profile = defaultProfile();
  const from = addDays(today, -200);
  const activities: Activity[] = [];
  const wellness: DailyWellness[] = [];
  const weights: WeightEntry[] = [];
  const checkins: CheckIn[] = [];
  let fitness = 0;

  for (const d of range(from, today)) {
    const i = activities.length;
    const wd = weekday(d);
    const type = weekType(d, profile);
    const pattern = type === "A" ? ["easy", "strength", "intervals", "strength", "easy"] : ["strength", "easy", "strength", "intervals", "strength"];
    const kind = wd <= 5 ? pattern[wd - 1] : null;
    const progress = Math.min(1, (200 - (Date.parse(today) - Date.parse(d)) / 86_400_000) / 200);
    let dayLoad = 0;
    if (kind && r() > 0.18 && d < today) {
      const sport = kind === "strength" ? "strength" : (["crosstrainer", "cycling", "running", "crosstrainer"] as const)[Math.floor(r() * 4)];
      const minutes = kind === "strength" ? 38 + r() * 8 : kind === "intervals" ? 40 + r() * 5 : 42 + r() * 10;
      const avgHr = kind === "strength" ? 108 + r() * 10 : kind === "intervals" ? 152 + r() * 6 : 134 + r() * 6;
      const speed = sport === "running" ? (2.72 + 0.18 * progress) * (kind === "intervals" ? 1.1 : 1) : sport === "cycling" ? 7.4 + r() : null;
      const dur = Math.round(minutes * 60);
      const zone = kind === "intervals" ? [dur * 0.2, dur * 0.3, dur * 0.12, dur * 0.28, dur * 0.1] : kind === "easy" ? [dur * 0.25, dur * 0.65, dur * 0.1, 0, 0] : null;
      activities.push({
        id: `demo-${i}-${d}`, source: "demo", startLocal: `${d}T${wd % 2 ? "06:10" : "19:40"}:00`, startUtc: null, date: d, sport,
        typeKey: sport === "strength" ? "strength_training" : sport === "crosstrainer" ? "elliptical" : sport === "cycling" ? (r() > 0.5 ? "road_biking" : "indoor_cycling") : "running",
        name: kind === "intervals" ? "Intervaller 4×4" : kind === "strength" ? "Styrka helkropp" : sport === "running" ? "Lugn löpning" : "Lugn kondition",
        durationS: dur, distanceM: speed ? Math.round(speed * dur) : null, avgHr: Math.round(avgHr), maxHr: Math.round(avgHr + 18),
        avgSpeed: speed, avgPower: sport === "cycling" ? Math.round(150 + 25 * progress + r() * 10) : null, normPower: null, avgCadence: null,
        elevationGainM: null, calories: Math.round(minutes * 9), aerobicTe: kind === "intervals" ? 3.6 : 2.6, anaerobicTe: kind === "intervals" ? 2.4 : 0.4,
        zoneSeconds: zone ? zone.map(Math.round) : null, hasStreams: sport !== "strength", rpe: null, note: null,
      });
      dayLoad = minutes * (kind === "intervals" ? 1.8 : 1.1);
    }
    fitness += (dayLoad - fitness) / 7;
    const babyNight = r() < 0.22;
    const sleepH = babyNight ? 4.8 + r() * 1.2 : 6.6 + r() * 1.3;
    const bed = -40 + Math.round(r() * 70);
    const endMin = bed + Math.round(sleepH * 60);
    const hrv = Math.round(44 + 6 * progress - (babyNight ? 6 : 0) - fitness * 0.05 + (r() - 0.5) * 8);
    wellness.push({
      date: d, source: "demo",
      restingHr: Math.round(56 - 3 * progress + (babyNight ? 2 : 0) + (r() - 0.5) * 2),
      hrvLastNight: hrv, hrvWeeklyAvg: null, hrvBaselineLow: 40, hrvBaselineHigh: 54, hrvStatus: "BALANCED",
      sleepS: Math.round(sleepH * 3600), sleepScore: Math.round(Math.min(95, 45 + sleepH * 6 + (r() - 0.5) * 10)),
      sleepStartLocal: wallClock(d, bed), sleepEndLocal: wallClock(d, endMin),
      deepS: Math.round(sleepH * 3600 * 0.18), lightS: Math.round(sleepH * 3600 * 0.55), remS: Math.round(sleepH * 3600 * 0.22), awakeS: Math.round(sleepH * 3600 * 0.05),
      stressAvg: Math.round(30 + (babyNight ? 8 : 0) + (r() - 0.5) * 10), bodyBatteryMin: Math.round(15 + r() * 15), bodyBatteryMax: Math.round(babyNight ? 55 + r() * 15 : 70 + r() * 25),
      steps: Math.round(6000 + r() * 6000),
    });
    if (r() < 0.6) {
      const kg = 91.5 - 3.2 * progress + (r() - 0.5) * 1.4;
      weights.push({ id: `demo-w-${d}`, source: "demo", measuredAt: `${d}T06:30`, date: d, weightKg: Math.round(kg * 10) / 10,
        bodyFatPct: Math.round((23 - 2 * progress + (r() - 0.5) * 2) * 10) / 10, muscleMassKg: Math.round((39 + (r() - 0.5)) * 10) / 10, bodyWaterPct: null, boneMassKg: null, bmi: Math.round((kg / 1.87 ** 2) * 10) / 10 });
    }
    if (r() < 0.55 && d >= addDays(today, -60)) {
      checkins.push({ date: d, energy: babyNight ? 2 + Math.round(r()) : 3 + Math.round(r() * 2), soreness: 1 + Math.round(r() * 2), stress: 2 + Math.round(r() * 2),
        pain: 0, painAreas: [], minutesAvailable: null, note: null, updatedAt: `${d}T07:00:00Z` });
    }
  }
  return {
    mode: "demo", generatedAt: new Date().toISOString(), today, profile: { ...profile, goals: { ...profile.goals, weightTargetKg: 85, weightTargetDate: addDays(today, 150) } },
    activities, wellness, weights, measurements: [{ id: "demo-m1", date: addDays(today, -40), kind: "waist", valueCm: 99, source: "demo" }, { id: "demo-m2", date: addDays(today, -5), kind: "waist", valueCm: 96.5, source: "demo" }],
    checkins, plan: [], strength: [], zones: DEMO_ZONES,
    sync: { lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null, datasets: {} },
  };
}

export function demoStreams(a: Activity): ActivityStreams {
  const r = rng(a.id.length * 97 + (a.durationS ?? 0));
  const n = Math.floor((a.durationS ?? 1800) / 10);
  const t: number[] = [], hr: number[] = [], speed: (number | null)[] = [], power: (number | null)[] = [];
  const intervals = /Intervall/.test(a.name ?? "");
  for (let i = 0; i < n; i++) {
    const s = i * 10;
    const phase = intervals && s > 600 && (s - 600) % 420 < 240 && s < 600 + 4 * 420;
    t.push(s);
    hr.push(Math.round(Math.min(186, (a.avgHr ?? 130) - 12 + Math.min(12, s / 60) + (phase ? 22 : 0) + (r() - 0.5) * 4)));
    speed.push(a.avgSpeed ? Math.round((a.avgSpeed * (phase ? 1.18 : 0.96) + (r() - 0.5) * 0.2) * 100) / 100 : null);
    power.push(a.avgPower ? Math.round(a.avgPower * (phase ? 1.3 : 0.92) + (r() - 0.5) * 20) : null);
  }
  return { activityId: a.id, t, hr, speed: a.avgSpeed ? speed : undefined, power: a.avgPower ? power : undefined, laps: [] };
}
