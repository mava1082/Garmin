import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { FitBaseType, FitEncoder } from "fit-file-parser";
import { GarminClient, GarminError } from "../src/garmin/client";
import { parseFitZip } from "../src/garmin/fit";
import { mapActivity, mapWeights, mapZones } from "../src/garmin/mapping";
import { chunks, runSync, type Ingest, type IngestState } from "../src/garmin/sync";
import { addDays, range } from "../src/core/dates";

const jwt = (expSec: number) => `x.${btoa(JSON.stringify({ exp: expSec })).replace(/=/g, "")}.y`;
const NOW = Date.UTC(2026, 9, 27, 8);

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? "GET"} ${url.pathname}`);
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const tokenOk = () => new Response(jwt(NOW / 1000 + 86400));
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

function client(handler: Handler, extra: Partial<ConstructorParameters<typeof GarminClient>[0]> = {}) {
  const { f, calls } = fakeFetch(handler);
  const sleeps: number[] = [];
  const c = new GarminClient({ apiKey: "secret-key", fetch: f, sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, minIntervalMs: 0, ...extra });
  return { c, calls, sleeps };
}

describe("Garmin client", () => {
  it("exchanges the API key for a bearer token once and reuses it", async () => {
    let auth = "";
    const { c, calls } = client((url, init) => {
      if (url.pathname.includes("/token")) { auth = (init.headers as any).Authorization; return tokenOk(); }
      return json({ ok: 1 });
    });
    await c.get("/a");
    await c.get("/b");
    expect(auth).toBe("ApiKey secret-key");
    expect(calls.filter((x) => x.includes("/token"))).toHaveLength(1);
  });

  it("waits the time Garmin asks for on 429 and then succeeds", async () => {
    let n = 0;
    const { c, sleeps } = client((url) => url.pathname.includes("/token") ? tokenOk()
      : ++n === 1 ? json({ count: 101, limit: 100, retryInSeconds: 30 }, 429) : json({ ok: 1 }));
    expect(await c.get("/x")).toEqual({ ok: 1 });
    expect(sleeps).toContain(31_000);
  });

  it("mints a new token once when Garmin rejects it with 401", async () => {
    let tokens = 0, n = 0;
    const { c } = client((url) => {
      if (url.pathname.includes("/token")) { tokens++; return tokenOk(); }
      return ++n === 1 ? new Response("", { status: 401 }) : json({ ok: 1 });
    });
    expect(await c.get("/x")).toEqual({ ok: 1 });
    expect(tokens).toBe(2);
  });

  it("reports an expired or wrong key as an auth error", async () => {
    const { c } = client(() => new Response("Unauthorized", { status: 401 }));
    await expect(c.get("/x")).rejects.toMatchObject({ kind: "auth" });
  });

  it("recognises a Cloudflare block and does not retry it", async () => {
    const { c, calls } = client(() => new Response("<html><title>Just a moment...</title>cf-ray captcha</html>", { status: 403 }));
    const err: any = await c.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(GarminError);
    expect(err.kind).toBe("blocked");
    expect(calls).toHaveLength(1);
  });

  it("never puts the key in error messages", async () => {
    const { c } = client(() => new Response("nope", { status: 400 }));
    const err: any = await c.get("/x").catch((e) => e);
    expect(String(err.message)).not.toContain("secret-key");
  });

  it("spaces requests to stay under the rate limit", async () => {
    let t = NOW;
    const { c, sleeps } = client((url) => url.pathname.includes("/token") ? tokenOk() : json({}), { minIntervalMs: 700, now: () => t });
    await c.get("/a"); await c.get("/b");
    expect(sleeps.some((s) => s > 0 && s <= 700)).toBe(true);
  });
});

describe("mapping", () => {
  it("maps a verified activity search item", () => {
    const a = mapActivity({ activityId: 123, activityName: "Crosstrainer", startTimeLocal: "2026-10-26 18:05:00", startTimeGMT: "2026-10-26 17:05:00",
      activityType: { typeKey: "elliptical" }, duration: 2700.5, distance: 0, averageHR: 134, maxHR: 151, averageSpeed: 0, calories: 410, aerobicTrainingEffect: 2.8 });
    expect(a).toMatchObject({ id: "123", date: "2026-10-26", sport: "crosstrainer", distanceM: null, avgSpeed: null, startUtc: "2026-10-26T17:05:00Z" });
  });
  it("reads Garmin's per-sport heart rate zones", () => {
    const z = mapZones([{ trainingMethod: "HR_MAX", zone1Floor: 97, zone2Floor: 116, zone3Floor: 135, zone4Floor: 154, zone5Floor: 174, maxHeartRateUsed: 193, sport: "DEFAULT" }]);
    expect(z[0]).toMatchObject({ sport: "DEFAULT", method: "HR_MAX", floors: [97, 116, 135, 154, 174], source: "garmin" });
  });
  it("parses weight in grams or kilograms", () => {
    const w = mapWeights({ dateWeightList: [{ samplePk: 1, calendarDate: "2026-10-20", weight: 89650, bodyFat: 21.5, muscleMass: 38200 }, { calendarDate: "2026-10-21", weight: 89.4 }] });
    expect(w.map((x) => x.weightKg)).toEqual([89.65, 89.4]);
    expect(w[0].muscleMassKg).toBe(38.2);
  });
});

function memoryIngest(initial: Partial<IngestState> = {}) {
  const store: Record<string, unknown[]> = { activities: [], wellness: [], weights: [], zones: [], streams: [] };
  let status: any = null;
  const ingest = {
    state: async () => ({ latestActivityDate: null, completeDates: [], activitiesWithoutStreams: [], latestWeightDate: null, ...initial }),
    push: async (kind: string, items: unknown[]) => { store[kind].push(...items); },
    status: async (s: unknown) => { status = s; },
  } as Ingest;
  return { ingest, store, getStatus: () => status };
}

const TODAY = "2026-10-27";

function garminServer(opts: { failHrvFor?: string } = {}): Handler {
  return (url) => {
    const p = url.pathname;
    if (p.includes("/token")) return tokenOk();
    if (p.includes("heartRateZones")) return json([{ trainingMethod: "HR_MAX", zone1Floor: 97, zone2Floor: 116, zone3Floor: 135, zone4Floor: 154, zone5Floor: 174, maxHeartRateUsed: 193, sport: "DEFAULT" }]);
    if (p.includes("/activities/search")) {
      const start = Number(url.searchParams.get("start"));
      const all = Array.from({ length: 130 }, (_, i) => ({ activityId: 1000 + i, activityName: "Pass", startTimeLocal: `${addDays(TODAY, -(i % 300))} 07:00:00`, activityType: { typeKey: "elliptical" }, duration: 2400, averageHR: 135 }));
      return json(all.slice(start, start + 100));
    }
    if (p.includes("dailysummaries")) {
      const days = range(url.searchParams.get("startDate")!, url.searchParams.get("endDate")!);
      return json({ data: days.map((d) => ({ calendarDate: d, heartRate: { restingValue: 54 }, movement: { steps: { value: 9000 } }, stress: { avgLevel: -1 }, bodyBattery: { minValue: 20, maxValue: 80 } })) });
    }
    if (p.includes("/hrv-service/hrv/daily/")) {
      const [lo, hi] = p.split("/").slice(-2);
      if (opts.failHrvFor && opts.failHrvFor >= lo && opts.failHrvFor <= hi) return new Response("boom", { status: 500 });
      return json({ hrvSummaries: range(lo, hi).map((d) => ({ calendarDate: d, lastNightAvg: 47, weeklyAvg: 46, baseline: { balancedLow: 40, balancedUpper: 55 }, status: "BALANCED" })) });
    }
    if (p.includes("dailySleepSummariesByDate")) {
      const days = range(url.searchParams.get("startDate")!, url.searchParams.get("endDate")!);
      return json(days.map((d) => ({ calendarDate: d, sleepTimeSeconds: 25200, sleepStartTimestampLocal: Date.parse(`${addDays(d, -1)}T23:20:00Z`), sleepEndTimestampLocal: Date.parse(`${d}T06:20:00Z`), sleepScores: { overall: { value: 77 } } })));
    }
    if (p.includes("/weight-service/")) return json({ dateWeightList: [] });
    if (p.includes("/download-service/")) return new Response("not a zip", { status: 404 });
    return json(null);
  };
}

describe("sync", () => {
  it("does a first full sync with pagination and chunked daily data", async () => {
    const { c } = client(garminServer());
    const { ingest, store, getStatus } = memoryIngest();
    const report = await runSync({ client: c, ingest, today: TODAY, maxFit: 0 });
    expect(report.error).toBeNull();
    expect(store.activities).toHaveLength(130);
    expect(store.wellness.length).toBe(401);
    const w = (store.wellness as any[]).find((x) => x.date === TODAY);
    expect(w).toMatchObject({ restingHr: 54, steps: 9000, hrvLastNight: 47, sleepS: 25200, sleepScore: 77, sleepStartLocal: `${addDays(TODAY, -1)}T23:20`, stressAvg: null });
    expect(getStatus().ok).toBe(true);
  });

  it("is incremental: only missing days and the last week are fetched again", async () => {
    const { c, calls } = client(garminServer());
    const complete = range(addDays(TODAY, -400), addDays(TODAY, -1));
    const { ingest, store } = memoryIngest({ completeDates: complete, latestActivityDate: addDays(TODAY, -2) });
    await runSync({ client: c, ingest, today: TODAY, maxFit: 0 });
    expect(store.wellness.length).toBe(7);
    expect(calls.filter((x) => x.includes("dailysummaries"))).toHaveLength(1);
  });

  it("leaves out days whose request failed so they are retried", async () => {
    const { c } = client(garminServer({ failHrvFor: addDays(TODAY, -3) }), { maxRetries: 0 });
    const { ingest, store, getStatus } = memoryIngest({ completeDates: range(addDays(TODAY, -400), addDays(TODAY, -8)) });
    await runSync({ client: c, ingest, today: TODAY, maxFit: 0 });
    expect((store.wellness as any[]).some((w) => w.date === addDays(TODAY, -3))).toBe(false);
    expect(getStatus().datasets.wellness.ok).toBe(false);
  });

  it("stops and reports clearly when Garmin blocks the network", async () => {
    const { c } = client(() => new Response("<html>cloudflare</html>", { status: 403 }));
    const { ingest, getStatus } = memoryIngest();
    const report = await runSync({ client: c, ingest, today: TODAY });
    expect(report.ok).toBe(false);
    expect(report.errorKind).toBe("blocked");
    expect(getStatus().error).toMatch(/Cloudflare/);
  });

  it("chunks dates into contiguous ranges", () => {
    expect(chunks(["2026-01-03", "2026-01-01", "2026-01-02", "2026-01-10"])).toEqual([["2026-01-01", "2026-01-03"], ["2026-01-10", "2026-01-10"]]);
    expect(chunks(range("2026-01-01", "2026-03-01")).length).toBe(3);
  });
});

describe("FIT parsing", () => {
  it("turns a FIT file into 10-second streams and time in zones", async () => {
    const enc = new FitEncoder();
    const start = new Date("2026-10-26T17:00:00Z");
    const ts = (s: number) => FitEncoder.toFitTimestamp(new Date(start.getTime() + s * 1000));
    enc.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }, { number: 4, size: 4, baseType: FitBaseType.Uint32, value: ts(0) }]);
    for (let s = 0; s < 120; s++) {
      enc.writeMessage(20, [
        { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(s) },
        { number: 3, size: 1, baseType: FitBaseType.Uint8, value: s < 60 ? 120 : 160 },
        { number: 6, size: 2, baseType: FitBaseType.Uint16, value: 3000 },
        { number: 7, size: 2, baseType: FitBaseType.Uint16, value: 180 },
      ]);
    }
    enc.writeMessage(19, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(120) },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts(0) },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 120_000 },
      { number: 15, size: 1, baseType: FitBaseType.Uint8, value: 140 },
    ]);
    const zip = zipSync({ "123_ACTIVITY.fit": enc.close() });
    const zones = { sport: "DEFAULT", method: "HR_MAX" as const, source: "garmin" as const, maxHr: 193, restingHr: null, thresholdHr: null, floors: [97, 116, 135, 154, 174] as [number, number, number, number, number] };
    const { streams, zoneSeconds } = await parseFitZip("123", zip, zones);
    expect(streams.t.length).toBe(12);
    expect(streams.hr![0]).toBe(120);
    expect(streams.hr![11]).toBe(160);
    expect(streams.speed![0]).toBeCloseTo(3, 1);
    expect(streams.power![0]).toBe(180);
    expect(streams.laps[0]).toMatchObject({ durationS: 120, avgHr: 140 });
    expect(zoneSeconds![1]).toBeGreaterThan(50);  // zone 2
    expect(zoneSeconds![3]).toBeGreaterThan(50);  // zone 4
  });
});
