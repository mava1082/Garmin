/**
 * FORM server (Cloudflare Worker).
 *
 * - /api/*         JSON API, requires a session cookie (except login and health)
 * - /api/ingest/*  data from the Garmin sync job, requires INGEST_TOKEN
 * - everything else: the app (static assets, SPA fallback)
 *
 * Secrets (Worker secrets, never in git or the frontend): APP_PASSWORD, INGEST_TOKEN,
 * optional GITHUB_TOKEN + GITHUB_REPO for the "Synka nu" button.
 */
import { Hono, type Context } from "hono";
import { todayStockholm } from "../core/dates";
import { defaultProfile, mergeProfile } from "../core/profile";
import type { Activity, CheckIn, HrZones, Measurement, Modality, PainArea, PlanItem, Profile, StrengthSet, WeightEntry } from "../core/types";
import {
  clearCookie, createSession, deleteSession, readCookie, recordAttempt, safeEqual, sessionCookie, tooManyFailures, validSession,
} from "./auth";
import {
  deleteAll, exportAll, getKv, getStreams, ingestActivities, ingestState, ingestStreams, ingestWeights, ingestWellness, ingestZones, loadBundle, putDoc, setKv,
} from "./store";
import { BadRequest, date, id, int, isDate, num, oneOf, str } from "./validate";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_PASSWORD?: string;
  INGEST_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  SYNC_WORKFLOW?: string;
  GITHUB_REF?: string;
}

type C = Context<{ Bindings: Env }>;

export const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "Ogiltig JSON." }, 400);
  console.error("Serverfel:", err instanceof Error ? err.message : "okänt");
  return c.json({ error: "Något gick fel på servern." }, 500);
});

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

// ------------------------------------------------------------------ public

app.get("/api/health", (c) => c.json({ ok: true, configured: !!c.env.APP_PASSWORD }));

app.post("/api/login", async (c) => {
  if (!c.env.APP_PASSWORD) return c.json({ error: "Appen saknar lösenord (APP_PASSWORD). Se instruktionen." }, 503);
  if (await tooManyFailures(c.env.DB)) return c.json({ error: "För många felaktiga försök. Vänta 15 minuter." }, 429);
  const body = await c.req.json<{ password?: unknown }>();
  const ok = typeof body.password === "string" && (await safeEqual(body.password, c.env.APP_PASSWORD));
  await recordAttempt(c.env.DB, ok);
  if (!ok) return c.json({ error: "Fel lösenord." }, 401);
  const { token, maxAge } = await createSession(c.env.DB);
  c.header("Set-Cookie", sessionCookie(token, maxAge));
  return c.json({ ok: true });
});

app.post("/api/logout", async (c) => {
  await deleteSession(c.env.DB, readCookie(c.req.header("Cookie")));
  c.header("Set-Cookie", clearCookie());
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ ingest (sync job)

app.use("/api/ingest/*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!c.env.INGEST_TOKEN || !(await safeEqual(token, c.env.INGEST_TOKEN))) return c.json({ error: "Ej behörig." }, 401);
  await next();
});

app.get("/api/ingest/state", async (c) => c.json(await ingestState(c.env.DB)));

app.post("/api/ingest/:kind", async (c) => {
  const kind = c.req.param("kind");
  const body = await c.req.json<{ items?: unknown[] }>();
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 500) throw new BadRequest("För många poster i en förfrågan.");
  const db = c.env.DB;
  switch (kind) {
    case "activities": await ingestActivities(db, (items as Activity[]).filter((a) => typeof a?.id === "string" && isDate(a.date))); break;
    case "wellness": await ingestWellness(db, (items as any[]).filter((w) => isDate(w?.date))); break;
    case "weights": await ingestWeights(db, (items as WeightEntry[]).filter((w) => isDate(w?.date) && typeof w.weightKg === "number")); break;
    case "zones": await ingestZones(db, (items as HrZones[]).filter((z) => Array.isArray(z?.floors) && z.floors.length === 5)); break;
    case "streams": await ingestStreams(db, (items as any[]).filter((s) => typeof s?.activityId === "string" && Array.isArray(s.streams?.t))); break;
    case "status": {
      const s = body as any;
      const prev = (await getKv<any>(db, "sync")) ?? {};
      const datasets = { ...(prev.datasets ?? {}) };
      for (const [k, v] of Object.entries<any>(s.datasets ?? {})) datasets[k] = { lastSuccessAt: v.ok ? s.finishedAt : datasets[k]?.lastSuccessAt ?? null, note: str(v.note, 200) };
      await setKv(db, "sync", {
        lastAttemptAt: s.finishedAt ?? new Date().toISOString(),
        lastSuccessAt: s.ok ? s.finishedAt : prev.lastSuccessAt ?? null,
        lastError: s.ok ? null : str(s.error ?? "Okänt fel", 300),
        datasets,
      });
      break;
    }
    default: return c.json({ error: "Okänd typ." }, 404);
  }
  return c.json({ ok: true, count: items.length });
});

// ------------------------------------------------------------------ authenticated API

app.use("/api/*", async (c, next) => {
  if (!(await validSession(c.env.DB, readCookie(c.req.header("Cookie"))))) return c.json({ error: "Inte inloggad." }, 401);
  // CSRF defence in depth on top of SameSite=Strict: state changes need a custom header,
  // which a cross-site form cannot send.
  if (c.req.method !== "GET" && c.req.header("X-Form-Request") !== "1") return c.json({ error: "Ogiltig förfrågan." }, 403);
  await next();
});

app.get("/api/session", (c) => c.json({ authenticated: true }));

app.get("/api/data", async (c) => {
  const bundle = await loadBundle(c.env.DB, todayStockholm());
  return c.json({ ...bundle, syncButton: !!(c.env.GITHUB_TOKEN && c.env.GITHUB_REPO) });
});

app.get("/api/activities/:id/streams", async (c) => {
  const s = await getStreams(c.env.DB, id(c.req.param("id")));
  return s ? c.json(s) : c.json({ error: "Inga tidsserier för passet." }, 404);
});

app.patch("/api/activities/:id", async (c) => {
  const aid = id(c.req.param("id"));
  const body = await c.req.json<{ rpe?: unknown; note?: unknown }>();
  const row = await c.env.DB.prepare("SELECT doc FROM activities WHERE id = ?").bind(aid).first<{ doc: string }>();
  if (!row) return c.json({ error: "Passet finns inte." }, 404);
  const a = { ...(JSON.parse(row.doc) as Activity), rpe: int(body.rpe, 1, 10, "RPE"), note: str(body.note, 500) };
  await c.env.DB.prepare("UPDATE activities SET doc = ? WHERE id = ?").bind(JSON.stringify(a), aid).run();
  return c.json(a);
});

/** Manual activity, e.g. a strength session logged without the watch. */
app.post("/api/activities", async (c) => {
  const b = await c.req.json<any>();
  const d = date(b.date);
  const a: Activity = {
    id: `m-${crypto.randomUUID()}`, source: "manual", startLocal: `${d}T${/^\d{2}:\d{2}$/.test(b.time) ? b.time : "12:00"}:00`, startUtc: null, date: d,
    sport: oneOf(b.sport, ["strength", "crosstrainer", "cycling", "running", "walking", "other"] as const, "sport"), typeKey: null,
    name: str(b.name, 80), durationS: int(b.minutes, 1, 600, "minuter", false)! * 60, distanceM: null, avgHr: int(b.avgHr, 40, 230, "snittpuls"),
    maxHr: null, avgSpeed: null, avgPower: null, normPower: null, avgCadence: null, elevationGainM: null, calories: null, aerobicTe: null, anaerobicTe: null,
    zoneSeconds: null, hasStreams: false, rpe: int(b.rpe, 1, 10, "RPE"), note: str(b.note, 500),
  };
  await c.env.DB.prepare("INSERT INTO activities (id, source, date, doc, updated_at) VALUES (?, 'manual', ?, ?, ?)").bind(a.id, a.date, JSON.stringify(a), new Date().toISOString()).run();
  return c.json(a);
});

app.delete("/api/activities/:id", async (c) => {
  const aid = id(c.req.param("id"));
  if (!aid.startsWith("m-")) return c.json({ error: "Bara manuellt inlagda pass kan tas bort här. Garmin-pass tas bort i Garmin Connect." }, 400);
  await c.env.DB.prepare("DELETE FROM activities WHERE id = ?").bind(aid).run();
  return c.json({ ok: true });
});

const PAIN_AREAS: PainArea[] = ["knee", "back", "shoulder", "other"];

app.put("/api/checkins/:date", async (c) => {
  const d = date(c.req.param("date"));
  const b = await c.req.json<any>();
  const ci: CheckIn = {
    date: d, energy: int(b.energy, 1, 5, "energi"), soreness: int(b.soreness, 1, 5, "träningsvärk"), stress: int(b.stress, 1, 5, "stress"),
    pain: (int(b.pain, 0, 3, "smärta", false) ?? 0) as CheckIn["pain"],
    painAreas: Array.isArray(b.painAreas) ? b.painAreas.filter((a: unknown) => PAIN_AREAS.includes(a as PainArea)) : [],
    minutesAvailable: int(b.minutesAvailable, 0, 240, "tid"), note: str(b.note, 500), updatedAt: new Date().toISOString(),
  };
  await putDoc(c.env.DB, "checkins", d, d, ci).run();
  return c.json(ci);
});

const MODALITIES: Modality[] = ["crosstrainer", "cycling", "running", "indoor_cycling", "walking", "gym"];

app.put("/api/profile", async (c) => {
  const b = await c.req.json<any>();
  const d = defaultProfile();
  const g = b.goals ?? {};
  const p: Profile = {
    sex: oneOf(b.sex ?? d.sex, ["male", "female"] as const, "kön"),
    birthYear: int(b.birthYear ?? d.birthYear, 1920, 2015, "födelseår", false)!,
    heightCm: int(b.heightCm ?? d.heightCm, 120, 230, "längd", false)!,
    maxHr: int(b.maxHr ?? d.maxHr, 120, 230, "maxpuls", false)!,
    restingHr: int(b.restingHr ?? d.restingHr, 30, 100, "vilopuls", false)!,
    comfortableEasyHr: Array.isArray(b.comfortableEasyHr) && b.comfortableEasyHr.length === 2
      ? [int(b.comfortableEasyHr[0], 80, 200, "puls", false)!, int(b.comfortableEasyHr[1], 80, 200, "puls", false)!] : null,
    goals: {
      fatLoss: !!g.fatLoss, keepMuscle: !!g.keepMuscle, fitness: !!g.fitness,
      run5kTargetS: int(g.run5kTargetS, 600, 3600, "5 km-mål"), run10kTargetS: int(g.run10kTargetS, 1200, 7200, "10 km-mål"),
      recent5kS: int(g.recent5kS, 600, 3600, "5 km-resultat"),
      weightTargetKg: num(g.weightTargetKg, 40, 200, "viktmål"), weightTargetDate: g.weightTargetDate ? date(g.weightTargetDate, "måldatum") : null,
    },
    kneeStatus: oneOf(b.kneeStatus ?? d.kneeStatus, ["none", "sometimes", "current"] as const, "knästatus"),
    enduranceModalities: (Array.isArray(b.enduranceModalities) ? b.enduranceModalities : d.enduranceModalities).filter((m: unknown) => MODALITIES.includes(m as Modality)),
    weekAParity: b.weekAParity === 1 ? 1 : 0,
    trainingDays: (Array.isArray(b.trainingDays) ? b.trainingDays : d.trainingDays).map(Number).filter((n: number) => n >= 1 && n <= 7),
    strengthMinutes: int(b.strengthMinutes ?? d.strengthMinutes, 10, 120, "styrkepassets längd", false)!,
    easyMinutes: int(b.easyMinutes ?? d.easyMinutes, 10, 180, "konditionspassets längd", false)!,
    useStrengthLog: b.useStrengthLog !== false,
  };
  if (!p.enduranceModalities.length) throw new BadRequest("Välj minst en konditionsform.");
  await setKv(c.env.DB, "profile", p);
  return c.json(mergeProfile(p));
});

/** Plan changes are only written when the user approves them in the app. */
app.put("/api/plan", async (c) => {
  const b = await c.req.json<{ upsert?: any[]; remove?: unknown[] }>();
  const stmts: D1PreparedStatement[] = [];
  for (const raw of (b.upsert ?? []).slice(0, 60)) {
    const item: PlanItem = {
      id: raw.id ? id(raw.id) : `p-${crypto.randomUUID()}`, date: date(raw.date),
      kind: oneOf(raw.kind, ["strength", "easy", "intervals", "recovery", "rest"] as const, "passtyp"),
      modality: raw.modality == null ? null : oneOf(raw.modality, MODALITIES, "aktivitet"), templateId: str(raw.templateId, 80),
      minutes: int(raw.minutes, 0, 240, "minuter", false)!, status: oneOf(raw.status ?? "planned", ["planned", "done", "skipped"] as const, "status"),
      activityId: raw.activityId ? id(raw.activityId) : null, note: str(raw.note, 300),
    };
    stmts.push(putDoc(c.env.DB, "plan_items", item.id, item.date, item));
  }
  for (const r of (b.remove ?? []).slice(0, 60)) stmts.push(c.env.DB.prepare("DELETE FROM plan_items WHERE id = ?").bind(id(r)));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.post("/api/weights", async (c) => {
  const b = await c.req.json<any>();
  const d = date(b.date);
  const w: WeightEntry = { id: `m-${crypto.randomUUID()}`, source: "manual", measuredAt: `${d}T${/^\d{2}:\d{2}$/.test(b.time) ? b.time : "07:00"}`, date: d,
    weightKg: num(b.weightKg, 30, 250, "vikt", false)!, bodyFatPct: null, muscleMassKg: null, bodyWaterPct: null, boneMassKg: null, bmi: null };
  await c.env.DB.prepare("INSERT INTO weights (id, source, date, doc) VALUES (?, 'manual', ?, ?)").bind(w.id, d, JSON.stringify(w)).run();
  return c.json(w);
});

app.delete("/api/weights/:id", async (c) => {
  const wid = id(c.req.param("id"));
  if (!wid.startsWith("m-")) return c.json({ error: "Vägningar från Garmin tas bort i Garmin Connect." }, 400);
  await c.env.DB.prepare("DELETE FROM weights WHERE id = ?").bind(wid).run();
  return c.json({ ok: true });
});

app.post("/api/measurements", async (c) => {
  const b = await c.req.json<any>();
  const m: Measurement = { id: `m-${crypto.randomUUID()}`, date: date(b.date), kind: "waist", valueCm: num(b.valueCm, 40, 200, "midjemått", false)!, source: "manual" };
  await putDoc(c.env.DB, "measurements", m.id, m.date, m).run();
  return c.json(m);
});

app.delete("/api/measurements/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM measurements WHERE id = ?").bind(id(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** StrengthLog CSV is parsed in the browser; the server stores validated sets. */
app.post("/api/strength", async (c) => {
  const b = await c.req.json<{ sets?: any[]; source?: string }>();
  const source = b.source === "manual" ? "manual" : "strengthlog";
  const sets: StrengthSet[] = (b.sets ?? []).slice(0, 5000).map((s, i) => ({
    id: s.id ? id(s.id) : `s-${crypto.randomUUID()}`, source, date: date(s.date), sessionId: id(s.sessionId ?? `${s.date}`),
    exercise: str(s.exercise, 80, false)!, setIndex: int(s.setIndex ?? i + 1, 1, 100, "set", false)!,
    weightKg: num(s.weightKg, 0, 500, "vikt"), reps: int(s.reps, 0, 200, "repetitioner"), rpe: num(s.rpe, 1, 10, "RPE"),
  }));
  for (let i = 0; i < sets.length; i += 100) {
    await c.env.DB.batch(sets.slice(i, i + 100).map((s) => c.env.DB.prepare(
      "INSERT INTO strength_sets (id, session_id, date, doc) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc").bind(s.id, s.sessionId, s.date, JSON.stringify(s))));
  }
  return c.json({ ok: true, count: sets.length });
});

app.delete("/api/strength/:sessionId", async (c) => {
  await c.env.DB.prepare("DELETE FROM strength_sets WHERE session_id = ?").bind(id(c.req.param("sessionId"))).run();
  return c.json({ ok: true });
});

app.put("/api/zones", async (c) => {
  const b = await c.req.json<any>();
  const sport = oneOf(b.sport, ["DEFAULT", "RUNNING", "CYCLING"] as const, "sport");
  if (b.remove) {
    await c.env.DB.prepare("DELETE FROM zones WHERE key = ?").bind(`manual:${sport}`).run();
    return c.json({ ok: true });
  }
  const floors = (Array.isArray(b.floors) ? b.floors : []).map((f: unknown) => int(f, 60, 230, "zongräns", false)!);
  if (floors.length !== 5 || floors.some((f: number, i: number) => i && f <= floors[i - 1])) throw new BadRequest("Zongränserna måste vara fem stigande värden.");
  const z: HrZones = { sport, method: "CUSTOM", source: "manual", maxHr: int(b.maxHr, 120, 230, "maxpuls"), restingHr: null, thresholdHr: null, floors: floors as HrZones["floors"] };
  await c.env.DB.prepare("INSERT INTO zones (key, doc) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET doc = excluded.doc").bind(`manual:${sport}`, JSON.stringify(z)).run();
  return c.json(z);
});

app.post("/api/sync", async (c) => {
  if (!c.env.GITHUB_TOKEN || !c.env.GITHUB_REPO) return c.json({ error: "Direktsynk är inte aktiverad.", fallback: true }, 501);
  const res = await fetch(`https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/workflows/${c.env.SYNC_WORKFLOW ?? "form-sync.yml"}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "form-app", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: c.env.GITHUB_REF ?? "main" }),
  });
  if (!res.ok) return c.json({ error: `GitHub svarade ${res.status}.` }, 502);
  return c.json({ ok: true, message: "Synk startad. Det tar oftast 1–3 minuter." });
});

app.get("/api/export", async (c) => {
  c.header("Content-Disposition", `attachment; filename="form-export-${todayStockholm()}.json"`);
  return c.json({ exportedAt: new Date().toISOString(), note: "All data som FORM har sparat om dig.", data: await exportAll(c.env.DB) });
});

app.post("/api/delete-all", async (c) => {
  const b = await c.req.json<{ confirm?: string }>();
  if (b.confirm !== "RADERA") throw new BadRequest("Skriv RADERA för att bekräfta.");
  await deleteAll(c.env.DB);
  c.header("Set-Cookie", clearCookie());
  return c.json({ ok: true });
});

app.all("/api/*", (c) => c.json({ error: "Finns inte." }, 404));

// ------------------------------------------------------------------ app shell

app.all("*", async (c: C) => {
  if (!c.env.ASSETS) return c.text("Not found", 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
