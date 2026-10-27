import { MODALITY_LABEL } from "./activities";
import type { HrZones, KneeStatus, Modality, PainArea, Profile, SessionKind, Sport } from "./types";
import { METHOD_LABEL, zoneRange, zonesFor } from "./zones";

export interface Step { minutes?: number; text: string; }

export interface Workout {
  id: string;
  kind: SessionKind;
  modality: Modality | null;
  title: string;
  purpose: string;
  minutes: number;
  intensity: { rpe: string; talk: string; zones: string | null; personal: string | null };
  warmup: Step[];
  main: Step[];
  cooldown: Step[];
  shorter: string | null;
  notes: string[];
}

export interface WorkoutContext {
  profile: Profile;
  zones: HrZones[];
  painAreas: PainArea[];
  pain: number;
  soreness: number | null;
  /** 0 = first time, used for simple progression of intervals. */
  intervalLevel?: number;
  strengthVariant?: number;
  easier?: boolean;
}

const MODALITY_SPORT: Record<Modality, Sport> = {
  crosstrainer: "crosstrainer", cycling: "cycling", indoor_cycling: "cycling", running: "running", walking: "walking", gym: "strength",
};

function zoneText(modality: Modality, ctx: WorkoutContext, fromZone: number, toZone: number): string {
  const z = zonesFor(MODALITY_SPORT[modality], ctx.zones, ctx.profile);
  const [lo] = zoneRange(z, fromZone);
  const [, hi] = zoneRange(z, toZone);
  const label = fromZone === toZone ? `Zon ${fromZone}` : `Zon ${fromZone}–${toZone}`;
  const src = z.source === "garmin" ? `Garmins zoner${z.sport !== "DEFAULT" ? ` för ${z.sport === "RUNNING" ? "löpning" : "cykling"}` : ""}` : z.source === "manual" ? "dina egna zoner" : "uppskattade zoner";
  return `${label}: ${lo}–${hi} slag/min (${src}, ${METHOD_LABEL[z.method]}).`;
}

/** Choose an endurance modality that respects knee status and today's pain. */
export function pickModality(profile: Profile, ctx: { pain: number; painAreas: PainArea[] }, avoid: Modality[] = []): Modality {
  const allowed = profile.enduranceModalities.filter((m) => runningAllowed(profile.kneeStatus, ctx) || m !== "running");
  const pick = allowed.find((m) => !avoid.includes(m)) ?? allowed[0] ?? "crosstrainer";
  return pick;
}

export function runningAllowed(knee: KneeStatus, ctx: { pain: number; painAreas: PainArea[] }): boolean {
  if (knee === "current") return false;
  if (ctx.pain > 0 && (ctx.painAreas.includes("knee") || ctx.painAreas.includes("other") || ctx.painAreas.length === 0)) return false;
  return true;
}

export function easyEndurance(modality: Modality, minutes: number, ctx: WorkoutContext): Workout {
  const main = Math.max(8, minutes - 10);
  const personal = ctx.profile.comfortableEasyHr
    ? `Du har tidigare upplevt ${ctx.profile.comfortableEasyHr[0]}–${ctx.profile.comfortableEasyHr[1]} slag/min som behagligt. Använd det som riktmärke om prattestet stämmer.`
    : null;
  const run = modality === "running";
  return {
    id: `easy-${modality}-${minutes}`, kind: "easy", modality,
    title: `Lugn ${MODALITY_LABEL[modality].toLowerCase()}`,
    purpose: "Bygga aerob bas och fettförbränningsförmåga med låg kostnad för återhämtningen.",
    minutes,
    intensity: { rpe: "RPE 3–4 av 10", talk: "Du ska kunna prata i hela meningar.", zones: zoneText(modality, ctx, 1, 2), personal },
    warmup: [{ minutes: 5, text: "Börja mycket lugnt och öka gradvis." }],
    main: [{ minutes: main, text: run ? "Jämnt, lätt tempo. Gå gärna korta stunder om knät säger ifrån." : "Jämn, lätt ansträngning. Hellre för lätt än för hårt." }],
    cooldown: [{ minutes: 5, text: "Varva ner och avsluta med lätt rörlighet." }],
    shorter: minutes > 20 ? "20 minuter i samma lugna tempo ger också effekt." : null,
    notes: run ? ["Löpning: håll tiden kort jämfört med vad du orkar, och avbryt om knät gör ont."] : [],
  };
}

const INTERVAL_LEVELS = [
  { reps: 4, work: 4, rest: 3, label: "4 × 4 min" },
  { reps: 5, work: 4, rest: 3, label: "5 × 4 min" },
  { reps: 4, work: 5, rest: 3, label: "4 × 5 min" },
];

export function intervals(modality: Modality, minutes: number, ctx: WorkoutContext): Workout {
  let lvl = INTERVAL_LEVELS[Math.min(ctx.intervalLevel ?? 0, INTERVAL_LEVELS.length - 1)];
  if (minutes <= 25) lvl = { reps: 3, work: 3, rest: 2, label: "3 × 3 min" };
  const core = lvl.reps * lvl.work + (lvl.reps - 1) * lvl.rest;
  const warm = minutes <= 25 ? 7 : 10;
  const cool = Math.max(3, minutes - core - warm);
  return {
    id: `intervals-${modality}-${minutes}`, kind: "intervals", modality,
    title: `Intervaller ${lvl.label}`,
    purpose: "Höja den maximala syreupptagningen – det mest effektiva sättet att förbättra konditionen per minut.",
    minutes: warm + core + cool,
    intensity: {
      rpe: "Arbete RPE 8–9 av 10, vila RPE 3",
      talk: "Under arbetet ska du bara kunna säga några ord. Sista intervallen ska vara tung men möjlig.",
      zones: zoneText(modality, ctx, 4, 5),
      personal: "Pulsen släpar efter – den första intervallen når ofta inte zon 4 förrän mot slutet. Styr på ansträngning.",
    },
    warmup: [{ minutes: warm, text: "Lugnt, öka gradvis. Lägg in två korta stegringar på 20 sekunder." }],
    main: [{ minutes: core, text: `${lvl.reps} × ${lvl.work} min hårt med ${lvl.rest} min lugn aktiv vila mellan.` }],
    cooldown: [{ minutes: cool, text: "Lugnt tills andningen är normal." }],
    shorter: minutes > 25 ? "20-minutersvariant: 7 min uppvärmning, 3 × 3 min hårt med 2 min vila, 3 min nedvarvning." : null,
    notes: ["Max ett sådant pass per vecka i ditt upplägg, med minst 48 timmar till nästa hårda pass."],
  };
}

interface Exercise { name: string; knee?: boolean; back?: boolean; shoulder?: boolean; kneeAlt?: string; }

const STRENGTH_VARIANTS: { name: string; exercises: Exercise[] }[] = [
  { name: "Helkropp A", exercises: [
    { name: "Goblet squat", knee: true, kneeAlt: "Boxknäböj till bekvämt djup, eller höftlyft" },
    { name: "Hantelpress på bänk", shoulder: true },
    { name: "Rumänsk marklyft med hantlar", back: true },
    { name: "Sittande kabelrodd" },
    { name: "Utfallssteg bakåt", knee: true, kneeAlt: "Step-up på låg låda, eller hoppa över" },
    { name: "Planka 3 × 30–45 s" },
  ] },
  { name: "Helkropp B", exercises: [
    { name: "Trap bar-marklyft eller höftlyft", back: true },
    { name: "Stående hantelpress", shoulder: true },
    { name: "Benpress", knee: true, kneeAlt: "Benpress med kort rörelse utan smärta, eller hip thrust" },
    { name: "Latsdrag eller chins" },
    { name: "Pallof press" },
    { name: "Vadpress" },
  ] },
  { name: "Helkropp C", exercises: [
    { name: "Bulgarian split squat", knee: true, kneeAlt: "Höftlyft med paus" },
    { name: "Armhävningar eller lutande bänkpress", shoulder: true },
    { name: "Hantelrodd med stöd" },
    { name: "Kettlebell swing", back: true },
    { name: "Face pulls" },
    { name: "Dead bug 3 × 8 per sida" },
  ] },
];

export function strength(minutes: number, ctx: WorkoutContext): Workout {
  const variant = STRENGTH_VARIANTS[(ctx.strengthVariant ?? 0) % STRENGTH_VARIANTS.length];
  const kneeCareful = ctx.profile.kneeStatus !== "none" || ctx.painAreas.includes("knee");
  const notes: string[] = [];
  const list = variant.exercises.flatMap((e) => {
    if (ctx.pain >= 2 && ((e.knee && ctx.painAreas.includes("knee")) || (e.back && ctx.painAreas.includes("back")) || (e.shoulder && ctx.painAreas.includes("shoulder")))) {
      notes.push(`${e.name} är borttagen idag eftersom du rapporterade smärta.`);
      return [];
    }
    if (e.knee && kneeCareful && e.kneeAlt) return [`${e.name} – knävänligt alternativ: ${e.kneeAlt}`];
    return [e.name];
  });
  const sets = minutes <= 25 ? 2 : minutes >= 55 ? 4 : 3;
  const shown = minutes <= 25 ? list.slice(0, 4) : list;
  const easier = ctx.easier || (ctx.soreness ?? 0) >= 4;
  const rpe = easier ? "RPE 6 – minst 4 repetitioner kvar i reserv" : "RPE 7–8 – 2–3 repetitioner kvar i reserv";
  return {
    id: `strength-${variant.name}-${minutes}`, kind: "strength", modality: "gym",
    title: `${variant.name}${easier ? " (lättare)" : ""}`,
    purpose: "Behålla och bygga muskler medan du minskar fettmassa. Regelbundenhet betyder mer än maximal belastning.",
    minutes,
    intensity: { rpe, talk: "Kontrollerade repetitioner, full rörlighet utan smärta.", zones: null, personal: null },
    warmup: [{ minutes: 5, text: "Lätt kondition eller dynamisk rörlighet, sedan ett lätt uppvärmningsset på första övningen." }],
    main: [{ minutes: minutes - 8, text: `${sets} set × 8–12 repetitioner, gärna i par (superset) för att spara tid. Vila 60–90 s.` },
      ...shown.map((t) => ({ text: t }))],
    cooldown: [{ minutes: 3, text: "Lugn rörlighet för höfter och bröstrygg." }],
    shorter: minutes > 25 ? "20-minutersvariant: de fyra första övningarna, 2 set var i par." : null,
    notes: [...notes, ...(ctx.profile.useStrengthLog ? ["Logga gärna passet i StrengthLog som vanligt – importera sedan för progressionsanalys."] : [])],
  };
}

export function recovery(minutes: number, ctx: WorkoutContext): Workout {
  const painNote = ctx.pain >= 2
    ? ["Vid smärta: träna inte igenom den. Om smärtan är kraftig, inte avtar inom några dagar, eller kommer med svullnad, låsningar eller instabilitet – kontakta vårdcentral eller fysioterapeut (1177.se har vägledning)."]
    : [];
  return {
    id: `recovery-${minutes}`, kind: "recovery", modality: "walking",
    title: "Återhämtning: promenad och rörlighet",
    purpose: "Hålla igång blodcirkulationen utan att lägga till belastning.",
    minutes,
    intensity: { rpe: "RPE 2 av 10", talk: "Lätt som en vanlig promenad.", zones: null, personal: null },
    warmup: [], main: [{ minutes: Math.max(10, minutes - 10), text: "Promenad i lugnt tempo, gärna utomhus." }, { minutes: 10, text: "Lugn rörlighet – bara det som känns bra." }],
    cooldown: [], shorter: null, notes: painNote,
  };
}

export function rest(): Workout {
  return {
    id: "rest", kind: "rest", modality: null, title: "Vila", purpose: "Återhämtning är när anpassningen sker.", minutes: 0,
    intensity: { rpe: "–", talk: "–", zones: null, personal: null }, warmup: [], main: [{ text: "Ingen planerad träning. Vardagsrörelse räcker." }], cooldown: [], shorter: null, notes: [],
  };
}

export function buildWorkout(kind: SessionKind, modality: Modality | null, minutes: number, ctx: WorkoutContext): Workout {
  switch (kind) {
    case "strength": return strength(minutes, ctx);
    case "intervals": return intervals(modality ?? pickModality(ctx.profile, ctx), minutes, ctx);
    case "easy": return easyEndurance(modality ?? pickModality(ctx.profile, ctx), minutes, ctx);
    case "recovery": return recovery(minutes, ctx);
    default: return rest();
  }
}
