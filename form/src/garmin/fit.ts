/**
 * Activity time series from the original FIT file
 * (download-service/files/activity/{id}, returned as a ZIP).
 */
import { unzipSync } from "fflate";
import FitParser from "fit-file-parser";
import type { ActivityStreams, HrZones, Lap } from "../core/types";
import { zoneOf } from "../core/zones";

const STEP_S = 10;

export async function parseFitZip(activityId: string, zip: Uint8Array, zones: HrZones | null): Promise<{ streams: ActivityStreams; zoneSeconds: number[] | null }> {
  const files = unzipSync(zip);
  const fitName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".fit"));
  if (!fitName) throw new Error("ZIP-filen innehöll ingen FIT-fil.");
  return parseFit(activityId, files[fitName], zones);
}

export async function parseFit(activityId: string, fit: Uint8Array, zones: HrZones | null) {
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m", elapsedRecordField: true, mode: "list" });
  const data: any = await parser.parseAsync(Buffer.from(fit.buffer, fit.byteOffset, fit.byteLength) as Buffer<ArrayBuffer>);
  const records: any[] = data.records ?? [];
  const t0 = records.length ? new Date(records[0].timestamp).getTime() : 0;

  // Downsample to STEP_S buckets (mean of samples), keeping gaps as null.
  const buckets = new Map<number, { hr: number[]; speed: number[]; power: number[]; cadence: number[]; alt: number[] }>();
  const zoneSeconds = [0, 0, 0, 0, 0];
  let prevT: number | null = null;
  let anyHr = false;
  for (const r of records) {
    const s = (new Date(r.timestamp).getTime() - t0) / 1000;
    if (!Number.isFinite(s)) continue;
    const b = Math.floor(s / STEP_S) * STEP_S;
    const e = buckets.get(b) ?? { hr: [], speed: [], power: [], cadence: [], alt: [] };
    const push = (arr: number[], v: unknown) => { if (typeof v === "number" && Number.isFinite(v)) arr.push(v); };
    push(e.hr, r.heart_rate); push(e.speed, r.enhanced_speed ?? r.speed); push(e.power, r.power);
    push(e.cadence, r.cadence); push(e.alt, r.enhanced_altitude ?? r.altitude);
    buckets.set(b, e);
    if (zones && typeof r.heart_rate === "number" && prevT != null) {
      const dt = Math.min(10, Math.max(0, s - prevT));
      const z = zoneOf(r.heart_rate, zones);
      if (z > 0) zoneSeconds[z - 1] += dt;
      anyHr = true;
    }
    prevT = s;
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
  const series = (k: "hr" | "speed" | "power" | "cadence" | "alt") => {
    const s = keys.map((t) => avg(buckets.get(t)![k]));
    return s.some((v) => v != null) ? s : undefined;
  };
  const laps: Lap[] = (data.laps ?? []).map((l: any, i: number) => ({
    index: i + 1,
    startS: Math.max(0, Math.round((new Date(l.start_time).getTime() - t0) / 1000)),
    durationS: Math.round(l.total_timer_time ?? l.total_elapsed_time ?? 0),
    distanceM: numOrNull(l.total_distance),
    avgHr: numOrNull(l.avg_heart_rate), maxHr: numOrNull(l.max_heart_rate),
    avgSpeed: numOrNull(l.enhanced_avg_speed ?? l.avg_speed), avgPower: numOrNull(l.avg_power), avgCadence: numOrNull(l.avg_cadence),
  }));
  return {
    streams: { activityId, t: keys, hr: series("hr"), speed: series("speed"), power: series("power"), cadence: series("cadence"), altitude: series("alt"), laps },
    zoneSeconds: anyHr ? zoneSeconds.map(Math.round) : null,
  };
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
