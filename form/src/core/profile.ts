import type { Profile } from "./types";

/** Starting values from the user's own description. All of them are editable in Inställningar. */
export function defaultProfile(): Profile {
  return {
    sex: "male",
    birthYear: 1989,
    heightCm: 187,
    maxHr: 193,
    restingHr: 55,
    comfortableEasyHr: [135, 140],
    goals: {
      fatLoss: true, keepMuscle: true, fitness: true,
      run5kTargetS: 20 * 60, run10kTargetS: 40 * 60, recent5kS: 23 * 60 + 50,
      weightTargetKg: null, weightTargetDate: null,
    },
    kneeStatus: "sometimes",
    enduranceModalities: ["crosstrainer", "cycling", "running", "indoor_cycling"],
    weekAParity: 0,
    trainingDays: [1, 2, 3, 4, 5],
    strengthMinutes: 40,
    easyMinutes: 45,
    useStrengthLog: true,
  };
}

export function mergeProfile(stored: Partial<Profile> | null | undefined): Profile {
  const d = defaultProfile();
  if (!stored) return d;
  return { ...d, ...stored, goals: { ...d.goals, ...(stored.goals ?? {}) } };
}
