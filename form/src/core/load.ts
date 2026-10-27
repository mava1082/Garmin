import { addDays, range } from "./dates";
import { trimp } from "./activities";
import type { Activity, Profile } from "./types";

export interface LoadDay { date: string; load: number; fitness: number; fatigue: number; }

/**
 * Exponentially weighted chronic (42 d) and acute (7 d) training load, the
 * Banister impulse-response idea as used in CTL/ATL. Values are relative to
 * the user's own history, not absolute fitness.
 */
export function loadSeries(activities: Activity[], profile: Profile, from: string, to: string): LoadDay[] {
  const byDay = new Map<string, number>();
  for (const a of activities) byDay.set(a.date, (byDay.get(a.date) ?? 0) + trimp(a, profile));
  const first = activities.length ? activities.reduce((m, a) => (a.date < m ? a.date : m), from) : from;
  let fitness = 0, fatigue = 0;
  const out: LoadDay[] = [];
  for (const d of range(first < from ? first : from, to)) {
    const load = byDay.get(d) ?? 0;
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    if (d >= from) out.push({ date: d, load, fitness, fatigue });
  }
  return out;
}

/** Acute:chronic ratio of the last day; only meaningful with enough history. */
export function loadRatio(series: LoadDay[]): number | null {
  const last = series[series.length - 1];
  if (!last || last.fitness < 10) return null;
  return last.fatigue / last.fitness;
}

export function minutesBetween(activities: Activity[], from: string, to: string): number {
  return activities.filter((a) => a.date >= from && a.date <= to).reduce((s, a) => s + (a.durationS ?? 0) / 60, 0);
}

export function daysSince(activities: Activity[], today: string, pred: (a: Activity) => boolean): number | null {
  const last = activities.filter((a) => a.date <= today && pred(a)).map((a) => a.date).sort().pop();
  if (!last) return null;
  let n = 0;
  for (let d = last; d < today; d = addDays(d, 1)) n++;
  return n;
}
