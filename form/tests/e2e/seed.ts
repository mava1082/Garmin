/** Seeds a local dev server through the same ingest API the Garmin sync uses (test data only). */
import { demoBundle, demoStreams } from "../../src/core/demo";
import { todayStockholm } from "../../src/core/dates";

const base = process.env.FORM_URL ?? "http://localhost:8787";
const token = process.env.FORM_INGEST_TOKEN ?? "ingest-dev-token";
const b = demoBundle(todayStockholm());
const post = async (kind: string, body: unknown) => {
  const r = await fetch(`${base}/api/ingest/${kind}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${kind}: ${r.status} ${await r.text()}`);
};
const g = <T extends { source: string }>(x: T) => ({ ...x, source: "garmin" });
const acts = b.activities.map((a) => ({ ...g(a), id: String(9000 + b.activities.indexOf(a)), hasStreams: false }));
for (let i = 0; i < acts.length; i += 100) await post("activities", { items: acts.slice(i, i + 100) });
for (let i = 0; i < b.wellness.length; i += 100) await post("wellness", { items: b.wellness.slice(i, i + 100).map(g) });
await post("weights", { items: b.weights.map(g) });
await post("zones", { items: b.zones.map(g) });
const withStreams = acts.filter((a) => a.sport !== "strength").slice(-5);
await post("streams", { items: withStreams.map((a) => ({ activityId: a.id, streams: { ...demoStreams(a), activityId: a.id }, zoneSeconds: a.zoneSeconds })) });
await post("status", { ok: true, finishedAt: new Date().toISOString(), datasets: { activities: { ok: true, note: `${acts.length} st` }, wellness: { ok: true, note: "401 dagar" } } });
console.log(`seeded ${acts.length} activities, ${b.wellness.length} days`);
