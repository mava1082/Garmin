// @ts-nocheck – Worker types (D1Database) are not part of the Node test config.
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createD1 } from "./d1shim";

const PASSWORD = "rätt-lösenord-123";
const INGEST = "ingest-token-abc";
let env;

beforeEach(() => { env = { DB: createD1(), APP_PASSWORD: PASSWORD, INGEST_TOKEN: INGEST }; });

const req = (path, init = {}) => app.request(path, init, env);
const json = (method, body, headers = {}) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

async function login() {
  const res = await req("/api/login", json("POST", { password: PASSWORD }));
  expect(res.status).toBe(200);
  const cookie = res.headers.get("Set-Cookie");
  return cookie.split(";")[0];
}
const authed = (cookie, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Cookie: cookie, "X-Form-Request": "1" } });
const ingest = (kind, items) => req(`/api/ingest/${kind}`, json("POST", { items }, { Authorization: `Bearer ${INGEST}` }));

const activity = (over = {}) => ({ id: "111", source: "garmin", startLocal: "2026-10-26T07:00:00", startUtc: null, date: "2026-10-26", sport: "running", typeKey: "running",
  name: "Morgonlöpning", durationS: 1800, distanceM: 5000, avgHr: 140, maxHr: 160, avgSpeed: 2.8, avgPower: null, normPower: null, avgCadence: null,
  elevationGainM: null, calories: null, aerobicTe: null, anaerobicTe: null, zoneSeconds: null, hasStreams: false, rpe: null, note: null, ...over });

describe("authentication", () => {
  it("keeps health public but everything else private", async () => {
    expect((await req("/api/health")).status).toBe(200);
    expect((await req("/api/data")).status).toBe(401);
    expect((await req("/api/export")).status).toBe(401);
  });

  it("rejects a wrong password and locks after repeated failures", async () => {
    for (let i = 0; i < 5; i++) expect((await req("/api/login", json("POST", { password: "fel" }))).status).toBe(401);
    expect((await req("/api/login", json("POST", { password: PASSWORD }))).status).toBe(429);
  });

  it("sets a secure HttpOnly session cookie", async () => {
    const res = await req("/api/login", json("POST", { password: PASSWORD }));
    const c = res.headers.get("Set-Cookie");
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Strict/);
  });

  it("never sends secrets to the browser", async () => {
    const cookie = await login();
    const body = await (await req("/api/data", authed(cookie))).text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(INGEST);
  });

  it("requires the CSRF header for changes", async () => {
    const cookie = await login();
    const res = await req("/api/checkins/2026-10-27", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("logout invalidates the session on the server", async () => {
    const cookie = await login();
    await req("/api/logout", authed(cookie, { method: "POST" }));
    expect((await req("/api/data", authed(cookie))).status).toBe(401);
  });

  it("refuses login when no password is configured", async () => {
    env.APP_PASSWORD = undefined;
    expect((await req("/api/login", json("POST", { password: "" }))).status).toBe(503);
  });
});

describe("ingest from the sync job", () => {
  it("requires the ingest token", async () => {
    expect((await req("/api/ingest/state")).status).toBe(401);
    expect((await req("/api/ingest/state", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("deduplicates and applies late corrections, keeping the user's own fields", async () => {
    await ingest("activities", [activity()]);
    const cookie = await login();
    await req("/api/activities/111", authed(cookie, json("PATCH", { rpe: 6, note: "Tungt" })));
    await ingest("activities", [activity({ name: "Morgonlöpning (redigerad)", durationS: 1750 })]);
    await ingest("activities", [activity({ name: "Morgonlöpning (redigerad)", durationS: 1750 })]);
    const data = await (await req("/api/data", authed(cookie))).json();
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0]).toMatchObject({ name: "Morgonlöpning (redigerad)", durationS: 1750, rpe: 6, note: "Tungt" });
  });

  it("tracks which days are stored and which activities lack streams", async () => {
    await ingest("activities", [activity()]);
    await ingest("wellness", [{ date: "2026-10-26", restingHr: 52, sleepS: null }]);
    const state = await (await req("/api/ingest/state", { headers: { Authorization: `Bearer ${INGEST}` } })).json();
    expect(state.completeDates).toEqual(["2026-10-26"]);
    expect(state.activitiesWithoutStreams).toEqual(["111"]);
    await ingest("streams", [{ activityId: "111", streams: { activityId: "111", t: [0, 10], hr: [120, 125], laps: [] }, zoneSeconds: [0, 10, 0, 0, 0] }]);
    const after = await (await req("/api/ingest/state", { headers: { Authorization: `Bearer ${INGEST}` } })).json();
    expect(after.activitiesWithoutStreams).toEqual([]);
  });

  it("records sync status and errors", async () => {
    await req("/api/ingest/status", json("POST", { ok: false, finishedAt: "2026-10-27T06:00:00Z", error: "Garmins skydd stoppade anropet", datasets: { activities: { ok: false, note: "x" } } }, { Authorization: `Bearer ${INGEST}` }));
    const cookie = await login();
    const data = await (await req("/api/data", authed(cookie))).json();
    expect(data.sync.lastError).toMatch(/skydd/);
    expect(data.sync.lastSuccessAt).toBeNull();
  });

  it("keeps missing values missing", async () => {
    await ingest("wellness", [{ date: "2026-10-26", source: "garmin", restingHr: null, sleepS: null, hrvLastNight: 45 }]);
    const cookie = await login();
    const data = await (await req("/api/data", authed(cookie))).json();
    expect(data.wellness[0].restingHr).toBeNull();
    expect(data.wellness[0].sleepS).toBeNull();
  });
});

describe("user data", () => {
  it("validates check-ins", async () => {
    const cookie = await login();
    expect((await req("/api/checkins/2026-10-27", authed(cookie, json("PUT", { energy: 9, pain: 0 })))).status).toBe(400);
    const ok = await req("/api/checkins/2026-10-27", authed(cookie, json("PUT", { energy: 2, soreness: 3, stress: 4, pain: 1, painAreas: ["knee", "hack"], minutesAvailable: 40 })));
    expect(ok.status).toBe(200);
    expect((await ok.json()).painAreas).toEqual(["knee"]);
  });

  it("stores approved plan changes and manual entries with their source", async () => {
    const cookie = await login();
    await req("/api/plan", authed(cookie, json("PUT", { upsert: [{ date: "2026-10-28", kind: "intervals", modality: "crosstrainer", minutes: 40 }] })));
    await req("/api/weights", authed(cookie, json("POST", { date: "2026-10-27", weightKg: 89.6 })));
    const data = await (await req("/api/data", authed(cookie))).json();
    expect(data.plan[0]).toMatchObject({ date: "2026-10-28", kind: "intervals", status: "planned" });
    expect(data.weights[0]).toMatchObject({ weightKg: 89.6, source: "manual" });
  });

  it("only allows deleting manual weights", async () => {
    await ingest("weights", [{ id: "9", date: "2026-10-20", weightKg: 90, measuredAt: "2026-10-20T07:00" }]);
    const cookie = await login();
    expect((await req("/api/weights/g-9", authed(cookie, { method: "DELETE" }))).status).toBe(400);
  });

  it("exports everything and deletes everything on explicit confirmation", async () => {
    await ingest("activities", [activity()]);
    const cookie = await login();
    const exp = await (await req("/api/export", authed(cookie))).json();
    expect(exp.data.activities).toHaveLength(1);
    expect((await req("/api/delete-all", authed(cookie, json("POST", { confirm: "ja" })))).status).toBe(400);
    expect((await req("/api/delete-all", authed(cookie, json("POST", { confirm: "RADERA" })))).status).toBe(200);
    expect((await req("/api/data", authed(cookie))).status).toBe(401);
    const cookie2 = await login();
    const data = await (await req("/api/data", authed(cookie2))).json();
    expect(data.activities).toHaveLength(0);
  });

  it("explains that one-tap sync needs configuration", async () => {
    const cookie = await login();
    const res = await req("/api/sync", authed(cookie, { method: "POST" }));
    expect(res.status).toBe(501);
    expect((await res.json()).fallback).toBe(true);
  });
});
