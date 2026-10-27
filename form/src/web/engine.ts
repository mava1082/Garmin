/** View-model helpers on top of the core engine. */
import { addDays, formatDay, formatDuration, stockholmParts } from "../core/dates";
import { suggestToday, type CoachInput, type Suggestion, type SuggestOptions } from "../core/coach";
import { weightChange, weightTrend } from "../core/body";
import { mean } from "../core/stats";
import type { DataBundle } from "../core/types";

export const coachInput = (b: DataBundle): CoachInput => ({
  today: b.today, profile: b.profile, activities: b.activities, wellness: b.wellness, checkins: b.checkins, plan: b.plan, zones: b.zones,
});

export function suggestion(b: DataBundle, opts: SuggestOptions = {}): Suggestion {
  return suggestToday(coachInput(b), opts);
}

export function greeting(): string {
  const h = stockholmParts().hour;
  return h < 5 ? "God natt" : h < 10 ? "God morgon" : h < 17 ? "Hej" : "God kväll";
}

/** A short, data-based morning brief. Only mentions things there is data for. */
export function brief(b: DataBundle, s: Suggestion): string {
  const parts: string[] = [];
  const night = b.wellness.find((w) => w.date === b.today);
  const usual = mean(b.wellness.filter((w) => w.date < b.today && w.date >= addDays(b.today, -28)).map((w) => w.sleepS));
  if (night?.sleepS) {
    const diff = usual ? night.sleepS - usual : 0;
    parts.push(`Du sov ${formatDuration(night.sleepS)}${usual && Math.abs(diff) > 1800 ? (diff < 0 ? ", kortare än vanligt" : ", mer än vanligt") : ""}.`);
  }
  const hrv = s.recovery.signals.find((x) => x.key === "hrv");
  if (hrv?.state === "ok") parts.push("HRV ligger inom ditt normala.");
  else if (hrv?.state === "watch" || hrv?.state === "strain") parts.push("HRV ligger lägre än ditt normala.");
  const w = s.workout;
  if (w.kind === "rest") parts.push("Ingen träning planerad – vila gott.");
  else parts.push(`Förslag: ${w.title.charAt(0).toLowerCase() + w.title.slice(1)}, ${w.minutes} min.`);
  return parts.join(" ");
}

export interface DataHealth { stale: boolean; lastSync: string | null; missing: string[]; }

export function dataHealth(b: DataBundle): DataHealth {
  const last = b.sync.lastSuccessAt;
  const stale = b.mode === "real" && (!last || Date.now() - Date.parse(last) > 6 * 3600_000);
  const today = b.wellness.find((w) => w.date === b.today);
  const missing: string[] = [];
  if (b.mode === "real") {
    if (!today?.sleepS) missing.push("nattens sömn");
    if (!today?.hrvLastNight) missing.push("nattens HRV");
    if (!b.wellness.some((w) => w.date >= addDays(b.today, -1) && w.restingHr != null)) missing.push("vilopuls");
  }
  return { stale, lastSync: last, missing };
}

export function syncText(b: DataBundle): string {
  if (b.mode === "demo") return "Demoläge – påhittade data";
  const last = b.sync.lastSuccessAt;
  if (!last) return "Ingen lyckad synk än";
  const p = stockholmParts(new Date(last));
  return `Synkad ${p.date === b.today ? "idag" : formatDay(p.date)} ${p.time}`;
}

export function weightSummary(b: DataBundle) {
  const t = weightTrend(b.weights);
  const last = t[t.length - 1];
  return { trend: t, last, c4: weightChange(t, b.today, 4), c12: weightChange(t, b.today, 12) };
}
