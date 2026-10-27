import { addDays, formatDay, formatDuration } from "./dates";
import { loadRatio, loadSeries } from "./load";
import { mean, median, round, sd } from "./stats";
import type { Activity, CheckIn, DailyWellness, Profile, Source } from "./types";

export type SignalState = "ok" | "watch" | "strain" | "unknown";
export type RecoveryCategory = "ready" | "normal" | "easy" | "recover";

export interface Signal {
  key: "hrv" | "rhr" | "sleep" | "load" | "energy" | "soreness" | "stress" | "pain";
  label: string;
  state: SignalState;
  observation: string;       // what was measured, with value and date
  interpretation: string;    // what the app makes of it
  source: Source;
  subjective: boolean;
}

export interface RecoveryAssessment {
  category: RecoveryCategory;
  title: string;
  summary: string;
  confidence: "hög" | "medel" | "låg";
  signals: Signal[];
  disclaimer: string;
}

export const CATEGORY_TITLE: Record<RecoveryCategory, string> = {
  ready: "Redo för belastning",
  normal: "En vanlig dag",
  easy: "Ta det lugnare idag",
  recover: "Prioritera återhämtning",
};

export const DISCLAIMER =
  "Appens egen uppskattning utifrån dina data och din check-in. Det är inte Garmins Training Readiness och inte ett medicinskt validerat mått.";

function latest(wellness: DailyWellness[], today: string, pick: (w: DailyWellness) => number | null, maxAgeDays = 1) {
  const oldest = addDays(today, -maxAgeDays);
  for (let i = wellness.length - 1; i >= 0; i--) {
    const w = wellness[i];
    if (w.date > today) continue;
    if (w.date < oldest) return null;
    const v = pick(w);
    if (v != null) return { value: v, date: w.date, row: w };
  }
  return null;
}

function hrvSignal(wellness: DailyWellness[], today: string): Signal {
  const base: Omit<Signal, "state" | "observation" | "interpretation"> = { key: "hrv", label: "HRV", source: "garmin", subjective: false };
  const last = latest(wellness, today, (w) => w.hrvLastNight);
  if (!last) return { ...base, state: "unknown", observation: "Ingen HRV-mätning från i natt.", interpretation: "Bedömningen görs utan HRV." };
  const week = wellness.filter((w) => w.date > addDays(today, -7) && w.date <= today).map((w) => w.hrvLastNight);
  const week7 = mean(week);
  // Normal range: Garmin's own baseline when available, otherwise mean ± 1 SD of the 60 days before this week.
  let lo = last.row.hrvBaselineLow, hi = last.row.hrvBaselineHigh, rangeSource = "Garmins baslinje";
  if (lo == null || hi == null) {
    const hist = wellness.filter((w) => w.date <= addDays(today, -7) && w.date > addDays(today, -67)).map((w) => w.hrvLastNight);
    const m = mean(hist), s = sd(hist);
    if (m == null || s == null || hist.filter((v) => v != null).length < 14) {
      return { ...base, state: "unknown", observation: `HRV i natt ${last.value} ms (${formatDay(last.date)}).`,
        interpretation: "För kort historik för att veta vad som är normalt för dig (behöver minst två veckor)." };
    }
    lo = Math.round(m - s); hi = Math.round(m + s); rangeSource = "ditt eget 60-dagarsintervall";
  }
  const obs = `HRV i natt ${last.value} ms, 7-dagarssnitt ${round(week7) ?? "–"} ms. Normalt för dig: ${lo}–${hi} ms (${rangeSource}).`;
  const weekLow = week7 != null && week7 < lo;
  const nightLow = last.value < lo;
  if (weekLow && nightLow) return { ...base, state: "strain", observation: obs, interpretation: "Både natten och veckosnittet ligger under ditt normala intervall. Det brukar samvariera med trötthet, stress eller begynnande sjukdom." };
  if (weekLow || nightLow) return { ...base, state: "watch", observation: obs, interpretation: nightLow ? "En enskild låg natt. Säger lite i sig, men värt att väga in." : "Veckosnittet har sjunkit under ditt normala intervall." };
  return { ...base, state: "ok", observation: obs, interpretation: "Inom ditt normala intervall." };
}

function rhrSignal(wellness: DailyWellness[], today: string): Signal {
  const base = { key: "rhr" as const, label: "Vilopuls", source: "garmin" as Source, subjective: false };
  const last = latest(wellness, today, (w) => w.restingHr);
  if (!last) return { ...base, state: "unknown", observation: "Ingen vilopuls för i dag eller i går.", interpretation: "Bedömningen görs utan vilopuls." };
  const hist = wellness.filter((w) => w.date < last.date && w.date >= addDays(last.date, -30)).map((w) => w.restingHr);
  const med = median(hist);
  if (med == null || hist.filter((v) => v != null).length < 10) {
    return { ...base, state: "unknown", observation: `Vilopuls ${last.value} (${formatDay(last.date)}).`, interpretation: "För kort historik för en jämförelse." };
  }
  const diff = last.value - med;
  const obs = `Vilopuls ${last.value} slag/min (${formatDay(last.date)}), median senaste 30 dagarna ${round(med)}.`;
  if (diff >= 6) return { ...base, state: "strain", observation: obs, interpretation: `${round(diff)} slag över din vanliga nivå – tydligt förhöjd.` };
  if (diff >= 3) return { ...base, state: "watch", observation: obs, interpretation: `${round(diff)} slag över din vanliga nivå – något förhöjd.` };
  return { ...base, state: "ok", observation: obs, interpretation: "I nivå med din vanliga vilopuls." };
}

function sleepSignal(wellness: DailyWellness[], today: string): Signal {
  const base = { key: "sleep" as const, label: "Sömn", source: "garmin" as Source, subjective: false };
  const night = wellness.find((w) => w.date === today && w.sleepS != null);
  if (!night || night.sleepS == null) return { ...base, state: "unknown", observation: "Ingen registrerad sömn för i natt än.", interpretation: "Bedömningen görs utan nattens sömn." };
  const hist = median(wellness.filter((w) => w.date < today && w.date >= addDays(today, -28)).map((w) => w.sleepS));
  const h = night.sleepS / 3600;
  const obs = `${formatDuration(night.sleepS)} sömn i natt${hist ? `, din median är ${formatDuration(hist)}` : ""}${night.sleepScore ? `, sömnpoäng ${night.sleepScore}` : ""}.`;
  if (h < 5) return { ...base, state: "strain", observation: obs, interpretation: "Kort natt. Kroppen klarar ofta ett lugnt pass, men hård intensitet brukar kännas tyngre." };
  if (h < 6 || (hist != null && night.sleepS < hist - 3600)) return { ...base, state: "watch", observation: obs, interpretation: "Något kortare än vanligt." };
  return { ...base, state: "ok", observation: obs, interpretation: "Normal sömnlängd för dig." };
}

function loadSignal(activities: Activity[], profile: Profile, today: string): Signal {
  const base = { key: "load" as const, label: "Träningsbelastning", source: "computed" as Source, subjective: false };
  const series = loadSeries(activities, profile, addDays(today, -1), addDays(today, -1));
  const ratio = loadRatio(series);
  if (ratio == null) return { ...base, state: "unknown", observation: "För lite träningshistorik för en belastningsjämförelse.", interpretation: "" };
  const obs = `Senaste veckans belastning är ${round(ratio * 100)} % av ditt 6-veckorssnitt (räknat på puls och tid).`;
  if (ratio > 1.5) return { ...base, state: "watch", observation: obs, interpretation: "Klart mer än du är van vid. Det är ingen exakt riskgräns, men ett skäl att inte lägga på mer intensitet." };
  return { ...base, state: "ok", observation: obs, interpretation: ratio < 0.7 ? "Lägre belastning än vanligt." : "I linje med vad du är van vid." };
}

function subjectiveSignals(c: CheckIn | undefined): Signal[] {
  if (!c) return [];
  const out: Signal[] = [];
  const s = (key: Signal["key"], label: string, state: SignalState, observation: string, interpretation: string): Signal =>
    ({ key, label, state, observation, interpretation, source: "manual", subjective: true });
  if (c.energy != null) {
    const st = c.energy <= 2 ? "strain" : "ok";
    out.push(s("energy", "Energi", st, `Du skattade energin till ${c.energy} av 5.`, c.energy <= 2 ? "Låg energi väger tungt – din känsla går före klockans siffror." : c.energy >= 4 ? "God energi." : "Normal energi."));
  }
  if (c.soreness != null && c.soreness >= 4) out.push(s("soreness", "Träningsvärk", "watch", `Träningsvärk ${c.soreness} av 5.`, "Undvik tung belastning på de musklerna idag."));
  if (c.stress != null && c.stress >= 4) out.push(s("stress", "Stress", "watch", `Upplevd stress ${c.stress} av 5.`, "Hög stress tär också på återhämtningen."));
  if (c.pain > 0) {
    const areas = c.painAreas.map((a) => ({ knee: "knä", back: "rygg", shoulder: "axel", other: "annat" }[a])).join(", ") || "ospecificerat";
    out.push(s("pain", "Smärta", c.pain >= 2 ? "strain" : "watch", `Du rapporterade ${["", "lätt", "måttlig", "kraftig"][c.pain]} smärta (${areas}).`, "Passet anpassas så att det inte belastar det som gör ont."));
  }
  return out;
}

export function assessRecovery(input: {
  today: string; wellness: DailyWellness[]; activities: Activity[]; profile: Profile; checkin?: CheckIn;
}): RecoveryAssessment {
  const { today, wellness, activities, profile, checkin } = input;
  const objective = [hrvSignal(wellness, today), rhrSignal(wellness, today), sleepSignal(wellness, today), loadSignal(activities, profile, today)];
  const subjective = subjectiveSignals(checkin);
  const known = objective.filter((s) => s.state !== "unknown" && s.key !== "load");
  const strain = objective.filter((s) => s.state === "strain");
  const watch = objective.filter((s) => s.state === "watch");
  const score = strain.length * 2 + watch.length;
  const distinct = strain.length + watch.length;

  // Objective picture. A single signal can at most lower the day to "easy".
  let category: RecoveryCategory =
    score >= 4 && distinct >= 2 ? "recover" : score >= 2 ? "easy" : score === 1 ? "normal" : known.length >= 2 ? "ready" : "normal";
  let summary = "";

  // Subjective check-in weighs heavier than the watch.
  if (checkin) {
    const e = checkin.energy;
    if (checkin.pain >= 3 || (e != null && e <= 1)) category = "recover";
    else if (e != null && e <= 2) category = category === "recover" || strain.length ? "recover" : "easy";
    else if (e != null && e >= 4 && category === "easy" && score <= 2 && checkin.pain === 0) {
      category = "normal";
      summary = "Klockan visar en avvikelse, men du känner dig pigg – din känsla får väga tyngst. ";
    }
    if (category === "ready" && ((checkin.soreness ?? 0) >= 4 || (checkin.stress ?? 0) >= 4 || checkin.pain > 0)) category = "normal";
    if (category === "ready" && e != null && e < 4) category = "normal";
  }

  const conf = known.length + (checkin ? 1 : 0);
  const confidence = conf >= 4 ? "hög" : conf >= 2 ? "medel" : "låg";
  const flagged = [...strain, ...watch].map((s) => s.label.toLowerCase());
  summary += {
    ready: "Sömn, HRV och vilopuls ser normala ut för dig. Bra läge för ett kvalitetspass om det står på planen.",
    normal: flagged.length ? `Mestadels normalt, men ${flagged.join(" och ")} avviker lite. Kör planen med lite marginal.` : "Inget sticker ut. Kör planen som vanligt.",
    easy: `${flagged.length ? `${capitalize(flagged.join(" och "))} avviker från ditt normala. ` : ""}Rörelse gör ofta gott, men välj lugn intensitet idag.`,
    recover: "Flera signaler pekar mot att kroppen behöver vila. Lätt rörelse, promenad eller vila är rätt val idag.",
  }[category];
  if (known.length < 2) summary += " Underlaget är tunt, så bedömningen är osäker.";

  return { category, title: CATEGORY_TITLE[category], summary, confidence, signals: [...subjective, ...objective], disclaimer: DISCLAIMER };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
