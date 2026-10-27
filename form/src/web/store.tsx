import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";
import { todayStockholm } from "../core/dates";
import { demoBundle, demoStreams } from "../core/demo";
import { strengthActivities } from "../core/strength";
import type { Activity, ActivityStreams, CheckIn, DataBundle, HrZones, Measurement, PlanItem, Profile, StrengthSet, WeightEntry } from "../core/types";

export type Bundle = DataBundle & { syncButton?: boolean };

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init, credentials: "same-origin",
    headers: { "X-Form-Request": "1", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Fel ${res.status}`, res.status);
  return body as T;
}

interface Store {
  status: "loading" | "login" | "ready" | "error";
  bundle: Bundle | null;
  error: string | null;
  refreshing: boolean;
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  enterDemo(): void;
  refresh(): Promise<void>;
  saveCheckin(c: CheckIn): Promise<void>;
  saveProfile(p: Profile): Promise<void>;
  savePlan(upsert: Partial<PlanItem>[], remove?: string[]): Promise<void>;
  addWeight(date: string, kg: number): Promise<void>;
  deleteWeight(id: string): Promise<void>;
  addMeasurement(date: string, cm: number): Promise<void>;
  deleteMeasurement(id: string): Promise<void>;
  importStrength(sets: Omit<StrengthSet, "source">[], onProgress?: (done: number) => void): Promise<number>;
  patchActivity(id: string, patch: { rpe: number | null; note: string | null }): Promise<void>;
  addActivity(a: { date: string; sport: Activity["sport"]; minutes: number; name: string; rpe: number | null }): Promise<void>;
  saveZones(z: { sport: string; floors?: number[]; maxHr?: number | null; remove?: boolean }): Promise<void>;
  streams(id: string): Promise<ActivityStreams | null>;
  syncNow(): Promise<{ ok: boolean; message: string; fallback?: boolean }>;
  deleteAll(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("Store saknas");
  return s;
}

export function useBundle(): Bundle {
  return useStore().bundle!;
}

/** StrengthLog sessions count as training too (derived on the fly, never stored as activities). */
function withStrengthSessions(b: Bundle): Bundle {
  const own = b.activities.filter((a) => a.source !== "strengthlog");
  return { ...b, activities: [...own, ...strengthActivities(b.strength, own)].sort((x, y) => x.startLocal.localeCompare(y.startLocal)) };
}

const uid = () => `l-${Math.random().toString(36).slice(2, 10)}`;

export function StoreProvider({ children }: { children: ComponentChildren }) {
  const [status, setStatus] = useState<Store["status"]>("loading");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const demo = bundle?.mode === "demo";

  const load = useCallback(async () => {
    try {
      const b = await api<Bundle>("/api/data");
      setBundle(withStrengthSessions({ ...b, today: todayStockholm() }));
      setStatus("ready");
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBundle(null); setStatus("login"); return; }
      setError(e instanceof Error ? e.message : "Kunde inte hämta data.");
      setStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Re-fetch when the app comes back to the foreground (iOS does not sync PWAs in the background).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && status === "ready" && !demo) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status, demo, load]);

  const local = (fn: (b: Bundle) => Bundle) => setBundle((b) => (b ? withStrengthSessions(fn(b)) : b));

  const store: Store = useMemo(() => ({
    status, bundle, error, refreshing,
    async login(password) {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      setStatus("loading");
      await load();
    },
    async logout() {
      if (!demo) await api("/api/logout", { method: "POST" }).catch(() => {});
      setBundle(null);
      setStatus("login");
      // Nothing health-related is cached by the service worker, but clear any runtime caches anyway.
      if ("caches" in window) (await caches.keys()).filter((k) => !k.startsWith("form-shell")).forEach((k) => caches.delete(k));
    },
    enterDemo() { setBundle(demoBundle(todayStockholm())); setStatus("ready"); },
    async refresh() {
      if (demo) return;
      setRefreshing(true);
      try { await load(); } finally { setRefreshing(false); }
    },
    async saveCheckin(c) {
      if (!demo) await api(`/api/checkins/${c.date}`, { method: "PUT", body: JSON.stringify(c) });
      local((b) => ({ ...b, checkins: [...b.checkins.filter((x) => x.date !== c.date), c] }));
    },
    async saveProfile(p) {
      const saved = demo ? p : await api<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(p) });
      local((b) => ({ ...b, profile: saved }));
    },
    async savePlan(upsert, remove = []) {
      const items = upsert.map((u) => ({ status: "planned", activityId: null, note: null, templateId: null, ...u, id: u.id ?? uid() })) as PlanItem[];
      if (!demo) { await api("/api/plan", { method: "PUT", body: JSON.stringify({ upsert: items, remove }) }); await load(); return; }
      local((b) => ({ ...b, plan: [...b.plan.filter((p) => !remove.includes(p.id) && !items.some((i) => i.id === p.id)), ...items] }));
    },
    async addWeight(date, kg) {
      const w: WeightEntry = demo ? { id: uid(), source: "demo", measuredAt: `${date}T07:00`, date, weightKg: kg, bodyFatPct: null, muscleMassKg: null, bodyWaterPct: null, boneMassKg: null, bmi: null }
        : await api("/api/weights", { method: "POST", body: JSON.stringify({ date, weightKg: kg }) });
      local((b) => ({ ...b, weights: [...b.weights, w] }));
    },
    async deleteWeight(id) {
      if (!demo) await api(`/api/weights/${id}`, { method: "DELETE" });
      local((b) => ({ ...b, weights: b.weights.filter((w) => w.id !== id) }));
    },
    async addMeasurement(date, cm) {
      const m: Measurement = demo ? { id: uid(), date, kind: "waist", valueCm: cm, source: "demo" } : await api("/api/measurements", { method: "POST", body: JSON.stringify({ date, valueCm: cm }) });
      local((b) => ({ ...b, measurements: [...b.measurements, m] }));
    },
    async deleteMeasurement(id) {
      if (!demo) await api(`/api/measurements/${id}`, { method: "DELETE" });
      local((b) => ({ ...b, measurements: b.measurements.filter((m) => m.id !== id) }));
    },
    async importStrength(sets, onProgress) {
      if (!demo) {
        let n = 0;
        for (let i = 0; i < sets.length; i += 500) {
          const r = await api<{ count: number }>("/api/strength", { method: "POST", body: JSON.stringify({ sets: sets.slice(i, i + 500), source: "strengthlog" }) });
          n += r.count;
          onProgress?.(n);
        }
        await load();
        return n;
      }
      local((b) => ({ ...b, strength: [...b.strength.filter((x) => !sets.some((s) => s.id === x.id)), ...sets.map((s) => ({ ...s, source: "demo" as const }))] }));
      return sets.length;
    },
    async patchActivity(id, patch) {
      if (!demo) await api(`/api/activities/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      local((b) => ({ ...b, activities: b.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    },
    async addActivity(x) {
      if (!demo) { await api("/api/activities", { method: "POST", body: JSON.stringify(x) }); await load(); return; }
      local((b) => ({ ...b, activities: [...b.activities, { id: uid(), source: "demo", startLocal: `${x.date}T12:00:00`, startUtc: null, date: x.date, sport: x.sport, typeKey: null, name: x.name,
        durationS: x.minutes * 60, distanceM: null, avgHr: null, maxHr: null, avgSpeed: null, avgPower: null, normPower: null, avgCadence: null, elevationGainM: null, calories: null,
        aerobicTe: null, anaerobicTe: null, zoneSeconds: null, hasStreams: false, rpe: x.rpe, note: null }] }));
    },
    async saveZones(z) {
      if (!demo) { await api("/api/zones", { method: "PUT", body: JSON.stringify(z) }); await load(); return; }
      local((b) => ({ ...b, zones: z.remove ? b.zones.filter((x) => !(x.sport === z.sport && x.source === "manual"))
        : [...b.zones.filter((x) => x.sport !== z.sport), { sport: z.sport, method: "CUSTOM", source: "manual", maxHr: z.maxHr ?? null, restingHr: null, thresholdHr: null, floors: z.floors as HrZones["floors"] }] }));
    },
    async streams(id) {
      if (demo) { const a = bundle?.activities.find((x) => x.id === id); return a?.hasStreams ? demoStreams(a) : null; }
      try { return await api<ActivityStreams>(`/api/activities/${id}/streams`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
    async syncNow() {
      if (demo) return { ok: true, message: "Demoläge – inget att synka." };
      try { const r = await api<{ message: string }>("/api/sync", { method: "POST" }); return { ok: true, message: r.message }; }
      catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Kunde inte starta synk.", fallback: e instanceof ApiError && e.status === 501 }; }
    },
    async deleteAll() {
      await api("/api/delete-all", { method: "POST", body: JSON.stringify({ confirm: "RADERA" }) });
      setBundle(null); setStatus("login");
    },
  }), [status, bundle, error, refreshing, demo, load]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
