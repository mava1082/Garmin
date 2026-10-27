/** D1 persistence. Documents are JSON; see migrations/0001_init.sql. */
import { mergeProfile } from "../core/profile";
import type {
  Activity, ActivityStreams, CheckIn, DailyWellness, DataBundle, HrZones, Measurement, PlanItem, Profile, StrengthSet, SyncStatus, WeightEntry,
} from "../core/types";

const now = () => new Date().toISOString();

async function docs<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<{ doc: string }>();
  return (res.results ?? []).map((r) => JSON.parse(r.doc) as T);
}

export async function getKv<T>(db: D1Database, key: string): Promise<T | null> {
  const r = await db.prepare("SELECT doc FROM kv WHERE key = ?").bind(key).first<{ doc: string }>();
  return r ? (JSON.parse(r.doc) as T) : null;
}

export async function setKv(db: D1Database, key: string, value: unknown) {
  await db.prepare("INSERT INTO kv (key, doc) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET doc = excluded.doc").bind(key, JSON.stringify(value)).run();
}

export async function loadBundle(db: D1Database, today: string, sinceDays = 400): Promise<DataBundle> {
  const since = new Date(Date.parse(today) - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const [activities, wellness, weights, measurements, checkins, plan, strength, zones, profile, sync] = await Promise.all([
    docs<Activity>(db, "SELECT doc FROM activities WHERE date >= ? ORDER BY date, id", since),
    docs<DailyWellness>(db, "SELECT doc FROM wellness WHERE date >= ? ORDER BY date", since),
    docs<WeightEntry>(db, "SELECT doc FROM weights WHERE date >= ? ORDER BY date", since),
    docs<Measurement>(db, "SELECT doc FROM measurements ORDER BY date"),
    docs<CheckIn>(db, "SELECT doc FROM checkins WHERE date >= ? ORDER BY date", since),
    docs<PlanItem>(db, "SELECT doc FROM plan_items WHERE date >= ? ORDER BY date", since),
    docs<StrengthSet>(db, "SELECT doc FROM strength_sets WHERE date >= ? ORDER BY date", since),
    docs<HrZones>(db, "SELECT doc FROM zones ORDER BY key"),
    getKv<Partial<Profile>>(db, "profile"),
    getKv<SyncStatus>(db, "sync"),
  ]);
  // Manual zones override Garmin's for the same sport.
  const bySport = new Map<string, HrZones>();
  for (const z of zones) if (!bySport.has(z.sport) || z.source === "manual") bySport.set(z.sport, z);
  return {
    mode: "real", generatedAt: now(), today, profile: mergeProfile(profile), activities, wellness, weights, measurements, checkins, plan, strength,
    zones: [...bySport.values()],
    sync: sync ?? { lastSuccessAt: null, lastAttemptAt: null, lastError: null, datasets: {} },
  };
}

// ------------------------------------------------------------------ ingest

/** Upserts Garmin activities. User fields (RPE, note) and computed streams info survive a re-sync. */
export async function ingestActivities(db: D1Database, items: Activity[]) {
  if (!items.length) return;
  const existing = new Map((await docs<Activity>(db, `SELECT doc FROM activities WHERE id IN (${items.map(() => "?").join(",")})`, ...items.map((a) => a.id))).map((a) => [a.id, a]));
  await db.batch(items.map((a) => {
    const old = existing.get(a.id);
    const merged: Activity = { ...a, source: "garmin", rpe: old?.rpe ?? null, note: old?.note ?? null, hasStreams: old?.hasStreams ?? false, zoneSeconds: a.zoneSeconds ?? old?.zoneSeconds ?? null };
    return db.prepare("INSERT INTO activities (id, source, date, doc, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, doc = excluded.doc, updated_at = excluded.updated_at")
      .bind(a.id, "garmin", merged.date, JSON.stringify(merged), now());
  }));
}

export async function ingestStreams(db: D1Database, items: { activityId: string; streams: ActivityStreams; zoneSeconds: number[] | null }[]) {
  for (const it of items) {
    const row = await db.prepare("SELECT doc FROM activities WHERE id = ?").bind(it.activityId).first<{ doc: string }>();
    const stmts = [db.prepare("INSERT INTO streams (activity_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(activity_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at")
      .bind(it.activityId, JSON.stringify(it.streams), now())];
    if (row) {
      const a = JSON.parse(row.doc) as Activity;
      stmts.push(db.prepare("UPDATE activities SET doc = ? WHERE id = ?").bind(JSON.stringify({ ...a, hasStreams: true, zoneSeconds: it.zoneSeconds ?? a.zoneSeconds }), a.id));
    }
    await db.batch(stmts);
  }
}

export async function ingestWellness(db: D1Database, items: DailyWellness[]) {
  if (!items.length) return;
  await db.batch(items.map((w) => db.prepare("INSERT INTO wellness (date, source, doc, updated_at) VALUES (?, 'garmin', ?, ?) ON CONFLICT(date) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at")
    .bind(w.date, JSON.stringify({ ...w, source: "garmin" }), now())));
}

export async function ingestWeights(db: D1Database, items: WeightEntry[]) {
  if (!items.length) return;
  await db.batch(items.map((w) => db.prepare("INSERT INTO weights (id, source, date, doc) VALUES (?, 'garmin', ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, doc = excluded.doc")
    .bind(`g-${w.id}`, w.date, JSON.stringify({ ...w, id: `g-${w.id}`, source: "garmin" }))));
}

export async function ingestZones(db: D1Database, items: HrZones[]) {
  await db.batch([db.prepare("DELETE FROM zones WHERE key LIKE 'garmin:%'"),
    ...items.map((z) => db.prepare("INSERT INTO zones (key, doc) VALUES (?, ?)").bind(`garmin:${z.sport}`, JSON.stringify({ ...z, source: "garmin" })))]);
}

export async function ingestState(db: D1Database) {
  const latest = await db.prepare("SELECT MAX(date) AS d FROM activities WHERE source = 'garmin'").first<{ d: string | null }>();
  const latestW = await db.prepare("SELECT MAX(date) AS d FROM weights WHERE source = 'garmin'").first<{ d: string | null }>();
  const dates = await db.prepare("SELECT date FROM wellness").all<{ date: string }>();
  const missing = await db.prepare("SELECT doc FROM activities WHERE source = 'garmin' AND date >= date('now', '-400 days')").all<{ doc: string }>();
  return {
    latestActivityDate: latest?.d ?? null,
    latestWeightDate: latestW?.d ?? null,
    completeDates: (dates.results ?? []).map((r) => r.date),
    activitiesWithoutStreams: (missing.results ?? []).map((r) => JSON.parse(r.doc) as Activity).filter((a) => !a.hasStreams).map((a) => a.id),
  };
}

export async function getStreams(db: D1Database, id: string): Promise<ActivityStreams | null> {
  const r = await db.prepare("SELECT doc FROM streams WHERE activity_id = ?").bind(id).first<{ doc: string }>();
  return r ? JSON.parse(r.doc) : null;
}

// ------------------------------------------------------------------ user data

export const putDoc = (db: D1Database, table: "checkins" | "plan_items" | "measurements", key: string, date: string, doc: unknown) =>
  table === "checkins"
    ? db.prepare("INSERT INTO checkins (date, doc) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET doc = excluded.doc").bind(key, JSON.stringify(doc))
    : db.prepare(`INSERT INTO ${table} (id, date, doc) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, doc = excluded.doc`).bind(key, date, JSON.stringify(doc));

export async function exportAll(db: D1Database) {
  const tables = ["activities", "streams", "wellness", "weights", "measurements", "checkins", "plan_items", "strength_sets", "zones", "kv"];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const res = await db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>();
    out[t] = (res.results ?? []).map((r) => ({ ...r, doc: typeof r.doc === "string" ? JSON.parse(r.doc) : r.doc }));
  }
  return out;
}

export async function deleteAll(db: D1Database) {
  await db.batch(["activities", "streams", "wellness", "weights", "measurements", "checkins", "plan_items", "strength_sets", "zones", "kv", "sessions"]
    .map((t) => db.prepare(`DELETE FROM ${t}`)));
}
