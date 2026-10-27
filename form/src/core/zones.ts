import type { Activity, HrZones, Profile, Sport } from "./types";

export const METHOD_LABEL: Record<HrZones["method"], string> = {
  HR_MAX: "procent av maxpuls",
  HR_RESERVE: "procent av pulsreserv",
  LACTATE_THRESHOLD: "procent av mjölksyratröskelpuls",
  CUSTOM: "egna gränser",
};

/** Garmin's default %HRmax zone floors (50/60/70/80/90 %), used only when Garmin sends no zones. */
export function defaultZones(profile: Profile): HrZones {
  const m = profile.maxHr;
  return {
    sport: "DEFAULT", method: "HR_MAX", source: "computed", maxHr: m, restingHr: profile.restingHr, thresholdHr: null,
    floors: [0.5, 0.6, 0.7, 0.8, 0.9].map((p) => Math.round(m * p)) as HrZones["floors"],
  };
}

const ZONE_SPORT: Partial<Record<Sport, string>> = { running: "RUNNING", cycling: "CYCLING" };

/** Zones for a sport: Garmin's sport-specific zones, then Garmin default, then computed defaults. */
export function zonesFor(sport: Sport, zones: HrZones[], profile: Profile): HrZones {
  const key = ZONE_SPORT[sport];
  return zones.find((z) => z.sport === key) ?? zones.find((z) => z.sport === "DEFAULT") ?? defaultZones(profile);
}

/** 0 = below zone 1, otherwise 1-5. */
export function zoneOf(hr: number, z: HrZones): number {
  let zone = 0;
  z.floors.forEach((floor, i) => { if (hr >= floor) zone = i + 1; });
  return zone;
}

export function zoneRange(z: HrZones, zone: number): [number, number] {
  const lo = z.floors[zone - 1];
  const hi = zone < 5 ? z.floors[zone] - 1 : (z.maxHr ?? lo + 15);
  return [lo, hi];
}

export function describeZones(z: HrZones): string {
  const src = z.source === "garmin" ? "från Garmin" : z.source === "manual" ? "inställda av dig" : "uppskattade";
  return `Pulszoner ${src} (${METHOD_LABEL[z.method]}${z.maxHr ? `, maxpuls ${z.maxHr}` : ""})`;
}

/**
 * Seconds in zones 1-5. Uses zone times from the FIT file when present;
 * otherwise attributes the whole session to the zone of its average HR and says so.
 */
export function activityZones(a: Activity, zones: HrZones[], profile: Profile): { seconds: number[]; estimated: boolean } | null {
  if (a.zoneSeconds) return { seconds: a.zoneSeconds, estimated: false };
  if (!a.avgHr || !a.durationS) return null;
  const z = zonesFor(a.sport, zones, profile);
  const seconds = [0, 0, 0, 0, 0];
  const zone = Math.max(1, zoneOf(a.avgHr, z));
  seconds[zone - 1] = a.durationS;
  return { seconds, estimated: true };
}
