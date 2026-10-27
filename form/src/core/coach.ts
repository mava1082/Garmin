import { MODALITY_LABEL, SPORT_LABEL, sessionKind } from "./activities";
import { addDays, formatDay, weekStart, weekday, weekdayName } from "./dates";
import { effectivePlan, viewPlan, weekType } from "./plan";
import { assessRecovery, type RecoveryAssessment } from "./recovery";
import type { Activity, CheckIn, DailyWellness, HrZones, Modality, PlanItem, Profile, SessionKind } from "./types";
import { buildWorkout, pickModality, runningAllowed, type Workout, type WorkoutContext } from "./workouts";

export interface CoachInput {
  today: string;
  profile: Profile;
  activities: Activity[];
  wellness: DailyWellness[];
  checkins: CheckIn[];
  plan: PlanItem[];
  zones: HrZones[];
}

export interface Reason { text: string; source: "plan" | "garmin" | "check-in" | "regel" | "historik"; }

export interface Suggestion {
  workout: Workout;
  recovery: RecoveryAssessment;
  reasons: Reason[];
  notices: string[];
  planItem: PlanItem | null;
  planned: { kind: SessionKind; modality: Modality | null; minutes: number } | null;
  alternatives: { label: string; kind: SessionKind; modality: Modality | null }[];
}

export interface SuggestOptions { minutes?: number; kind?: SessionKind; modality?: Modality | null; }

const KIND_LABEL: Record<SessionKind, string> = { strength: "styrka", easy: "lugn kondition", intervals: "intervaller", recovery: "återhämtning", rest: "vila" };

export function hardSessions(input: CoachInput): string[] {
  return input.activities.filter((a) => sessionKind(a, input.zones, input.profile) === "intervals").map((a) => a.date).sort();
}

export function suggestToday(input: CoachInput, opts: SuggestOptions = {}): Suggestion {
  const { today, profile, activities, wellness, checkins, plan, zones } = input;
  const checkin = checkins.find((c) => c.date === today);
  const recovery = assessRecovery({ today, wellness, activities, profile, checkin });
  const { views } = viewPlan(effectivePlan(plan, profile, weekStart(today), addDays(weekStart(today), 6)), activities, zones, profile, today);
  const todayView = views.find((v) => v.item.date === today && v.state !== "skipped");
  const reasons: Reason[] = [];
  const notices: string[] = [];
  const pain = checkin?.pain ?? 0;
  const painAreas = checkin?.painAreas ?? [];

  let kind: SessionKind;
  let modality: Modality | null;
  let minutes: number;
  const planItem = todayView?.item ?? null;

  if (todayView?.state === "done") {
    const a = todayView.activity!;
    reasons.push({ source: "historik", text: `Dagens planerade pass är redan genomfört: ${a.name ?? SPORT_LABEL[a.sport]} (${Math.round((a.durationS ?? 0) / 60)} min).` });
    kind = "recovery"; modality = "walking"; minutes = 20;
  } else if (planItem) {
    kind = planItem.kind; modality = planItem.modality; minutes = planItem.minutes;
    const fromTemplate = planItem.id.startsWith("tpl-");
    reasons.push({ source: "plan", text: `${fromTemplate ? "Ditt veckoupplägg" : "Planen"} för ${weekdayName(today)} (vecka ${weekType(today, profile)}): ${KIND_LABEL[kind]}${modality && kind !== "strength" ? ` på ${MODALITY_LABEL[modality].toLowerCase()}` : ""}, ${minutes} min.${fromTemplate ? " Godkänn en plan under Träning → Plan för att kunna flytta och byta pass." : ""}` });
  } else {
    kind = "rest"; modality = null; minutes = 0;
    reasons.push({ source: "plan", text: weekday(today) > 5 ? "Helg – inget planerat pass. Vila eller valfri lugn aktivitet." : "Inget pass planerat idag." });
  }
  const planned = planItem ? { kind: planItem.kind, modality: planItem.modality, minutes: planItem.minutes } : null;

  if (opts.kind) { kind = opts.kind; modality = opts.modality ?? null; reasons.push({ source: "check-in", text: "Du valde själv att byta aktivitet." }); }
  if (opts.minutes) minutes = opts.minutes;
  else if (checkin?.minutesAvailable && kind !== "rest") minutes = Math.min(minutes || checkin.minutesAvailable, checkin.minutesAvailable);
  if (checkin?.minutesAvailable && !opts.minutes && kind !== "rest") reasons.push({ source: "check-in", text: `Du har angett ${checkin.minutesAvailable} minuter.` });

  // Recovery adjustments.
  const signalText = recovery.signals.filter((s) => s.state === "strain" || s.state === "watch").map((s) => s.observation).slice(0, 3);
  for (const t of signalText) reasons.push({ source: t.startsWith("Du ") ? "check-in" : "garmin", text: t });
  let easier = false;
  if (recovery.category === "recover" && kind !== "rest") {
    reasons.push({ source: "regel", text: "Flera återhämtningssignaler avviker – passet byts mot lätt rörelse. Det planerade passet hoppas över, inte staplas på senare dagar." });
    kind = pain >= 3 ? "rest" : "recovery"; modality = "walking"; minutes = Math.min(minutes || 30, 30);
  } else if (recovery.category === "easy") {
    if (kind === "intervals") {
      reasons.push({ source: "regel", text: "Intervaller kräver god återhämtning. Idag blir det lugn kondition i stället. Intervallerna flyttas inte automatiskt – flytta dem själv i kalendern om veckan tillåter." });
      kind = "easy";
    } else if (kind === "strength") { easier = true; reasons.push({ source: "regel", text: "Styrkepasset körs lättare idag (färre set, mer marginal)." }); }
  }

  // Hard-session spacing.
  if (kind === "intervals") {
    const hard = hardSessions(input).filter((d) => d < today);
    const lastHard = hard[hard.length - 1];
    if (lastHard && lastHard >= addDays(today, -1)) {
      reasons.push({ source: "regel", text: `Senaste hårda pass var ${formatDay(lastHard)}. Minst 48 timmar emellan, så idag blir det lugnt.` });
      kind = "easy";
    } else if (hard.some((d) => d >= weekStart(today))) {
      reasons.push({ source: "regel", text: "Veckans intervallpass är redan gjort – mer intensitet ger sällan mer utveckling." });
      kind = "easy";
    } else if (lastHard) reasons.push({ source: "historik", text: `Senaste intervallpass: ${formatDay(lastHard)}.` });
  }

  // Pain and knee status decide the modality, never the other way round.
  const runOk = runningAllowed(profile.kneeStatus, { pain, painAreas });
  if ((kind === "easy" || kind === "intervals") && (!modality || modality === "gym" || (modality === "running" && !runOk))) {
    const before = modality;
    modality = pickModality(profile, { pain, painAreas }, ["running"].filter(() => !runOk) as Modality[]);
    if (before === "running") reasons.push({ source: "regel", text: profile.kneeStatus === "current" ? "Ingen löpning medan du anger aktuella knäbesvär – samma effekt på crosstrainer eller cykel." : "Du rapporterade smärta, så löpning byts mot ett skonsammare alternativ." });
  }
  if (pain >= 2 && painAreas.includes("knee") && (kind === "easy" || kind === "intervals")) {
    if (kind === "intervals") { kind = "easy"; reasons.push({ source: "regel", text: "Ingen hög intensitet med knäsmärta." }); }
    notices.push("Kör bara om det går helt utan smärta. Gör det ont under passet – avbryt.");
  }
  if (pain >= 2) notices.push("Träna inte igenom smärta. Om den är kraftig, inte avtar inom några dagar eller kommer med svullnad, låsningar eller instabilitet: kontakta vårdcentral eller fysioterapeut (vägledning finns på 1177.se).");

  if (todayView?.state !== "done") {
    const missedHard = views.filter((v) => v.state === "missed" && v.item.kind === "intervals" && v.item.date >= weekStart(today));
    if (missedHard.length) notices.push(`Intervallpasset ${formatDay(missedHard[0].item.date)} blev inte av. Det läggs inte automatiskt till senare – två hårda pass tätt ger mer trötthet än effekt.`);
  }

  const recentIntervals = hardSessions(input).filter((d) => d >= addDays(today, -42)).length;
  const intervalLevel = recovery.category === "ready" || recovery.category === "normal" ? (recentIntervals >= 8 ? 2 : recentIntervals >= 4 ? 1 : 0) : 0;
  if (kind === "intervals" && intervalLevel > 0) reasons.push({ source: "historik", text: `${recentIntervals} intervallpass senaste 6 veckorna – dags för ett litet steg upp i volym.` });
  const strengthCount = activities.filter((a) => a.sport === "strength" && a.date >= addDays(today, -28)).length;

  const ctx: WorkoutContext = { profile, zones, pain, painAreas, soreness: checkin?.soreness ?? null, intervalLevel, strengthVariant: strengthCount, easier };
  const workout = buildWorkout(kind, modality, minutes || 30, ctx);
  if (!checkin) notices.push("Gör dagens check-in – hur du känner dig väger tyngre än klockans siffror.");

  return { workout, recovery, reasons, notices, planItem, planned, alternatives: alternatives(kind, modality, profile, { pain, painAreas }) };
}

function alternatives(kind: SessionKind, modality: Modality | null, profile: Profile, ctx: { pain: number; painAreas: CheckIn["painAreas"] }) {
  const out: Suggestion["alternatives"] = [];
  const mods = profile.enduranceModalities.filter((m) => m !== modality && (m !== "running" || runningAllowed(profile.kneeStatus, ctx)));
  if (kind === "easy" || kind === "intervals") for (const m of mods) out.push({ label: `${kind === "easy" ? "Lugnt" : "Intervaller"} på ${MODALITY_LABEL[m].toLowerCase()}`, kind, modality: m });
  if (kind !== "strength") out.push({ label: "Styrka i stället", kind: "strength", modality: "gym" });
  if (kind !== "easy") out.push({ label: "Lugn kondition i stället", kind: "easy", modality: pickModality(profile, ctx) });
  if (kind !== "recovery") out.push({ label: "Bara promenad och rörlighet", kind: "recovery", modality: "walking" });
  if (kind !== "rest") out.push({ label: "Vila idag", kind: "rest", modality: null });
  return out;
}

/** "Minsta effektiva passet": the most useful 20 minutes given the week so far. */
export function minimalSession(input: CoachInput): Suggestion {
  const { today, profile, activities, zones } = input;
  const base = suggestToday(input, { minutes: 20 });
  const weekFrom = weekStart(today);
  const thisWeek = activities.filter((a) => a.date >= weekFrom && a.date <= today);
  const hardThisWeek = hardSessions(input).some((d) => d >= weekFrom);
  const lastHard = hardSessions(input).filter((d) => d < today).pop();
  const strengthDone = thisWeek.filter((a) => a.sport === "strength").length;
  const strengthTarget = weekType(today, profile) === "A" ? 2 : 3;
  const checkin = input.checkins.find((c) => c.date === today);
  const ok = base.recovery.category === "ready" || base.recovery.category === "normal";
  let kind: SessionKind;
  let why: string;
  if (ok && !hardThisWeek && (!lastHard || lastHard < addDays(today, -1)) && (checkin?.pain ?? 0) === 0) {
    kind = "intervals"; why = "Inget intervallpass än den här veckan och återhämtningen ser normal ut – korta intervaller ger mest kondition per minut.";
  } else if (strengthDone < strengthTarget) {
    kind = "strength"; why = `${strengthDone} av ${strengthTarget} styrkepass gjorda den här veckan – 20 minuter styrka håller musklerna igång.`;
  } else {
    kind = ok ? "easy" : "recovery"; why = "Veckans viktigaste pass är gjorda. Ett kort lugnt pass håller vanan vid liv utan att trötta ut dig.";
  }
  const s = suggestToday(input, { minutes: 20, kind, modality: kind === "strength" ? "gym" : kind === "recovery" ? "walking" : null });
  s.reasons = [{ source: "regel", text: why }, ...s.reasons.filter((r) => !r.text.startsWith("Du valde själv"))];
  return s;
}
