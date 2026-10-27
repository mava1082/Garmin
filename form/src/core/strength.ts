import { addDays, stockholmParts } from "./dates";
import type { Activity, StrengthSet } from "./types";

/**
 * StrengthLog CSV import.
 *
 * Verified against a real StrengthLog export (2026):
 *   workout,start,end,exercise,specialset,weight,bodyweight,extraWeight,reps,rir,warmup,max,fail,checked,...
 * - start/end are epoch milliseconds, weight uses a decimal comma ("27,5"),
 *   bodyweight exercises (chins, dips) leave weight empty and fill bodyweight/extraWeight.
 * Other CSV layouts with a date column are still accepted.
 */
export interface ParsedCsv {
  sets: Omit<StrengthSet, "source">[];
  skipped: number;
  warmups: number;
  sessions: number;
  columns: Record<string, string | null>;
}

const COLS: Record<string, RegExp> = {
  date: /^(date|datum|workout date|start|start ?time|starttid|tid)$/i,
  end: /^(end|end ?time|sluttid)$/i,
  exercise: /^(exercise|exercise name|övning|övningsnamn)$/i,
  weight: /^(weight|weight \(kg\)|vikt|vikt \(kg\)|kg|load)$/i,
  bodyweight: /^(bodyweight|kroppsvikt)$/i,
  extra: /^(extraweight|extra weight|extravikt)$/i,
  reps: /^(reps|repetitions|repetitioner|antal|reps \(st\))$/i,
  set: /^(set|set order|set #|setnummer|set nr)$/i,
  rpe: /^(rpe)$/i,
  rir: /^(rir)$/i,
  warmup: /^(warmup|warm-up|uppvärmning)$/i,
  workout: /^(workout|workout name|pass|passnamn|session)$/i,
  checked: /^(checked)$/i,
};

export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const MAX_SESSION_S = 3 * 3600;

const toNum = (s: string | undefined) => {
  if (s == null || s === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** A date column may hold "2026-10-20", "2026-10-20 18:00" or epoch seconds/milliseconds. */
function parseWhen(v: string | undefined): { date: string; time: string; epochMs: number | null } | null {
  if (!v) return null;
  if (/^\d{10,13}$/.test(v)) {
    const ms = v.length === 13 ? Number(v) : Number(v) * 1000;
    const p = stockholmParts(new Date(ms));
    return { date: p.date, time: p.time, epochMs: ms };
  }
  const m = v.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  return m ? { date: m[1], time: m[2] ?? "12:00", epochMs: null } : null;
}

/** Short stable hash (FNV-1a) so similar exercise names never collide in ids. */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
};

const slug = (s: string) => s.toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);

export function parseStrengthCsv(text: string): ParsedCsv {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const empty = { sets: [], skipped: 0, warmups: 0, sessions: 0, columns: {} };
  if (lines.length < 2) return empty;
  const sep = [";", "\t", ","].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const header = splitCsvLine(lines[0], sep);
  const idx: Record<string, number> = {};
  const columns: Record<string, string | null> = {};
  for (const [key, re] of Object.entries(COLS)) {
    const i = header.findIndex((h) => re.test(h.trim()));
    idx[key] = i;
    columns[key] = i >= 0 ? header[i] : null;
  }
  if (idx.date < 0 || idx.exercise < 0) return { ...empty, skipped: lines.length - 1, columns };
  const sets: ParsedCsv["sets"] = [];
  const counter = new Map<string, number>();
  let skipped = 0, warmups = 0;
  const lastChecked = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const when = parseWhen(c[idx.date]);
    const exercise = c[idx.exercise];
    if (!when || !exercise) { skipped++; continue; }
    if (idx.warmup >= 0 && /^(true|ja|1)$/i.test(c[idx.warmup] ?? "")) { warmups++; continue; }
    const workout = idx.workout >= 0 ? c[idx.workout] : "";
    const sessionId = when.epochMs != null ? `sl-${when.epochMs}` : `sl-${when.date}${workout ? `-${slug(workout)}` : ""}`;
    const key = `${sessionId}|${exercise}`;
    const n = (counter.get(key) ?? 0) + 1;
    counter.set(key, n);
    const end = idx.end >= 0 ? toNum(c[idx.end]) : null;
    const checked = idx.checked >= 0 ? toNum(c[idx.checked]) : null;
    if (when.epochMs != null && checked) lastChecked.set(sessionId, Math.max(lastChecked.get(sessionId) ?? 0, checked));
    const bw = idx.bodyweight >= 0 ? toNum(c[idx.bodyweight]) : null;
    const extra = idx.extra >= 0 ? toNum(c[idx.extra]) : null;
    const weight = toNum(c[idx.weight]) ?? (bw != null ? bw + (extra ?? 0) : null);
    const rir = idx.rir >= 0 ? toNum(c[idx.rir]) : null;
    const setIndex = toNum(c[idx.set]) ?? n;
    sets.push({
      // Deterministic id: importing the same export twice never duplicates sets.
      id: `${sessionId}-${slug(exercise).slice(0, 16)}${hash(exercise)}-${n}`,
      date: when.date, sessionId, exercise: exercise.slice(0, 80), setIndex,
      weightKg: weight, reps: toNum(c[idx.reps]),
      rpe: idx.rpe >= 0 ? toNum(c[idx.rpe]) : rir != null ? Math.max(1, 10 - rir) : null,
      sessionName: workout || null,
      sessionStart: `${when.date}T${when.time}`,
      sessionDurationS: when.epochMs != null && end && end > when.epochMs ? Math.round((end - when.epochMs) / 1000) : null,
    });
  }
  // A session left open in StrengthLog gets an end time many hours later. Then use the last
  // checked set (+2 min) instead, and drop the duration if it is still implausible.
  for (const set of sets) {
    const start = Number(set.sessionId.slice(3));
    if (set.sessionDurationS != null && set.sessionDurationS > MAX_SESSION_S) {
      const last = lastChecked.get(set.sessionId);
      const est = last && last > start ? Math.round((last - start) / 1000) + 120 : null;
      set.sessionDurationS = est != null && est <= MAX_SESSION_S ? est : null;
    }
  }
  return { sets, skipped, warmups, sessions: new Set(sets.map((s) => s.sessionId)).size, columns };
}

/**
 * StrengthLog sessions as activities, so they count in the week, plan and
 * trends without logging twice. Skipped when the watch already recorded a
 * strength activity the same day.
 */
export function strengthActivities(sets: StrengthSet[], activities: Activity[]): Activity[] {
  const sessions = new Map<string, StrengthSet[]>();
  for (const s of sets) sessions.set(s.sessionId, [...(sessions.get(s.sessionId) ?? []), s]);
  const watchDays = new Set(activities.filter((a) => a.sport === "strength" && a.source !== "strengthlog").map((a) => a.date));
  const out: Activity[] = [];
  for (const [id, ss] of sessions) {
    const first = ss[0];
    if (watchDays.has(first.date)) continue;
    const start = first.sessionStart ?? `${first.date}T12:00`;
    out.push({
      id, source: first.source, startLocal: `${start}:00`, startUtc: null, date: first.date, sport: "strength", typeKey: "strength_training",
      name: first.sessionName || "Styrka (StrengthLog)", durationS: first.sessionDurationS ?? null, distanceM: null, avgHr: null, maxHr: null,
      avgSpeed: null, avgPower: null, normPower: null, avgCadence: null, elevationGainM: null, calories: null, aerobicTe: null, anaerobicTe: null,
      zoneSeconds: null, hasStreams: false, rpe: null, note: `${ss.length} set, ${new Set(ss.map((s) => s.exercise)).size} övningar`,
    });
  }
  return out;
}

/** Epley estimated 1RM; only for sets with both weight and 1–12 reps. */
export function e1rm(weight: number | null, reps: number | null): number | null {
  if (!weight || !reps || reps < 1 || reps > 12) return null;
  return weight * (1 + reps / 30);
}

export interface ExerciseProgress { exercise: string; sessions: { date: string; best: number; volume: number }[]; changePct: number | null; }

export function exerciseProgress(sets: StrengthSet[], minSessions = 3): ExerciseProgress[] {
  const by = new Map<string, Map<string, StrengthSet[]>>();
  for (const s of sets) {
    if (s.weightKg == null || s.reps == null) continue;
    const ex = by.get(s.exercise) ?? new Map();
    ex.set(s.date, [...(ex.get(s.date) ?? []), s]);
    by.set(s.exercise, ex);
  }
  const out: ExerciseProgress[] = [];
  for (const [exercise, days] of by) {
    const sessions = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ss]) => ({
      date, best: Math.max(0, ...ss.map((s) => e1rm(s.weightKg, s.reps) ?? 0)), volume: ss.reduce((v, s) => v + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
    })).filter((s) => s.best > 0);
    if (sessions.length < minSessions) continue;
    const first = sessions.slice(0, 2).reduce((a, s) => a + s.best, 0) / Math.min(2, sessions.length);
    const last = sessions.slice(-2).reduce((a, s) => a + s.best, 0) / Math.min(2, sessions.length);
    out.push({ exercise, sessions, changePct: first ? ((last - first) / first) * 100 : null });
  }
  return out.sort((a, b) => b.sessions.length - a.sessions.length);
}

/** Each exercise belongs to the first matching group, so a set is never counted twice. */
const GROUPS: [string, RegExp][] = [
  ["Baksida/höft", /marklyft|deadlift|rdl|höftlyft|hip ?thrust|lårcurl|leg curl|swing|good morning|glute|ryggresning|back ext/i],
  ["Ben", /knäböj|frontböj|squat|benpress|leg press|benspark|leg ext|utfall|lunge|split|step|bulgar|vad|calf/i],
  ["Axlar", /axelpress|^press$|pushpress|push press|militärpress|overhead|sidolyft|lateral|baksida axlar|omvända.*flyes|rear delt|framåtlyft|y-raise|drag till hakan|upright/i],
  ["Bröst", /bänk|bench|bröst|chest|hantelpress|dips|armhäv|push-?up|flyes/i],
  ["Rygg", /rodd|row|chins|pull|latsdrag|face pull|shrug|t-bar/i],
  ["Armar", /curl|triceps|pushdown|extension|french press/i],
  ["Bål", /planka|plank|pallof|dead ?bug|crunch|core|sit-?up|ab wheel|bål|benlyft|knälyft|utrullning|maghjul/i],
];

export function muscleGroup(exercise: string): string | null {
  return GROUPS.find(([, re]) => re.test(exercise))?.[0] ?? null;
}

/** Average sets per muscle group and week over the last four weeks (28 days up to today). */
export function muscleCoverage(sets: StrengthSet[], today: string): { group: string; perWeek: number }[] {
  const from = addDays(today, -27);
  const recent = sets.filter((s) => s.date >= from && s.date <= today);
  return GROUPS.map(([group]) => ({ group, perWeek: recent.filter((s) => muscleGroup(s.exercise) === group).length / 4 }));
}
