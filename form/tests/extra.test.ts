import { describe, expect, it } from "vitest";
import { GarminClient } from "../src/garmin/client";
import { assessRecovery } from "../src/core/recovery";
import { parseStrengthCsv, exerciseProgress, e1rm } from "../src/core/strength";
import { effectivePlan } from "../src/core/plan";
import { suggestToday } from "../src/core/coach";
import { defaultProfile } from "../src/core/profile";
import { addDays, range } from "../src/core/dates";
import type { DailyWellness } from "../src/core/types";

const profile = defaultProfile();
const TODAY = "2026-10-21";

describe("access and stale data", () => {
  it("reports denied access (403 JSON) without retrying", async () => {
    let calls = 0;
    const c = new GarminClient({ apiKey: "k", minIntervalMs: 0, sleep: async () => {}, fetch: (async (u: any) => {
      calls++;
      if (String(u).includes("/token")) return new Response(`x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 86400 }))}.y`);
      return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
    }) as typeof fetch });
    await expect(c.get("/x")).rejects.toMatchObject({ kind: "denied" });
    expect(calls).toBe(2);
  });

  it("ignores old wellness data instead of treating it as today's", () => {
    const old: DailyWellness[] = range(addDays(TODAY, -60), addDays(TODAY, -5)).map((date) => ({
      date, source: "garmin", restingHr: 54, hrvLastNight: 47, hrvWeeklyAvg: null, hrvBaselineLow: 40, hrvBaselineHigh: 55, hrvStatus: null,
      sleepS: 25000, sleepScore: 75, sleepStartLocal: null, sleepEndLocal: null, deepS: null, lightS: null, remS: null, awakeS: null,
      stressAvg: null, bodyBatteryMin: null, bodyBatteryMax: null, steps: null }));
    const r = assessRecovery({ today: TODAY, wellness: old, activities: [], profile });
    expect(r.signals.find((s) => s.key === "hrv")?.state).toBe("unknown");
    expect(r.signals.find((s) => s.key === "sleep")?.state).toBe("unknown");
    expect(r.confidence).toBe("låg");
  });
});

describe("StrengthLog import", () => {
  it("detects Swedish or English columns, separators and decimal commas", () => {
    const csv = "Datum;Pass;Övning;Set;Vikt (kg);Repetitioner\n2026-10-20;Helkropp A;Knäböj;1;80,5;8\n2026-10-20;Helkropp A;Knäböj;2;80,5;7\nfelrad\n";
    const p = parseStrengthCsv(csv);
    expect(p.sets).toHaveLength(2);
    expect(p.sets[0]).toMatchObject({ date: "2026-10-20", exercise: "Knäböj", weightKg: 80.5, reps: 8, setIndex: 1 });
    expect(p.skipped).toBe(1);
    const en = parseStrengthCsv('Date,Exercise,Weight,Reps\n"2026-10-01 18:00","Bench Press",60,10\n');
    expect(en.sets[0]).toMatchObject({ exercise: "Bench Press", weightKg: 60, reps: 10 });
  });
  it("only computes progression with weight and reps", () => {
    expect(e1rm(100, null)).toBeNull();
    const sets = ["2026-09-01", "2026-09-08", "2026-09-15"].map((date, i) => ({ id: date, source: "strengthlog" as const, date, sessionId: date, exercise: "Knäböj", setIndex: 1, weightKg: 80 + i * 2.5, reps: 8, rpe: null }));
    const p = exerciseProgress(sets);
    expect(p[0].changePct).toBeGreaterThan(0);
    expect(exerciseProgress(sets.map((s) => ({ ...s, weightKg: null })))).toHaveLength(0);
  });
});

describe("plan fallback", () => {
  it("uses the week template until a plan is approved", () => {
    const items = effectivePlan([], profile, "2026-10-19", "2026-10-25");
    expect(items.length).toBe(5);
    expect(items.every((i) => i.id.startsWith("tpl-"))).toBe(true);
    const s = suggestToday({ today: TODAY, profile, activities: [], wellness: [], checkins: [], plan: [], zones: [] });
    expect(s.workout.kind).not.toBe("rest");
    expect(s.reasons[0].text).toMatch(/veckoupplägg/);
  });
  it("a stored plan for the week replaces the template", () => {
    const items = effectivePlan([{ id: "p1", date: "2026-10-22", kind: "strength", modality: "gym", templateId: null, minutes: 40, status: "planned", activityId: null, note: null }], profile, "2026-10-19", "2026-10-25");
    expect(items).toHaveLength(1);
  });
});
