import { comparableGroup, sessionKind } from "./activities";
import { addDays, weekStart } from "./dates";
import { median, slope } from "./stats";
import type { Activity, HrZones, Profile, Sport } from "./types";
import { activityZones } from "./zones";

export interface WeekSummary { week: string; minutes: Record<Sport, number>; sessions: number; strength: number; hard: number; }

export function weeklySummary(activities: Activity[], zones: HrZones[], profile: Profile, today: string, weeks = 12): WeekSummary[] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out: WeekSummary[] = [];
  for (let w = first; w <= today; w = addDays(w, 7)) {
    const acts = activities.filter((a) => a.date >= w && a.date < addDays(w, 7));
    const minutes = { strength: 0, crosstrainer: 0, cycling: 0, running: 0, walking: 0, other: 0 } as Record<Sport, number>;
    for (const a of acts) minutes[a.sport] += (a.durationS ?? 0) / 60;
    out.push({ week: w, minutes, sessions: acts.length, strength: acts.filter((a) => a.sport === "strength").length,
      hard: acts.filter((a) => sessionKind(a, zones, profile) === "intervals").length });
  }
  return out;
}

export interface MonthSummary { month: string; minutes: number; sessions: number; }

export function monthlySummary(activities: Activity[], today: string, months = 6): MonthSummary[] {
  const out: MonthSummary[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const acts = activities.filter((a) => a.date.startsWith(key));
    out.push({ month: key, minutes: acts.reduce((s, a) => s + (a.durationS ?? 0) / 60, 0), sessions: acts.length });
  }
  return out;
}

export interface IntensitySplit { low: number; mid: number; high: number; totalMin: number; estimatedShare: number; }

/** Share of endurance time in zone 1-2 / 3 / 4-5. Strength is excluded: HR does not describe its intensity. */
export function intensitySplit(activities: Activity[], zones: HrZones[], profile: Profile, from: string, to: string): IntensitySplit | null {
  let low = 0, mid = 0, high = 0, est = 0;
  for (const a of activities) {
    if (a.date < from || a.date > to || a.sport === "strength") continue;
    const z = activityZones(a, zones, profile);
    if (!z) continue;
    const [z1, z2, z3, z4, z5] = z.seconds;
    low += z1 + z2; mid += z3; high += z4 + z5;
    if (z.estimated) est += z1 + z2 + z3 + z4 + z5;
  }
  const total = low + mid + high;
  if (!total) return null;
  return { low: low / total, mid: mid / total, high: high / total, totalMin: total / 60, estimatedShare: est / total };
}

export interface ComparisonPoint { date: string; activityId: string; value: number; hr: number; context: string; }
export interface Comparison {
  group: string;
  title: string;
  unit: string;
  points: ComparisonPoint[];
  trendPerMonth: number | null;
  caveats: string[];
  enough: boolean;
}

/**
 * Like-for-like comparisons:
 * - running outdoors: speed at easy HR (m/min per beat) – fart vid liknande puls
 * - cycling with power: watts per beat – effekt vid samma puls
 * Crosstrainer watts are never compared across machines; only HR and time are shown.
 */
export function comparisons(activities: Activity[], profile: Profile): Comparison[] {
  const out: Comparison[] = [];
  const steady = (a: Activity) => (a.durationS ?? 0) >= 20 * 60 && a.avgHr != null && a.avgHr < 0.85 * profile.maxHr;
  const groups = new Map<string, Activity[]>();
  for (const a of activities) if (steady(a)) groups.set(comparableGroup(a), [...(groups.get(comparableGroup(a)) ?? []), a]);

  const build = (group: string, title: string, unit: string, val: (a: Activity) => number | null, caveats: string[]) => {
    const points = (groups.get(group) ?? []).flatMap((a) => {
      const v = val(a);
      return v == null ? [] : [{ date: a.date, activityId: a.id, value: v, hr: a.avgHr!, context: a.name ?? "" }];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const t0 = points[0] ? Date.parse(points[0].date) : 0;
    const s = slope(points.map((p) => [(Date.parse(p.date) - t0) / (30 * 86_400_000), p.value]));
    out.push({ group, title, unit, points, trendPerMonth: points.length >= 6 ? s : null, caveats, enough: points.length >= 6 });
  };
  build("running:ute", "Löpning ute: fart per hjärtslag", "m/slag", (a) => (a.avgSpeed && a.avgHr ? (a.avgSpeed * 60) / a.avgHr : null),
    ["Terräng, vind, temperatur och dagsform påverkar. Väderdata saknas, så enskilda pass ska inte övertolkas."]);
  build("running:inne", "Löpband: fart per hjärtslag", "m/slag", (a) => (a.avgSpeed && a.avgHr ? (a.avgSpeed * 60) / a.avgHr : null),
    ["Löpbandets fart kan skilja sig från klockans."]);
  build("cycling:ute", "Cykel ute: watt per hjärtslag", "W/slag", (a) => ((a.normPower ?? a.avgPower) && a.avgHr ? (a.normPower ?? a.avgPower)! / a.avgHr : null),
    ["Kräver effektmätare. Backar, vind och temperatur påverkar pulsen."]);
  build("cycling:inne", "Inomhuscykel: watt per hjärtslag", "W/slag", (a) => (a.avgPower && a.avgHr ? a.avgPower / a.avgHr : null),
    ["Jämför bara pass på samma cykel/trainer."]);
  build("crosstrainer:inne", "Crosstrainer: snittpuls per pass", "slag/min", (a) => a.avgHr,
    ["Watt från olika crosstrainers är inte jämförbara, så bara puls och tid visas."]);
  return out.filter((c) => c.points.length > 0);
}

/** Sessions per week averaged over the last 4 weeks. */
export function recentFrequency(activities: Activity[], today: string): number {
  return activities.filter((a) => a.date > addDays(today, -28) && a.date <= today).length / 4;
}

export function typicalDuration(activities: Activity[], sport: Sport): number | null {
  return median(activities.filter((a) => a.sport === sport).map((a) => (a.durationS ?? 0) / 60));
}

