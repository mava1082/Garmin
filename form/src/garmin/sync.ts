/**
 * Incremental Garmin → FORM sync. Pull only (the Personal API has no webhooks).
 *
 * - Activities: re-reads from 7 days before the latest stored activity, so late
 *   edits in Garmin Connect (renamed, trimmed, deleted samples) replace the old copy.
 * - Daily data: every missing day plus the last 7 days on each run.
 * - FIT time series: downloaded once per activity, a few per run.
 * - A day whose request failed is not stored, so the next run retries it.
 */
import { addDays, range } from "../core/dates";
import type { Activity, ActivityStreams, DailyWellness, HrZones, WeightEntry } from "../core/types";
import { zonesFor } from "../core/zones";
import { defaultProfile } from "../core/profile";
import { GarminClient, GarminError } from "./client";
import { parseFitZip } from "./fit";
import { applyDailySummaries, applyHrv, applySleep, emptyWellness, mapActivity, mapWeights, mapZones } from "./mapping";

export interface IngestState {
  latestActivityDate: string | null;
  completeDates: string[];
  activitiesWithoutStreams: string[];
  latestWeightDate: string | null;
}

export interface Ingest {
  state(): Promise<IngestState>;
  push(kind: "activities", items: Activity[]): Promise<void>;
  push(kind: "wellness", items: DailyWellness[]): Promise<void>;
  push(kind: "weights", items: WeightEntry[]): Promise<void>;
  push(kind: "zones", items: HrZones[]): Promise<void>;
  push(kind: "streams", items: { activityId: string; streams: ActivityStreams; zoneSeconds: number[] | null }[]): Promise<void>;
  status(s: SyncReport): Promise<void>;
}

export interface SyncReport {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  requests: number;
  counts: Record<string, number>;
  datasets: Record<string, { ok: boolean; note: string | null }>;
  error: string | null;
  errorKind: string | null;
}

const CHUNK = 28;
const HISTORY_DAYS = 400;
const REFRESH_DAYS = 7;

export async function runSync(opts: { client: GarminClient; ingest: Ingest; today: string; log?: (m: string) => void; maxFit?: number }): Promise<SyncReport> {
  const { client, ingest, today } = opts;
  const log = opts.log ?? (() => {});
  const report: SyncReport = { ok: true, startedAt: new Date().toISOString(), finishedAt: "", requests: 0, counts: {}, datasets: {}, error: null, errorKind: null };
  const note = (k: string, ok: boolean, n: string | null = null) => { report.datasets[k] = { ok, note: n }; if (!ok) report.ok = false; };

  try {
    const state = await ingest.state();
    const first = addDays(today, -HISTORY_DAYS);

    // Zones first: they are needed to compute time in zones from FIT files.
    let zones: HrZones[] = [];
    try {
      zones = mapZones(await client.get("/biometric-service/heartRateZones/v2"));
      await ingest.push("zones", zones);
      note("zones", true, `${zones.length} uppsättningar`);
    } catch (e) { if (fatal(e)) throw e; note("zones", false, msg(e)); }

    // Activities.
    const actFrom = state.latestActivityDate ? addDays(state.latestActivityDate, -REFRESH_DAYS) : first;
    const activities: Activity[] = [];
    for (let start = 0; start < 5000; start += 100) {
      const page = await client.get<any[]>("/activitylist-service/activities/search/activities", { start, limit: 100, startDate: actFrom, endDate: today });
      const items = (page ?? []).filter((a) => a?.activityId);
      activities.push(...items.map(mapActivity));
      if (items.length < 100) break;
    }
    await ingest.push("activities", activities);
    report.counts.activities = activities.length;
    note("activities", true, `${activities.length} från ${actFrom}`);
    log(`Aktiviteter: ${activities.length}`);

    // Daily wellness.
    const complete = new Set(state.completeDates);
    const recent = new Set(range(addDays(today, -REFRESH_DAYS + 1), today));
    const todo = range(first, today).filter((d) => !complete.has(d) || recent.has(d));
    const rows: DailyWellness[] = [];
    let failedDays = 0;
    for (const [lo, hi] of chunks(todo)) {
      const map = new Map(range(lo, hi).map((d) => [d, emptyWellness(d)]));
      let failed = false;
      for (const [label, path, params, apply] of [
        ["dagssammanfattning", "/usersummary-service/v2/dailysummaries", { startDate: lo, endDate: hi }, applyDailySummaries],
        ["HRV", `/hrv-service/hrv/daily/${lo}/${hi}`, undefined, applyHrv],
        ["sömn", "/sleep-service/sleep/dailySleepSummariesByDate", { startDate: lo, endDate: hi }, applySleep],
      ] as const) {
        try { apply(map, await client.get(path, params as Record<string, string> | undefined)); }
        catch (e) { if (fatal(e)) throw e; failed = true; log(`${label} ${lo}–${hi}: ${msg(e)}`); }
      }
      if (failed) { failedDays += map.size; continue; }
      rows.push(...map.values());
    }
    for (let i = 0; i < rows.length; i += 60) await ingest.push("wellness", rows.slice(i, i + 60));
    report.counts.wellness = rows.length;
    note("wellness", failedDays === 0, failedDays ? `${failedDays} dagar misslyckades och försöks igen nästa gång` : `${rows.length} dagar`);

    // Weight (Index S2).
    try {
      const wFrom = state.latestWeightDate ? addDays(state.latestWeightDate, -REFRESH_DAYS) : first;
      const weights: WeightEntry[] = [];
      for (const [lo, hi] of chunks(range(wFrom, today))) {
        weights.push(...mapWeights(await client.get(`/weight-service/weight/range/${lo}/${hi}`, { includeAll: "true" })));
      }
      await ingest.push("weights", weights);
      report.counts.weights = weights.length;
      note("weights", true, `${weights.length} vägningar`);
    } catch (e) { if (fatal(e)) throw e; note("weights", false, msg(e)); }

    // FIT time series for activities that don't have them yet.
    const profile = defaultProfile();
    const need = [...new Set([...state.activitiesWithoutStreams, ...activities.filter((a) => !a.hasStreams).map((a) => a.id)])]
      .filter((id) => /^\d+$/.test(id)).slice(0, opts.maxFit ?? 25);
    let fitOk = 0, fitFail = 0;
    for (const id of need) {
      try {
        const zip = await client.getBytes(`/download-service/files/activity/${id}`);
        const sport = activities.find((a) => a.id === id)?.sport ?? "other";
        const parsed = await parseFitZip(id, zip, zones.length ? zonesFor(sport, zones, profile) : null);
        await ingest.push("streams", [{ activityId: id, ...parsed }]);
        fitOk++;
      } catch (e) { if (fatal(e)) throw e; fitFail++; log(`FIT ${id}: ${msg(e)}`); }
    }
    report.counts.streams = fitOk;
    note("streams", fitFail === 0, need.length ? `${fitOk} av ${need.length} FIT-filer` : "inga nya");
  } catch (e) {
    report.ok = false;
    report.error = msg(e);
    report.errorKind = e instanceof GarminError ? e.kind : "internal";
  }
  report.requests = client.requests;
  report.finishedAt = new Date().toISOString();
  await ingest.status(report).catch(() => {});
  return report;
}

/** Stops the whole run: retrying other endpoints would not help. */
function fatal(e: unknown) {
  return e instanceof GarminError && (e.kind === "auth" || e.kind === "blocked" || e.kind === "config");
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Contiguous date ranges of at most CHUNK days. */
export function chunks(days: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const d of [...days].sort()) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d && range(last[0], d).length <= CHUNK) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}
