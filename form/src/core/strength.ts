import { addDays, weekStart } from "./dates";
import type { StrengthSet } from "./types";

/**
 * StrengthLog CSV import. The exact export format is not documented publicly,
 * so columns are detected from the header (Swedish or English names).
 */
export interface ParsedCsv { sets: Omit<StrengthSet, "id" | "source">[]; skipped: number; columns: Record<string, string | null>; }

const COLS: Record<string, RegExp> = {
  date: /^(date|datum|workout date|start ?time|starttid|tid)$/i,
  exercise: /^(exercise|exercise name|övning|övningsnamn)$/i,
  weight: /^(weight|weight \(kg\)|vikt|vikt \(kg\)|kg|load)$/i,
  reps: /^(reps|repetitions|repetitioner|antal|reps \(st\))$/i,
  set: /^(set|set order|set #|setnummer|set nr)$/i,
  rpe: /^(rpe)$/i,
  workout: /^(workout|workout name|pass|passnamn|session)$/i,
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

const toNum = (s: string | undefined) => {
  if (s == null || s === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function parseStrengthCsv(text: string): ParsedCsv {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { sets: [], skipped: 0, columns: {} };
  const sep = [";", "\t", ","].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const header = splitCsvLine(lines[0], sep);
  const idx: Record<string, number> = {};
  const columns: Record<string, string | null> = {};
  for (const [key, re] of Object.entries(COLS)) {
    const i = header.findIndex((h) => re.test(h.trim()));
    idx[key] = i;
    columns[key] = i >= 0 ? header[i] : null;
  }
  if (idx.date < 0 || idx.exercise < 0) return { sets: [], skipped: lines.length - 1, columns };
  const sets: ParsedCsv["sets"] = [];
  const counter = new Map<string, number>();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const date = (c[idx.date] ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const exercise = c[idx.exercise];
    if (!date || !exercise) { skipped++; continue; }
    const sessionId = `sl-${date}${idx.workout >= 0 && c[idx.workout] ? `-${c[idx.workout].toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").slice(0, 30)}` : ""}`;
    const key = `${sessionId}|${exercise}`;
    const n = (counter.get(key) ?? 0) + 1;
    counter.set(key, n);
    sets.push({ date, sessionId: sessionId.replace(/[^\w.:-]/g, "-"), exercise: exercise.slice(0, 80), setIndex: toNum(c[idx.set]) ?? n,
      weightKg: toNum(c[idx.weight]), reps: toNum(c[idx.reps]), rpe: idx.rpe >= 0 ? toNum(c[idx.rpe]) : null });
  }
  return { sets, skipped, columns };
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

const GROUPS: [string, RegExp][] = [
  ["Ben (knädominant)", /squat|knäböj|benpress|leg press|utfall|lunge|split|step|bulgar/i],
  ["Baksida/höft", /mark|deadlift|rdl|höftlyft|hip thrust|swing|good morning|leg curl|lårcurl/i],
  ["Press", /bänk|bench|press|armhäv|push|dips/i],
  ["Drag", /rodd|row|chins|pull|latsdrag|lat ?pull|face pull/i],
  ["Bål", /planka|plank|pallof|dead ?bug|crunch|core|ab/i],
];

/** Sets per muscle group over the last four weeks, recognised from exercise names. */
export function muscleCoverage(sets: StrengthSet[], today: string): { group: string; sets: number }[] {
  const from = addDays(weekStart(today), -21);
  const recent = sets.filter((s) => s.date >= from && s.date <= today);
  return GROUPS.map(([group, re]) => ({ group, sets: recent.filter((s) => re.test(s.exercise)).length }));
}
