import type { Activity, HrZones, Modality, Profile, SessionKind, Sport } from "./types";
import { activityZones } from "./zones";

const SPORT_RULES: [Sport, RegExp][] = [
  ["strength", /strength|weight|hiit|functional|yoga|pilates/],
  ["crosstrainer", /elliptical|cross_?trainer|stair/],
  ["running", /run/],
  ["cycling", /cycl|bik|ride|spin|gravel/],
  ["walking", /walk|hik/],
];

export function sportFromType(typeKey: string | null | undefined): Sport {
  const k = (typeKey ?? "").toLowerCase();
  for (const [sport, re] of SPORT_RULES) if (re.test(k)) return sport;
  return "other";
}

export const SPORT_LABEL: Record<Sport, string> = {
  strength: "Styrka", crosstrainer: "Crosstrainer", cycling: "Cykling", running: "Löpning", walking: "Promenad", other: "Övrigt",
};

export const MODALITY_LABEL: Record<Modality, string> = {
  crosstrainer: "Crosstrainer", cycling: "Cykling ute", indoor_cycling: "Inomhuscykel", running: "Löpning", walking: "Promenad", gym: "Gym",
};

export function isIndoor(a: Activity): boolean {
  return /indoor|virtual|treadmill|elliptical/.test(a.typeKey ?? "");
}

/** Comparable group: never mix sports, or indoor and outdoor of the same sport. */
export function comparableGroup(a: Activity): string {
  return `${a.sport}:${isIndoor(a) ? "inne" : "ute"}`;
}

/**
 * What kind of session an activity was. Hard = meaningful time above zone 3,
 * a high anaerobic Training Effect, or an interval name. Conservative on purpose.
 */
export function sessionKind(a: Activity, zones: HrZones[], profile: Profile): SessionKind {
  if (a.sport === "strength") return "strength";
  const name = (a.name ?? "").toLowerCase();
  if (/interval|4x4|4 ?× ?4|tempo|fartlek/.test(name)) return "intervals";
  const z = activityZones(a, zones, profile);
  if (z && !z.estimated && z.seconds[3] + z.seconds[4] >= 8 * 60) return "intervals";
  if ((a.anaerobicTe ?? 0) >= 2.0) return "intervals";
  if ((a.durationS ?? 0) < 25 * 60 && a.sport === "walking") return "recovery";
  return "easy";
}

/** Banister TRIMP from average HR; sessions without HR get a duration-based estimate. */
export function trimp(a: Activity, profile: Profile): number {
  const min = (a.durationS ?? 0) / 60;
  if (!a.avgHr || profile.maxHr <= profile.restingHr) {
    return min * (a.sport === "strength" ? 0.8 : a.sport === "walking" ? 0.4 : 1.0);
  }
  const hrr = Math.min(1, Math.max(0, (a.avgHr - profile.restingHr) / (profile.maxHr - profile.restingHr)));
  const [k, b] = profile.sex === "female" ? [0.86, 1.67] : [0.64, 1.92];
  return min * hrr * k * Math.exp(b * hrr);
}
