import { addDays, clockMinutesAroundMidnight } from "./dates";
import { mean, sd } from "./stats";
import type { DailyWellness } from "./types";

export interface SleepWindowStats {
  days: number;
  nights: number;
  avgS: number | null;
  avgScore: number | null;
  /** Mean bedtime/wake time in minutes around midnight (negative = evening). */
  bedtime: number | null;
  wake: number | null;
  /** Spread (SD, minutes) of the sleep midpoint – lower means more regular. */
  regularityMin: number | null;
}

/**
 * Sleep is stored on the date you woke up (Garmin's convention), so a night
 * from 23:10 to 06:40 belongs to the morning's date. Bedtimes before midnight
 * are handled as negative minutes so averages don't jump across midnight.
 */
export function sleepWindow(wellness: DailyWellness[], today: string, days: number): SleepWindowStats {
  const from = addDays(today, -(days - 1));
  const rows = wellness.filter((w) => w.date >= from && w.date <= today && w.sleepS != null);
  const beds = rows.map((w) => (w.sleepStartLocal ? clockMinutesAroundMidnight(w.sleepStartLocal) : null));
  const wakes = rows.map((w) => (w.sleepEndLocal ? clockMinutesAroundMidnight(w.sleepEndLocal) : null));
  const mids = rows.map((_, i) => (beds[i] != null && wakes[i] != null ? (beds[i]! + wakes[i]!) / 2 : null));
  return {
    days, nights: rows.length,
    avgS: mean(rows.map((w) => w.sleepS)),
    avgScore: mean(rows.map((w) => w.sleepScore)),
    bedtime: mean(beds), wake: mean(wakes),
    regularityMin: mids.filter((m) => m != null).length >= 5 ? sd(mids) : null,
  };
}
