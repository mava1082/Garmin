/**
 * Domain model shared by the Garmin adapter, the server and the app.
 *
 * Conventions:
 * - Calendar dates are local Europe/Stockholm dates as "YYYY-MM-DD".
 * - Missing measurements are `null`, never 0.
 * - Every stored record says where it came from (`source`).
 */

export type Source = "garmin" | "manual" | "strengthlog" | "computed" | "demo";

export type Sport = "strength" | "crosstrainer" | "cycling" | "running" | "walking" | "other";

export interface Activity {
  id: string;                 // Garmin activityId, or "m-..." for manual entries
  source: Source;
  startLocal: string;         // local wall-clock time "YYYY-MM-DDTHH:MM:SS"
  startUtc: string | null;    // ISO 8601 UTC, when known
  date: string;               // local calendar date
  sport: Sport;
  typeKey: string | null;     // raw Garmin type, e.g. "indoor_cycling"
  name: string | null;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeed: number | null;    // m/s
  avgPower: number | null;    // W
  normPower: number | null;   // W
  avgCadence: number | null;
  elevationGainM: number | null;
  calories: number | null;
  aerobicTe: number | null;   // Garmin Training Effect
  anaerobicTe: number | null;
  /** Seconds per HR zone 1-5 computed from the FIT file with the user's zones, if available. */
  zoneSeconds: number[] | null;
  hasStreams: boolean;
  rpe: number | null;         // user's own rating, 1-10
  note: string | null;
}

export interface ActivityStreams {
  activityId: string;
  /** Seconds since start, one sample per `step` seconds. */
  t: number[];
  hr?: (number | null)[];
  speed?: (number | null)[];   // m/s
  power?: (number | null)[];
  cadence?: (number | null)[];
  altitude?: (number | null)[];
  laps: Lap[];
}

export interface Lap {
  index: number;
  startS: number;
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeed: number | null;
  avgPower: number | null;
  avgCadence: number | null;
}

export interface DailyWellness {
  date: string;
  source: Source;
  restingHr: number | null;
  hrvLastNight: number | null;      // ms (Garmin overnight average)
  hrvWeeklyAvg: number | null;
  hrvBaselineLow: number | null;    // Garmin's own "balanced" range
  hrvBaselineHigh: number | null;
  hrvStatus: string | null;         // Garmin label, e.g. BALANCED
  sleepS: number | null;
  sleepScore: number | null;
  sleepStartLocal: string | null;   // "YYYY-MM-DDTHH:MM" (may be the evening before `date`)
  sleepEndLocal: string | null;
  deepS: number | null;
  lightS: number | null;
  remS: number | null;
  awakeS: number | null;
  stressAvg: number | null;
  bodyBatteryMin: number | null;
  bodyBatteryMax: number | null;
  steps: number | null;
}

export interface WeightEntry {
  id: string;
  source: Source;
  measuredAt: string;               // local "YYYY-MM-DDTHH:MM"
  date: string;
  weightKg: number;
  bodyFatPct: number | null;        // scale estimate (bioimpedance)
  muscleMassKg: number | null;      // scale estimate
  bodyWaterPct: number | null;
  boneMassKg: number | null;
  bmi: number | null;
}

export interface Measurement {
  id: string;
  date: string;
  kind: "waist";
  valueCm: number;
  source: Source;
}

export type PainLevel = 0 | 1 | 2 | 3;    // ingen, lätt, måttlig, kraftig
export type PainArea = "knee" | "back" | "shoulder" | "other";

export interface CheckIn {
  date: string;
  energy: number | null;        // 1 (mycket låg) - 5 (mycket hög)
  soreness: number | null;      // 1 (ingen) - 5 (kraftig)
  stress: number | null;        // 1 (låg) - 5 (hög)
  pain: PainLevel;
  painAreas: PainArea[];
  minutesAvailable: number | null;
  note: string | null;
  updatedAt: string;
}

export type SessionKind = "strength" | "easy" | "intervals" | "recovery" | "rest";
export type Modality = "crosstrainer" | "cycling" | "running" | "indoor_cycling" | "walking" | "gym";

export interface PlanItem {
  id: string;
  date: string;
  kind: SessionKind;
  modality: Modality | null;
  templateId: string | null;
  minutes: number;
  status: "planned" | "done" | "skipped";
  activityId: string | null;   // matched Garmin activity, when done
  note: string | null;
}

export interface StrengthSet {
  id: string;
  source: Source;
  date: string;
  sessionId: string;
  exercise: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  /** Session info from the StrengthLog export, repeated on each set. */
  sessionName?: string | null;
  sessionStart?: string | null;      // local "YYYY-MM-DDTHH:MM"
  sessionDurationS?: number | null;
}

export interface HrZones {
  sport: string;                    // "DEFAULT", "RUNNING", "CYCLING", ...
  method: "HR_MAX" | "HR_RESERVE" | "LACTATE_THRESHOLD" | "CUSTOM";
  source: Source;
  maxHr: number | null;
  restingHr: number | null;
  thresholdHr: number | null;
  /** Lower bound (bpm) of zones 1-5. */
  floors: [number, number, number, number, number];
}

export type KneeStatus = "none" | "sometimes" | "current";

export interface Profile {
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  maxHr: number;
  restingHr: number;
  /** HR the user reports as comfortable for easy aerobic work (self-reported, not a zone). */
  comfortableEasyHr: [number, number] | null;
  goals: {
    fatLoss: boolean;
    keepMuscle: boolean;
    fitness: boolean;
    run5kTargetS: number | null;
    run10kTargetS: number | null;
    recent5kS: number | null;
    weightTargetKg: number | null;
    weightTargetDate: string | null;
  };
  kneeStatus: KneeStatus;
  enduranceModalities: Modality[];  // in order of preference
  /** ISO week parity that is "vecka A" (3 kondition + 2 styrka). */
  weekAParity: 0 | 1;
  trainingDays: number[];           // 1 = måndag ... 7 = söndag
  strengthMinutes: number;
  easyMinutes: number;
  useStrengthLog: boolean;
}

export interface SyncStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  datasets: Record<string, { lastSuccessAt: string | null; note: string | null }>;
}

/** Everything the app needs to render; produced by the server or by demo mode. */
export interface DataBundle {
  mode: "real" | "demo";
  generatedAt: string;
  today: string;
  profile: Profile;
  activities: Activity[];
  wellness: DailyWellness[];
  weights: WeightEntry[];
  measurements: Measurement[];
  checkins: CheckIn[];
  plan: PlanItem[];
  strength: StrengthSet[];
  zones: HrZones[];
  sync: SyncStatus;
}
