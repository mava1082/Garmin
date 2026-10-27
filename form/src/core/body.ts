import { addDays, daysBetween } from "./dates";
import { round } from "./stats";
import type { WeightEntry } from "./types";

/**
 * Smoothed weight trend: exponential moving average with a 10-day time
 * constant, adjusted for gaps between weigh-ins (alpha = 1 - e^(-Δdays/10)).
 * Daily weight swings of 1–2 kg are mostly water and food, so the trend is what matters.
 */
export const TREND_TAU_DAYS = 10;

export interface TrendPoint { date: string; raw: number; trend: number; }

export function weightTrend(weights: WeightEntry[]): TrendPoint[] {
  const byDay = new Map<string, number>();
  for (const w of [...weights].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))) {
    if (!byDay.has(w.date)) byDay.set(w.date, w.weightKg); // first (morning) weigh-in of the day
  }
  const days = [...byDay.keys()].sort();
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let prev: string | null = null;
  for (const d of days) {
    const raw = byDay.get(d)!;
    if (trend == null || prev == null) trend = raw;
    else trend += (1 - Math.exp(-daysBetween(prev, d) / TREND_TAU_DAYS)) * (raw - trend);
    out.push({ date: d, raw, trend });
    prev = d;
  }
  return out;
}

export function trendAt(points: TrendPoint[], date: string): number | null {
  const before = points.filter((p) => p.date <= date);
  const last = before[before.length - 1];
  if (!last || daysBetween(last.date, date) > 10) return null;
  return last.trend;
}

export interface WeightChange { weeks: number; kg: number | null; pctPerWeek: number | null; }

export function weightChange(points: TrendPoint[], today: string, weeks: number): WeightChange {
  const now = trendAt(points, today);
  const then = trendAt(points, addDays(today, -7 * weeks));
  if (now == null || then == null) return { weeks, kg: null, pctPerWeek: null };
  return { weeks, kg: round(now - then, 1), pctPerWeek: round(((now - then) / then) * 100 / weeks, 2) };
}

export interface GoalCheck { kgToGo: number; weeksLeft: number; kgPerWeek: number; pctPerWeek: number; verdict: "rimlig" | "ambitiös" | "för snabb" | "uppnådd"; text: string; }

/** 0.5–1 % of body weight per week is a commonly recommended rate when you want to keep muscle. */
export function checkGoal(currentKg: number, targetKg: number, today: string, targetDate: string): GoalCheck | null {
  const weeksLeft = daysBetween(today, targetDate) / 7;
  if (weeksLeft <= 0) return null;
  const kgToGo = currentKg - targetKg;
  if (kgToGo <= 0) return { kgToGo, weeksLeft, kgPerWeek: 0, pctPerWeek: 0, verdict: "uppnådd", text: "Trenden ligger redan vid eller under målet." };
  const kgPerWeek = kgToGo / weeksLeft;
  const pct = (kgPerWeek / currentKg) * 100;
  const verdict = pct <= 0.75 ? "rimlig" : pct <= 1.0 ? "ambitiös" : "för snabb";
  const text = {
    rimlig: "Takten är rimlig för att behålla muskler.",
    ambitiös: "Takten är i överkant. Det går, men prioritera protein, styrketräning och sömn.",
    "för snabb": "Takten är snabbare än 1 % per vecka. Det ökar risken att tappa muskler – överväg ett senare datum.",
    uppnådd: "",
  }[verdict];
  return { kgToGo, weeksLeft, kgPerWeek, pctPerWeek: pct, verdict, text };
}

/** Suggested date for a target at 0.5 % body weight per week. */
export function suggestedGoalDate(currentKg: number, targetKg: number, today: string): string | null {
  if (targetKg >= currentKg) return null;
  const weeks = (currentKg - targetKg) / (currentKg * 0.005);
  return addDays(today, Math.ceil(weeks * 7));
}
