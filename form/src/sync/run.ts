/**
 * Runs the Garmin sync and sends the result to the FORM server.
 * Used by GitHub Actions (.github/workflows/form-sync.yml).
 *
 *   GARMIN_PERSONAL_API_KEY  Personal API key (GitHub secret)
 *   FORM_URL                 e.g. https://form.<namn>.workers.dev
 *   FORM_INGEST_TOKEN        shared secret for /api/ingest
 *
 *   npx tsx src/sync/run.ts            sync
 *   npx tsx src/sync/run.ts --probe    print response *structure* only (no values)
 */
import { todayStockholm, addDays } from "../core/dates";
import { GarminClient } from "../garmin/client";
import { shape } from "../garmin/mapping";
import { runSync, type Ingest } from "../garmin/sync";

const env = (k: string) => process.env[k]?.trim() ?? "";

function httpIngest(base: string, token: string): Ingest {
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`FORM-servern svarade ${res.status} på ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return {
    state: () => call("/api/ingest/state"),
    push: (kind: string, items: unknown[]) => call(`/api/ingest/${kind}`, { method: "POST", body: JSON.stringify({ items }) }),
    status: (s) => call("/api/ingest/status", { method: "POST", body: JSON.stringify(s) }),
  } as Ingest;
}

async function probe(client: GarminClient) {
  const today = todayStockholm();
  const from = addDays(today, -6);
  const checks: [string, () => Promise<unknown>][] = [
    ["profil", () => client.get("/userprofile-service/userprofile/settings")],
    ["vikt (Index S2)", () => client.get(`/weight-service/weight/range/${addDays(today, -60)}/${today}`, { includeAll: "true" })],
    ["body battery", () => client.get("/wellness-service/wellness/bodyBattery/reports/daily", { startDate: from, endDate: today })],
    ["aktiviteter", () => client.get("/activitylist-service/activities/search/activities", { start: 0, limit: 1 })],
  ];
  for (const [name, fn] of checks) {
    try { console.log(`\n== ${name}\n${JSON.stringify(shape(await fn()), null, 1).slice(0, 3000)}`); }
    catch (e) { console.log(`\n== ${name}\nFEL: ${(e as Error).message}`); }
  }
  try {
    const list = await client.get<any[]>("/activitylist-service/activities/search/activities", { start: 0, limit: 1 });
    const id = list?.[0]?.activityId;
    if (id) {
      console.log(`\n== aktivitetsdetalj\n${JSON.stringify(shape(await client.get(`/activity-service/activity/${id}`)), null, 1).slice(0, 3000)}`);
      const zip = await client.getBytes(`/download-service/files/activity/${id}`);
      console.log(`\n== FIT-nedladdning: ${zip.byteLength} byte (ZIP)`);
    }
  } catch (e) { console.log(`aktivitetsdetalj/FIT: FEL: ${(e as Error).message}`); }
  console.log(`\n${client.requests} anrop.`);
}

async function main() {
  const client = new GarminClient({ apiKey: env("GARMIN_PERSONAL_API_KEY"), log: (m) => console.log(m) });
  if (process.argv.includes("--probe")) return probe(client);
  const base = env("FORM_URL").replace(/\/$/, "");
  const token = env("FORM_INGEST_TOKEN");
  if (!base || !token) throw new Error("FORM_URL och FORM_INGEST_TOKEN måste vara satta.");
  const report = await runSync({ client, ingest: httpIngest(base, token), today: todayStockholm(), log: (m) => console.log(m) });
  console.log(JSON.stringify({ ok: report.ok, counts: report.counts, requests: report.requests, error: report.error, datasets: report.datasets }, null, 1));
  if (!report.ok && report.errorKind) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
