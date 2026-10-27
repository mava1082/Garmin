/**
 * Date helpers. All calendar logic works on "YYYY-MM-DD" strings and does day
 * arithmetic in UTC, so daylight saving changes can never shift a date.
 */

export const TZ = "Europe/Stockholm";

const pad = (n: number) => String(n).padStart(2, "0");

export function toDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function fromDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export function weekday(iso: string): number {
  const w = toDate(iso).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(iso: string): string {
  return addDays(iso, 1 - weekday(iso));
}

export function isoWeek(iso: string): number {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + 4 - weekday(iso));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Local date and time in Stockholm for an instant. */
export function stockholmParts(at: Date = new Date()): { date: string; time: string; hour: number } {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: Number(p.hour) };
}

export function todayStockholm(at: Date = new Date()): string {
  return stockholmParts(at).date;
}

/**
 * Garmin's "...TimestampLocal" fields are epoch milliseconds of the local wall
 * clock (as if local time were UTC). Reading them as UTC gives the wall clock
 * directly, which is correct on both sides of a DST change.
 */
export function localEpochToWallClock(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${fromDate(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Minutes after local midnight, with evening times as negative (23:30 -> -30). */
export function clockMinutesAroundMidnight(wallClock: string): number {
  const [h, m] = wallClock.slice(11, 16).split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= 12 * 60 ? mins - 24 * 60 : mins;
}

export function formatClock(minutesAroundMidnight: number): string {
  const m = ((Math.round(minutesAroundMidnight) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const DAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

export function formatDay(iso: string, opts: { weekday?: boolean } = {}): string {
  const d = toDate(iso);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return opts.weekday ? `${DAYS[weekday(iso) - 1]} ${base}` : base;
}

export function weekdayName(iso: string, short = false): string {
  const n = DAYS[weekday(iso) - 1];
  return short ? n.slice(0, 3) : n;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "–";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function formatHours(seconds: number | null): string {
  if (seconds == null) return "–";
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function formatPace(speed: number | null): string {
  if (!speed) return "–";
  const s = 1000 / speed;
  let min = Math.floor(s / 60);
  let sec = Math.round(s % 60);
  if (sec === 60) { min += 1; sec = 0; }
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

export function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
