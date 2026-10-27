import { describe, expect, it } from "vitest";
import { addDays, clockMinutesAroundMidnight, isoWeek, localEpochToWallClock, range, todayStockholm, weekStart } from "../src/core/dates";
import { sleepWindow } from "../src/core/sleep";
import { assessRecovery } from "../src/core/recovery";
import { minimalSession, suggestToday, type CoachInput } from "../src/core/coach";
import { proposePlan, templateWeek, viewPlan } from "../src/core/plan";
import { checkGoal, weightChange, weightTrend } from "../src/core/body";
import { patterns } from "../src/core/insights";
import { comparisons } from "../src/core/trends";
import { sportFromType } from "../src/core/activities";
import { defaultProfile } from "../src/core/profile";
import { demoBundle } from "../src/core/demo";
import type { Activity, CheckIn, DailyWellness, PlanItem } from "../src/core/types";

const TODAY = "2026-10-21"; // a Wednesday
const profile = defaultProfile();

function wellnessDay(date: string, over: Partial<DailyWellness> = {}): DailyWellness {
  return {
    date, source: "garmin", restingHr: 55, hrvLastNight: 48, hrvWeeklyAvg: null, hrvBaselineLow: 42, hrvBaselineHigh: 56, hrvStatus: "BALANCED",
    sleepS: 7.2 * 3600, sleepScore: 78, sleepStartLocal: `${addDays(date, -1)}T23:15`, sleepEndLocal: `${date}T06:30`,
    deepS: null, lightS: null, remS: null, awakeS: null, stressAvg: 30, bodyBatteryMin: 20, bodyBatteryMax: 80, steps: 8000, ...over,
  };
}
const normalWeeks = (over: Record<string, Partial<DailyWellness>> = {}) =>
  range(addDays(TODAY, -70), TODAY).map((d) => wellnessDay(d, over[d]));

function act(date: string, over: Partial<Activity> = {}): Activity {
  return {
    id: `a-${date}-${over.sport ?? "x"}-${over.name ?? ""}`, source: "garmin", startLocal: `${date}T07:00:00`, startUtc: null, date, sport: "crosstrainer", typeKey: "elliptical",
    name: "Crosstrainer", durationS: 2700, distanceM: null, avgHr: 136, maxHr: 150, avgSpeed: null, avgPower: null, normPower: null, avgCadence: null,
    elevationGainM: null, calories: null, aerobicTe: 2.5, anaerobicTe: 0.3, zoneSeconds: null, hasStreams: false, rpe: null, note: null, ...over,
  };
}
const checkin = (over: Partial<CheckIn> = {}): CheckIn => ({ date: TODAY, energy: 3, soreness: 2, stress: 2, pain: 0, painAreas: [], minutesAvailable: null, note: null, updatedAt: "", ...over });
const planItem = (date: string, kind: PlanItem["kind"], over: Partial<PlanItem> = {}): PlanItem =>
  ({ id: `p-${date}-${kind}`, date, kind, modality: kind === "strength" ? "gym" : "crosstrainer", templateId: null, minutes: kind === "strength" ? 40 : 45, status: "planned", activityId: null, note: null, ...over });

function input(over: Partial<CoachInput> = {}): CoachInput {
  return { today: TODAY, profile, activities: [], wellness: normalWeeks(), checkins: [], plan: [], zones: [], ...over };
}

describe("dates and time zones", () => {
  it("adds days across the DST changes", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
  it("uses Stockholm local date, not UTC", () => {
    expect(todayStockholm(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01"); // CEST, 00:30 local
    expect(todayStockholm(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31"); // CET, 23:30 local
  });
  it("reads Garmin local-epoch timestamps as wall clock on DST days", () => {
    expect(localEpochToWallClock(Date.UTC(2026, 9, 25, 2, 30))).toBe("2026-10-25T02:30");
  });
  it("computes ISO weeks and Monday starts", () => {
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
  });
});

describe("sleep over midnight", () => {
  it("averages bedtimes around midnight instead of noon", () => {
    expect(clockMinutesAroundMidnight("2026-10-20T23:30")).toBe(-30);
    const w = [wellnessDay("2026-10-20", { sleepStartLocal: "2026-10-19T23:30" }), wellnessDay("2026-10-21", { sleepStartLocal: "2026-10-21T00:30" })];
    expect(sleepWindow(w, "2026-10-21", 7).bedtime).toBe(0);
  });
  it("keeps missing sleep missing", () => {
    const w = [wellnessDay("2026-10-21", { sleepS: null, sleepScore: null })];
    const s = sleepWindow(w, "2026-10-21", 7);
    expect(s.nights).toBe(0);
    expect(s.avgS).toBeNull();
  });
});

describe("recovery assessment", () => {
  it("normal data gives a ready or normal day", () => {
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks(), activities: [], profile });
    expect(["ready", "normal"]).toContain(r.category);
    expect(r.disclaimer).toMatch(/inte Garmins Training Readiness/);
  });
  it("one bad night alone never means 'prioritera återhämtning'", () => {
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks({ [TODAY]: { sleepS: 3.5 * 3600 } }), activities: [], profile });
    expect(r.category).not.toBe("recover");
  });
  it("one low HRV night alone is only a watch signal", () => {
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks({ [TODAY]: { hrvLastNight: 30 } }), activities: [], profile });
    expect(r.signals.find((s) => s.key === "hrv")?.state).toBe("watch");
    expect(r.category).not.toBe("recover");
  });
  it("several bad signals together suggest recovery", () => {
    const bad: Record<string, Partial<DailyWellness>> = {};
    for (let i = 0; i < 7; i++) bad[addDays(TODAY, -i)] = { hrvLastNight: 33, restingHr: 63 };
    bad[TODAY] = { hrvLastNight: 31, restingHr: 63, sleepS: 4.5 * 3600 };
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks(bad), activities: [], profile });
    expect(r.category).toBe("recover");
  });
  it("low subjective energy outweighs good watch data", () => {
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks(), activities: [], profile, checkin: checkin({ energy: 2 }) });
    expect(r.category).toBe("easy");
  });
  it("feeling good can override a single deviating number", () => {
    const r = assessRecovery({ today: TODAY, wellness: normalWeeks({ [TODAY]: { sleepS: 4.6 * 3600 } }), activities: [], profile, checkin: checkin({ energy: 5 }) });
    expect(r.category).toBe("normal");
  });
  it("is uncertain without data", () => {
    const r = assessRecovery({ today: TODAY, wellness: [], activities: [], profile });
    expect(r.confidence).toBe("låg");
    expect(r.signals.filter((s) => s.state === "unknown").length).toBeGreaterThanOrEqual(3);
  });
});

describe("coach rules", () => {
  it("follows the plan on a normal day and explains why", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "intervals")] }));
    expect(s.workout.kind).toBe("intervals");
    expect(s.reasons.some((r) => r.source === "plan")).toBe(true);
    expect(s.workout.warmup.length).toBeGreaterThan(0);
    expect(s.workout.cooldown.length).toBeGreaterThan(0);
  });
  it("never suggests running with knee pain", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "easy", { modality: "running" })], checkins: [checkin({ pain: 1, painAreas: ["knee"] })] }));
    expect(s.workout.modality).not.toBe("running");
  });
  it("never suggests running while knee status is 'current'", () => {
    const p = { ...profile, kneeStatus: "current" as const, enduranceModalities: ["running" as const, "cycling" as const] };
    const s = suggestToday(input({ profile: p, plan: [planItem(TODAY, "easy", { modality: "running" })] }));
    expect(s.workout.modality).toBe("cycling");
    expect(s.alternatives.every((a) => a.modality !== "running")).toBe(true);
  });
  it("severe pain gives rest and points to professional assessment, without diagnosing", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "strength")], checkins: [checkin({ pain: 3, painAreas: ["knee"] })] }));
    expect(["rest", "recovery"]).toContain(s.workout.kind);
    expect(s.notices.join(" ")).toMatch(/1177|fysioterapeut/);
    expect(s.notices.join(" ")).toMatch(/Träna inte igenom smärta/);
  });
  it("low energy turns intervals into easy endurance", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "intervals")], checkins: [checkin({ energy: 2 })] }));
    expect(s.workout.kind).toBe("easy");
  });
  it("keeps 48 hours between hard sessions", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "intervals")], activities: [act(addDays(TODAY, -1), { name: "Intervaller 4x4" })] }));
    expect(s.workout.kind).toBe("easy");
  });
  it("does not add a second interval session in the same week", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "intervals")], activities: [act("2026-10-19", { name: "Intervaller 4x4" })] }));
    expect(s.workout.kind).toBe("easy");
  });
  it("scales to the time you have", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "easy")] }), { minutes: 20 });
    expect(s.workout.minutes).toBe(20);
    const st = suggestToday(input({ plan: [planItem(TODAY, "strength")] }), { minutes: 20 });
    expect(st.workout.minutes).toBe(20);
  });
  it("does not hard-code 135–140 as zone 2", () => {
    const s = suggestToday(input({ plan: [planItem(TODAY, "easy")] }));
    expect(s.workout.intensity.zones).toMatch(/Zon 1–2/);
    expect(s.workout.intensity.zones).not.toMatch(/135–140/);
    expect(s.workout.intensity.personal).toMatch(/135–140/);
  });
  it("minimal session prefers short intervals early in a fresh week", () => {
    const s = minimalSession(input());
    expect(s.workout.minutes).toBeLessThanOrEqual(25);
    expect(s.workout.kind).toBe("intervals");
  });
});

describe("plan", () => {
  it("week A has 3 endurance and 2 strength, week B the reverse", () => {
    const a = templateWeek("2026-10-19", { ...profile, weekAParity: 1 });
    const b = templateWeek("2026-10-19", { ...profile, weekAParity: 0 });
    const count = (w: typeof a, k: string) => w.filter((x) => x.kind === k).length;
    const isA = a.filter((x) => x.kind === "strength").length === 2 ? a : b;
    const isB = isA === a ? b : a;
    expect(count(isA, "strength")).toBe(2);
    expect(count(isB, "strength")).toBe(3);
    expect(count(isA, "intervals") + count(isB, "intervals")).toBe(2);
  });
  it("does not stack a missed hard session", () => {
    const plan = [planItem("2026-10-20", "intervals"), planItem("2026-10-22", "intervals")];
    const changes = proposePlan({ today: TODAY, plan, activities: [act("2026-10-19", { name: "Intervaller 4x4" })], zones: [], profile });
    expect(changes.some((c) => c.type === "change" && c.date === "2026-10-22" && c.after.kind === "easy")).toBe(true);
  });
  it("separates planned from done and missed", () => {
    const plan = [planItem("2026-10-19", "strength"), planItem("2026-10-20", "easy"), planItem(TODAY, "strength")];
    const { views, extras } = viewPlan(plan, [act("2026-10-19", { sport: "strength", typeKey: "strength_training" }), act("2026-10-18")], [], profile, TODAY);
    expect(views.map((v) => v.state)).toEqual(["done", "missed", "today"]);
    expect(extras).toHaveLength(1);
  });
});

describe("body", () => {
  it("smooths daily noise", () => {
    const w = range("2026-09-01", "2026-10-20").map((d, i) => ({ id: d, source: "garmin" as const, measuredAt: `${d}T06:30`, date: d, weightKg: 90 - i * 0.02 + (i % 2 ? 0.8 : -0.8), bodyFatPct: null, muscleMassKg: null, bodyWaterPct: null, boneMassKg: null, bmi: null }));
    const t = weightTrend(w);
    const last = t[t.length - 1];
    expect(Math.abs(last.trend - (90 - 49 * 0.02))).toBeLessThan(0.6);
    expect(weightChange(t, "2026-10-20", 4).kg).toBeLessThan(0);
  });
  it("flags too-fast weight goals", () => {
    expect(checkGoal(90, 80, "2026-10-20", "2026-12-01")?.verdict).toBe("för snabb");
    expect(checkGoal(90, 86, "2026-10-20", "2027-04-01")?.verdict).toBe("rimlig");
  });
});

describe("analysis honesty", () => {
  it("reports no pattern with too little data", () => {
    const b = { ...demoBundle(TODAY), wellness: normalWeeks().slice(-10), checkins: [] };
    expect(patterns(b).every((p) => p.status === "för lite data")).toBe(true);
  });
  it("never compares crosstrainer with other sports", () => {
    const acts = range("2026-08-01", "2026-10-20").filter((_, i) => i % 3 === 0).map((d, i) =>
      act(d, i % 2 ? { sport: "crosstrainer", typeKey: "elliptical", avgPower: 200 } : { sport: "cycling", typeKey: "road_biking", avgPower: 180 }));
    const c = comparisons(acts, profile);
    for (const group of c) expect(new Set(group.points.map((p) => acts.find((a) => a.id === p.activityId)!.sport)).size).toBe(1);
    expect(c.find((g) => g.group.startsWith("crosstrainer"))?.unit).toBe("slag/min");
  });
  it("maps Garmin types to sports", () => {
    expect(sportFromType("elliptical")).toBe("crosstrainer");
    expect(sportFromType("indoor_cycling")).toBe("cycling");
    expect(sportFromType("strength_training")).toBe("strength");
    expect(sportFromType("treadmill_running")).toBe("running");
  });
  it("demo data is always labelled demo", () => {
    const b = demoBundle(TODAY);
    expect(b.mode).toBe("demo");
    expect([...b.activities, ...b.wellness, ...b.weights].every((x) => x.source === "demo")).toBe(true);
  });
});
