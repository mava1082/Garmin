import { sessionKind } from "./activities";
import { addDays, daysBetween, isoWeek, range, weekStart, weekday } from "./dates";
import type { Activity, HrZones, PlanItem, Profile, SessionKind } from "./types";
import { pickModality } from "./workouts";

export type WeekType = "A" | "B";

export function weekType(date: string, profile: Profile): WeekType {
  return isoWeek(date) % 2 === profile.weekAParity ? "A" : "B";
}

/** Session order on training days. A: 3 kondition + 2 styrka, B: 2 kondition + 3 styrka; one interval session each week. */
const PATTERN: Record<WeekType, SessionKind[]> = {
  A: ["easy", "strength", "intervals", "strength", "easy"],
  B: ["strength", "easy", "strength", "intervals", "strength"],
};

export function templateWeek(monday: string, profile: Profile): Omit<PlanItem, "id">[] {
  const type = weekType(monday, profile);
  const days = [...profile.trainingDays].sort();
  let easyIndex = 0;
  return days.slice(0, PATTERN[type].length).map((wd, i) => {
    const kind = PATTERN[type][i];
    const modality = kind === "strength" ? "gym" : pickModality(profile, { pain: 0, painAreas: [] }, easyIndex++ % 2 ? [profile.enduranceModalities[0]] : []);
    return {
      date: addDays(monday, wd - 1), kind, modality, templateId: null,
      minutes: kind === "strength" ? profile.strengthMinutes : kind === "intervals" ? 40 : profile.easyMinutes,
      status: "planned", activityId: null, note: null,
    };
  });
}

/**
 * Stored plan items, plus the template week for any week that has no stored
 * items yet, so the coach has something sensible before a plan is approved.
 */
export function effectivePlan(plan: PlanItem[], profile: Profile, from: string, to: string): PlanItem[] {
  const out = plan.filter((p) => p.date >= from && p.date <= to);
  for (let monday = weekStart(from); monday <= to; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    if (plan.some((p) => p.date >= monday && p.date <= sunday)) continue;
    for (const t of templateWeek(monday, profile)) if (t.date >= from && t.date <= to) out.push({ ...t, id: `tpl-${t.date}`, templateId: "vecko-upplagg" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type ItemState = "done" | "missed" | "planned" | "skipped" | "today";

export interface PlanView {
  item: PlanItem;
  state: ItemState;
  activity: Activity | null;
}

/** Matches Garmin activities to planned items. Derived on the fly; never rewrites stored items. */
export function viewPlan(plan: PlanItem[], activities: Activity[], zones: HrZones[], profile: Profile, today: string) {
  const used = new Set<string>();
  const views: PlanView[] = [...plan].sort((a, b) => a.date.localeCompare(b.date)).map((item) => {
    if (item.status === "skipped") return { item, state: "skipped" as const, activity: null };
    const explicit = item.activityId ? activities.find((a) => a.id === item.activityId) ?? null : null;
    const match = explicit ?? activities.find((a) => !used.has(a.id) && a.date === item.date && compatible(item.kind, a, zones, profile)) ?? null;
    if (match) { used.add(match.id); return { item, state: "done" as const, activity: match }; }
    if (item.date < today) return { item, state: "missed" as const, activity: null };
    return { item, state: item.date === today ? ("today" as const) : ("planned" as const), activity: null };
  });
  const extras = activities.filter((a) => !used.has(a.id));
  return { views, extras };
}

function compatible(kind: SessionKind, a: Activity, zones: HrZones[], profile: Profile): boolean {
  if (kind === "strength") return a.sport === "strength";
  if (kind === "rest") return false;
  if (kind === "recovery") return a.sport === "walking" || sessionKind(a, zones, profile) !== "intervals";
  return a.sport !== "strength";
}

export interface PlanChange { type: "add" | "change"; date: string; before: PlanItem | null; after: Omit<PlanItem, "id">; reason: string; }

/**
 * Proposes the rolling two-week plan. Existing items are kept; empty training
 * days get the template session. Conflicts (hard sessions too close or too
 * many) are fixed by downgrading, never by stacking missed sessions.
 */
export function proposePlan(input: { today: string; plan: PlanItem[]; activities: Activity[]; zones: HrZones[]; profile: Profile }): PlanChange[] {
  const { today, plan, activities, profile, zones } = input;
  const end = addDays(today, 13);
  const changes: PlanChange[] = [];
  const result = new Map<string, Omit<PlanItem, "id">[]>();
  for (const p of plan.filter((p) => p.date >= today && p.date <= end)) {
    result.set(p.date, [...(result.get(p.date) ?? []), p]);
  }
  for (let monday = weekStart(today); monday <= end; monday = addDays(monday, 7)) {
    for (const t of templateWeek(monday, profile)) {
      if (t.date < today || t.date > end || result.has(t.date)) continue;
      result.set(t.date, [t]);
      changes.push({ type: "add", date: t.date, before: null, after: t, reason: `Enligt ditt veckoupplägg (vecka ${weekType(t.date, profile)}).` });
    }
  }
  // Hard-session rules: at most one interval session per week, at least two days between hard sessions.
  const doneHard = activities.filter((a) => a.date < today && sessionKind(a, zones, profile) === "intervals").map((a) => a.date);
  const hardDates: string[] = [...doneHard];
  for (const date of range(today, end)) {
    for (const item of result.get(date) ?? []) {
      if (item.kind !== "intervals" || item.status !== "planned") continue;
      const tooClose = hardDates.some((d) => Math.abs(daysBetween(d, date)) < 2);
      const sameWeek = hardDates.some((d) => weekStart(d) === weekStart(date));
      if (tooClose || sameWeek) {
        const before = plan.find((p) => p.date === date && p.kind === "intervals") ?? null;
        const after = { ...item, kind: "easy" as const, minutes: profile.easyMinutes };
        changes.push({ type: "change", date, before, after, reason: sameWeek ? "Du har redan ett intervallpass den här veckan." : "För nära ett annat hårt pass – minst 48 timmar emellan." });
        Object.assign(item, after);
      } else hardDates.push(date);
    }
  }
  return changes.sort((a, b) => a.date.localeCompare(b.date));
}

export function moveWarnings(plan: PlanItem[], id: string, toDate: string): string[] {
  const item = plan.find((p) => p.id === id);
  if (!item) return [];
  const warnings: string[] = [];
  const others = plan.filter((p) => p.id !== id && p.status === "planned");
  if (others.some((p) => p.date === toDate)) warnings.push("Det finns redan ett pass den dagen.");
  if (item.kind === "intervals") {
    if (others.some((p) => p.kind === "intervals" && Math.abs(daysBetween(p.date, toDate)) < 2)) warnings.push("Hamnar mindre än 48 timmar från ett annat intervallpass.");
    if (others.some((p) => p.kind === "intervals" && weekStart(p.date) === weekStart(toDate))) warnings.push("Ger två intervallpass samma vecka.");
  }
  if (weekday(toDate) > 5 && !plan.some((p) => weekday(p.date) > 5)) warnings.push("Du brukar inte träna på helger – det går bra om det passar.");
  return warnings;
}
