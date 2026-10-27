/**
 * Maps Garmin Personal API JSON to the FORM domain model.
 * Shapes marked "verified" were observed in live responses; the rest follow
 * Garmin Connect's formats and are parsed defensively.
 */
import { sportFromType } from "../core/activities";
import { localEpochToWallClock } from "../core/dates";
import type { Activity, DailyWellness, HrZones, WeightEntry } from "../core/types";

type J = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dig = (o: any, ...path: string[]): any => path.reduce((x, k) => (x == null ? undefined : x[k]), o);

/** activitylist-service/activities/search/activities item (verified). */
export function mapActivity(a: J): Activity {
  const typeKey: string | null = dig(a, "activityType", "typeKey") ?? null;
  const startLocal = String(a.startTimeLocal ?? "").replace(" ", "T").slice(0, 19);
  const gmt = a.startTimeGMT ? `${String(a.startTimeGMT).replace(" ", "T").slice(0, 19)}Z` : null;
  return {
    id: String(a.activityId),
    source: "garmin",
    startLocal,
    startUtc: gmt,
    date: startLocal.slice(0, 10),
    sport: sportFromType(typeKey),
    typeKey,
    name: a.activityName ?? null,
    durationS: num(a.duration),
    distanceM: num(a.distance) || null,
    avgHr: num(a.averageHR),
    maxHr: num(a.maxHR),
    avgSpeed: num(a.averageSpeed) || null,
    avgPower: num(a.avgPower) ?? num(a.averagePower),
    normPower: num(a.normPower) ?? num(a.normalizedPower),
    avgCadence: num(a.averageBikingCadenceInRevPerMinute) ?? num(a.averageRunningCadenceInStepsPerMinute),
    elevationGainM: num(a.elevationGain),
    calories: num(a.calories),
    aerobicTe: num(a.aerobicTrainingEffect),
    anaerobicTe: num(a.anaerobicTrainingEffect),
    zoneSeconds: [1, 2, 3, 4, 5].every((i) => num(a[`hrTimeInZone_${i}`]) != null) ? [1, 2, 3, 4, 5].map((i) => a[`hrTimeInZone_${i}`]) : null,
    hasStreams: false,
    rpe: null,
    note: null,
  };
}

export function emptyWellness(date: string): DailyWellness {
  return {
    date, source: "garmin", restingHr: null, hrvLastNight: null, hrvWeeklyAvg: null, hrvBaselineLow: null, hrvBaselineHigh: null, hrvStatus: null,
    sleepS: null, sleepScore: null, sleepStartLocal: null, sleepEndLocal: null, deepS: null, lightS: null, remS: null, awakeS: null,
    stressAvg: null, bodyBatteryMin: null, bodyBatteryMax: null, steps: null,
  };
}

/** Finds per-day records in a response regardless of wrapper ({data: []}, {hrvSummaries: []}, []). */
export function records(obj: unknown, ...keys: string[]): J[] {
  const out: J[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    const r = o as J;
    if (typeof (r.calendarDate ?? r.date) === "string" && keys.some((k) => k in r)) { out.push(r); return; }
    Object.values(r).forEach(walk);
  };
  walk(obj);
  return out;
}

const day = (r: J) => String(r.calendarDate ?? r.date).slice(0, 10);

/** usersummary-service/v2/dailysummaries (verified: nested format). */
export function applyDailySummaries(rows: Map<string, DailyWellness>, json: unknown) {
  for (const r of records(json, "heartRate", "movement", "bodyBattery", "stress", "restingHeartRate")) {
    const w = rows.get(day(r));
    if (!w) continue;
    w.restingHr = num(dig(r, "heartRate", "restingValue")) ?? num(r.restingHeartRate) ?? w.restingHr;
    w.steps = num(dig(r, "movement", "steps", "value")) ?? num(r.totalSteps) ?? w.steps;
    w.stressAvg = positive(num(dig(r, "stress", "avgLevel")) ?? num(r.averageStressLevel)) ?? w.stressAvg;
    w.bodyBatteryMin = num(dig(r, "bodyBattery", "minValue")) ?? num(r.bodyBatteryLowestValue) ?? w.bodyBatteryMin;
    w.bodyBatteryMax = num(dig(r, "bodyBattery", "maxValue")) ?? num(r.bodyBatteryHighestValue) ?? w.bodyBatteryMax;
  }
}

// Garmin uses negative stress levels for "not enough data".
const positive = (v: number | null) => (v != null && v >= 0 ? v : null);

/** hrv-service/hrv/daily/{start}/{end} (verified). */
export function applyHrv(rows: Map<string, DailyWellness>, json: unknown) {
  for (const r of records(json, "lastNightAvg", "weeklyAvg")) {
    const w = rows.get(day(r));
    if (!w) continue;
    w.hrvLastNight = num(r.lastNightAvg);
    w.hrvWeeklyAvg = num(r.weeklyAvg);
    w.hrvBaselineLow = num(dig(r, "baseline", "balancedLow"));
    w.hrvBaselineHigh = num(dig(r, "baseline", "balancedUpper"));
    w.hrvStatus = typeof r.status === "string" ? r.status : null;
  }
}

/** sleep-service/sleep/dailySleepSummariesByDate (verified). Stored on the wake-up date. */
export function applySleep(rows: Map<string, DailyWellness>, json: unknown) {
  for (const raw of records(json, "sleepTimeSeconds", "dailySleepDTO")) {
    const r = (raw.dailySleepDTO as J) ?? raw;
    const w = rows.get(day(r));
    if (!w) continue;
    const secs = num(r.sleepTimeSeconds);
    w.sleepS = secs && secs > 0 ? secs : null;
    w.sleepScore = num(dig(r, "sleepScores", "overall", "value"));
    w.sleepStartLocal = localEpochToWallClock(num(r.sleepStartTimestampLocal));
    w.sleepEndLocal = localEpochToWallClock(num(r.sleepEndTimestampLocal));
    w.deepS = num(r.deepSleepSeconds); w.lightS = num(r.lightSleepSeconds); w.remS = num(r.remSleepSeconds); w.awakeS = num(r.awakeSleepSeconds);
  }
}

/** weight-service/weight/range (Index S2). Format not yet verified live, parsed defensively. */
export function mapWeights(json: unknown): WeightEntry[] {
  const out: WeightEntry[] = [];
  const kg = (v: unknown) => { const n = num(v); return n == null ? null : n > 500 ? n / 1000 : n; };
  for (const r of records(json, "weight")) {
    const w = kg(r.weight);
    if (w == null || w < 20 || w > 300) continue;
    const ts = num(r.timestampGMT) ?? num(r.date);
    const local = typeof r.date === "number" ? localEpochToWallClock(r.date) : null;
    const date = day(r);
    out.push({
      id: String(r.samplePk ?? `${date}-${ts ?? w}`), source: "garmin",
      measuredAt: local ?? `${date}T07:00`, date,
      weightKg: Math.round(w * 100) / 100,
      bodyFatPct: num(r.bodyFat), muscleMassKg: kg(r.muscleMass), bodyWaterPct: num(r.bodyWater), boneMassKg: kg(r.boneMass), bmi: num(r.bmi),
    });
  }
  return out;
}

/** biometric-service/heartRateZones/v2 (verified). */
export function mapZones(json: unknown): HrZones[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((z: J) => {
    const floors = [1, 2, 3, 4, 5].map((i) => num(z[`zone${i}Floor`]));
    if (floors.some((f) => f == null)) return [];
    const method = ["HR_MAX", "HR_RESERVE", "LACTATE_THRESHOLD"].includes(z.trainingMethod) ? z.trainingMethod : "HR_MAX";
    return [{ sport: String(z.sport ?? "DEFAULT"), method, source: "garmin" as const, maxHr: num(z.maxHeartRateUsed), restingHr: num(z.restingHeartRateUsed),
      thresholdHr: num(z.lactateThresholdHeartRateUsed), floors: floors as HrZones["floors"] }];
  });
}

/** Describes the structure of a response without any values – safe to print in public CI logs. */
export function shape(o: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1), `(${o.length} st)`] : [];
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).slice(0, 40).map(([k, v]) => [k, shape(v, depth + 1)]));
  return o === null ? "null" : typeof o;
}
