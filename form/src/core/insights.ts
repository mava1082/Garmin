import { sessionKind, SPORT_LABEL, trimp } from "./activities";
import { weightChange, weightTrend } from "./body";
import type { CoachInput } from "./coach";
import { addDays, formatDay, formatDuration, formatRaceTime, range, weekStart } from "./dates";
import { loadSeries } from "./load";
import { weekType } from "./plan";
import { sleepWindow } from "./sleep";
import { mean, round, spearman } from "./stats";
import { comparisons, intensitySplit, weeklySummary } from "./trends";
import type { DataBundle } from "./types";

// ---------------------------------------------------------------- patterns

export interface Pattern {
  id: string;
  title: string;
  n: number;
  period: string;
  r: number | null;
  status: "samband" | "inget tydligt samband" | "för lite data";
  text: string;
}

const MIN_N = 20;
const MIN_R = 0.3;

/** "Vad driver min utveckling?" – only reported with enough paired days, and phrased as co-variation. */
export function patterns(b: DataBundle): Pattern[] {
  const from = addDays(b.today, -120);
  const days = range(from, b.today);
  const w = new Map(b.wellness.map((x) => [x.date, x]));
  const c = new Map(b.checkins.map((x) => [x.date, x]));
  const loadByDay = new Map<string, number>();
  for (const a of b.activities) loadByDay.set(a.date, (loadByDay.get(a.date) ?? 0) + trimp(a, b.profile));
  const load3 = (d: string) => [0, 1, 2].reduce((s, i) => s + (loadByDay.get(addDays(d, -i)) ?? 0), 0);

  const defs: { id: string; title: string; pairs: [number | null, number | null][]; pos: string; neg: string }[] = [
    { id: "sleep-hrv", title: "Sömnlängd och nattens HRV", pairs: days.map((d) => [h(w.get(d)?.sleepS), w.get(d)?.hrvLastNight ?? null]),
      pos: "Längre nätter samvarierar med högre HRV för dig.", neg: "Längre nätter samvarierar med lägre HRV – ovanligt, kan bero på annat som händer samma nätter." },
    { id: "load-rhr", title: "Träningsbelastning och vilopulsen dagen efter", pairs: days.map((d) => [loadByDay.get(addDays(d, -1)) ?? 0, w.get(d)?.restingHr ?? null]),
      pos: "Tyngre träningsdagar samvarierar med högre vilopuls dagen efter.", neg: "Tyngre träningsdagar samvarierar med lägre vilopuls dagen efter." },
    { id: "sleep-energy", title: "Sömnlängd och upplevd energi", pairs: days.map((d) => [h(w.get(d)?.sleepS), c.get(d)?.energy ?? null]),
      pos: "Längre nätter samvarierar med högre upplevd energi.", neg: "Längre nätter samvarierar med lägre upplevd energi." },
    { id: "load-soreness", title: "Senaste tre dagarnas belastning och träningsvärk", pairs: days.map((d) => [load3(d), c.get(d)?.soreness ?? null]),
      pos: "Mer belastning senaste dagarna samvarierar med mer träningsvärk.", neg: "Mer belastning samvarierar med mindre träningsvärk." },
  ];
  return defs.map((d) => {
    const { r, n } = spearman(d.pairs);
    const period = `${formatDay(from)} – ${formatDay(b.today)}`;
    if (n < MIN_N) return { id: d.id, title: d.title, n, period, r: null, status: "för lite data" as const, text: `Behöver minst ${MIN_N} dagar med båda värdena – har ${n}.` };
    if (r == null || Math.abs(r) < MIN_R) return { id: d.id, title: d.title, n, period, r, status: "inget tydligt samband" as const, text: `Inget tydligt samband i ${n} dagar (r = ${r == null ? "–" : r.toFixed(2)}).` };
    return { id: d.id, title: d.title, n, period, r, status: "samband" as const, text: `${r > 0 ? d.pos : d.neg} Rangkorrelation r = ${r.toFixed(2)} över ${n} dagar. Det är ett samband, inte ett bevis för orsak.` };
  });
}

const h = (s: number | null | undefined) => (s == null ? null : s / 3600);

// ---------------------------------------------------------------- explain

export interface Explanation { what: string; now: string; action: string; }

export function explainHrv(b: DataBundle): Explanation {
  const last7 = mean(b.wellness.filter((x) => x.date > addDays(b.today, -7)).map((x) => x.hrvLastNight));
  const prev = mean(b.wellness.filter((x) => x.date <= addDays(b.today, -7) && x.date > addDays(b.today, -35)).map((x) => x.hrvLastNight));
  const latest = [...b.wellness].reverse().find((x) => x.hrvBaselineLow != null);
  return {
    what: "HRV (hjärtfrekvensvariabilitet) mäts av klockan under natten. Den varierar mycket mellan personer, så bara jämförelsen med din egen nivå är meningsfull. Det grå bandet är ditt normala intervall.",
    now: last7 == null ? "Det finns för få mätningar senaste veckan." :
      `Veckosnittet är ${round(last7)} ms${prev ? ` jämfört med ${round(prev)} ms veckorna innan` : ""}${latest ? `. Garmins normalintervall för dig: ${latest.hrvBaselineLow}–${latest.hrvBaselineHigh} ms` : ""}.`,
    action: "Titta på trenden över flera dagar, inte på enskilda nätter. Ett sjunkande veckosnitt tillsammans med sämre sömn eller högre vilopuls är ett skäl att ta det lugnare.",
  };
}

export function explainRhr(b: DataBundle): Explanation {
  const recent = mean(b.wellness.filter((x) => x.date > addDays(b.today, -7)).map((x) => x.restingHr));
  const older = mean(b.wellness.filter((x) => x.date <= addDays(b.today, -60) && x.date > addDays(b.today, -90)).map((x) => x.restingHr));
  return {
    what: "Vilopulsen är den lägsta pulsen under dygnet. På lång sikt sjunker den ofta när konditionen förbättras; på kort sikt kan den stiga vid trötthet, stress, alkohol eller sjukdom.",
    now: recent == null ? "För få mätningar senaste veckan." : `Senaste veckan i snitt ${round(recent)} slag/min${older ? `, för två–tre månader sedan ${round(older)}` : ""}.`,
    action: "En förhöjning på 5 slag eller mer flera dagar i rad är värd att ta hänsyn till. Enstaka dagar varierar naturligt.",
  };
}

export function explainSleep(b: DataBundle): Explanation {
  const s7 = sleepWindow(b.wellness, b.today, 7), s28 = sleepWindow(b.wellness, b.today, 28);
  return {
    what: "Sömnlängd och sömntider från klockan. Sömnfaser och sömnpoäng är klockans uppskattningar, inte en sömnmätning i labb.",
    now: s7.avgS == null ? "Ingen sömn registrerad senaste veckan." : `Senaste veckan ${formatDuration(s7.avgS)} per natt${s28.avgS ? `, senaste månaden ${formatDuration(s28.avgS)}` : ""}.`,
    action: "Småbarnsnätter går inte alltid att påverka. När det går: regelbundna sovtider hjälper mest. Korta nätter gör ett lugnt pass till ett bättre val än ett hårt.",
  };
}

export function explainWeight(b: DataBundle): Explanation {
  const t = weightTrend(b.weights);
  const c4 = weightChange(t, b.today, 4);
  return {
    what: `Prickarna är dina vägningar. Linjen är en utjämnad trend (exponentiellt glidande medel med 10 dagars tidskonstant) som filtrerar bort vätska och mat från dag till dag.`,
    now: c4.kg == null ? "För få vägningar för en trend." : `Trenden har ändrats ${c4.kg > 0 ? "+" : ""}${c4.kg} kg på 4 veckor (${c4.pctPerWeek} % per vecka).`,
    action: "Väg dig gärna på morgonen under liknande förhållanden. Vågen kan inte avgöra om förändringen är fett eller muskler – midjemått och styrkeutveckling ger viktig kompletterande information.",
  };
}

export function explainLoad(): Explanation {
  return {
    what: "Belastning räknas per pass från tid och snittpuls (Banister-TRIMP). Linjerna visar 7- och 42-dagars viktade snitt – kortsiktig trötthet och långsiktig träningsvana.",
    now: "Måttet är relativt din egen historik och säger inget absolut om kondition. Styrkepass räknas grovt eftersom puls inte beskriver styrketräning väl.",
    action: "En jämn eller svagt stigande långsiktig linje är målet. Stora hopp i den korta linjen är ett skäl att inte lägga till mer intensitet.",
  };
}

export function explainIntensity(b: DataBundle): Explanation {
  const split = intensitySplit(b.activities, b.zones, b.profile, addDays(b.today, -27), b.today);
  return {
    what: "Andel konditionstid i låg (zon 1–2), medel (zon 3) och hög (zon 4–5) intensitet senaste 4 veckorna. Styrka ingår inte.",
    now: split ? `${Math.round(split.low * 100)} % låg, ${Math.round(split.mid * 100)} % medel, ${Math.round(split.high * 100)} % hög${split.estimatedShare > 0.3 ? ". En del är uppskattat från snittpuls, så siffrorna är ungefärliga" : ""}.` : "Ingen konditionsträning med puls senaste 4 veckorna.",
    action: "Många uthållighetsidrottare har ungefär 80 % lugn träning och resten hård. Gör de lugna passen lugna och de hårda hårda.",
  };
}

// ---------------------------------------------------------------- continuity

export function continuity(b: DataBundle): { activeWeeks: number; ofWeeks: number; text: string } {
  const weeks = weeklySummary(b.activities, b.zones, b.profile, b.today, 8).slice(0, -1);
  const active = weeks.filter((w) => w.sessions >= 2).length;
  const text = active >= 6 ? `${active} av ${weeks.length} senaste veckorna med minst två pass. En stabil vana – vilodagar och lättare veckor hör till.`
    : active >= 3 ? `${active} av ${weeks.length} veckor med minst två pass. Det räcker långt – regelbundenhet över tid slår perfekta veckor.`
    : `${active} av ${weeks.length} veckor med minst två pass. Livet med småbarn går i perioder; varje pass räknas.`;
  return { activeWeeks: active, ofWeeks: weeks.length, text };
}

// ---------------------------------------------------------------- questions

export interface Answer { question: string; paragraphs: string[]; basis: string; }

export function answerFitness(b: DataBundle): Answer {
  const comps = comparisons(b.activities, b.profile).filter((c) => c.enough);
  const p: string[] = [];
  for (const c of comps) {
    const first = mean(c.points.slice(0, 3).map((x) => x.value)), last = mean(c.points.slice(-3).map((x) => x.value));
    if (first && last) {
      const pct = ((last - first) / first) * 100;
      p.push(`${c.title}: ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} % från de tre första till de tre senaste passen (${c.points.length} pass). ${Math.abs(pct) < 3 ? "Ingen tydlig förändring." : pct > 0 ? "Det tyder på bättre aerob effektivitet." : "Lite sämre – kan bero på värme, terräng eller trötthet."}`);
    }
  }
  const rhrNow = mean(b.wellness.filter((x) => x.date > addDays(b.today, -14)).map((x) => x.restingHr));
  const rhrThen = mean(b.wellness.filter((x) => x.date <= addDays(b.today, -76) && x.date > addDays(b.today, -90)).map((x) => x.restingHr));
  if (rhrNow && rhrThen) p.push(`Vilopulsen: ${round(rhrNow)} slag/min senaste två veckorna mot ${round(rhrThen)} för tre månader sedan.`);
  const g = b.profile.goals;
  if (g.recent5kS && g.run5kTargetS) p.push(`Löpmål: från ${formatRaceTime(g.recent5kS)} till under ${formatRaceTime(g.run5kTargetS)} på 5 km är ungefär ${Math.round((1 - g.run5kTargetS / g.recent5kS) * 100)} % snabbare. Det är ett långsiktigt mål som kräver regelbunden löpning när knät tillåter – appen gissar inte någon prognos utan testlopp.`);
  if (!p.length) p.push("Det finns ännu inte tillräckligt många jämförbara pass (minst sex av samma typ) för att säga något säkert om konditionen.");
  return { question: "Hur går min kondition?", paragraphs: p, basis: "Jämförbara pass av samma typ, vilopuls från Garmin och dina mål." };
}

export function answerChanges(b: DataBundle): Answer {
  const cur = { from: addDays(b.today, -27), to: b.today }, prev = { from: addDays(b.today, -55), to: addDays(b.today, -28) };
  const minutes = (r: typeof cur) => b.activities.filter((a) => a.date >= r.from && a.date <= r.to).reduce((s, a) => s + (a.durationS ?? 0) / 60, 0);
  const count = (r: typeof cur) => b.activities.filter((a) => a.date >= r.from && a.date <= r.to).length;
  const avg = (r: typeof cur, k: "sleepS" | "restingHr" | "hrvLastNight") => mean(b.wellness.filter((x) => x.date >= r.from && x.date <= r.to).map((x) => x[k]));
  const p = [
    `Träning: ${count(cur)} pass och ${Math.round(minutes(cur) / 60 * 10) / 10} timmar, mot ${count(prev)} pass och ${Math.round(minutes(prev) / 60 * 10) / 10} timmar de fyra veckorna innan.`,
  ];
  const s1 = avg(cur, "sleepS"), s0 = avg(prev, "sleepS");
  if (s1 && s0) p.push(`Sömn: ${formatDuration(s1)} per natt mot ${formatDuration(s0)}.`);
  const r1 = avg(cur, "restingHr"), r0 = avg(prev, "restingHr");
  if (r1 && r0) p.push(`Vilopuls: ${round(r1)} mot ${round(r0)} slag/min.`);
  const v1 = avg(cur, "hrvLastNight"), v0 = avg(prev, "hrvLastNight");
  if (v1 && v0) p.push(`HRV: ${round(v1)} mot ${round(v0)} ms.`);
  const wc = weightChange(weightTrend(b.weights), b.today, 4);
  if (wc.kg != null) p.push(`Vikttrend: ${wc.kg > 0 ? "+" : ""}${wc.kg} kg på fyra veckor.`);
  return { question: "Vad har förändrats senaste månaden?", paragraphs: p, basis: `${formatDay(prev.from)} – ${formatDay(prev.to)} jämfört med ${formatDay(cur.from)} – ${formatDay(cur.to)}.` };
}

export function answerPriority(input: CoachInput & { bundle: DataBundle }): Answer {
  const b = input.bundle;
  const nextMonday = addDays(weekStart(b.today), 7);
  const type = weekType(nextMonday, b.profile);
  const split = intensitySplit(b.activities, b.zones, b.profile, addDays(b.today, -27), b.today);
  const weeks = weeklySummary(b.activities, b.zones, b.profile, b.today, 4);
  const strengthAvg = mean(weeks.map((w) => w.strength)) ?? 0;
  const sleep = sleepWindow(b.wellness, b.today, 14);
  const p: string[] = [`Nästa vecka är vecka ${type}: ${type === "A" ? "tre konditionspass och två styrkepass" : "två konditionspass och tre styrkepass"}, varav ett intervallpass.`];
  if (strengthAvg < 2) p.push(`Prioritera styrkan: i snitt ${strengthAvg.toFixed(1)} styrkepass per vecka senaste månaden. Två pass i veckan är grunden för att behålla muskler när vikten går ner.`);
  else p.push("Styrkan rullar på bra – behåll regelbundenheten och öka vikten när du klarar övre delen av repetitionsintervallet.");
  if (split && split.mid > 0.3) p.push(`${Math.round(split.mid * 100)} % av konditionstiden har legat i zon 3. Gör de lugna passen lite lugnare så orkar du mer på intervallerna.`);
  if (sleep.avgS && sleep.avgS < 6.5 * 3600) p.push(`Sömnen har legat runt ${formatDuration(sleep.avgS)} – planera gärna det hårda passet efter en natt som brukar bli bättre.`);
  if (b.profile.kneeStatus !== "current" && b.profile.enduranceModalities.includes("running")) p.push("Löpning: håll den kort och lätt tills knät har fungerat bra i flera veckor; öka sedan gradvis.");
  return { question: "Vad bör jag prioritera nästa vecka?", paragraphs: p, basis: "Ditt veckoupplägg, senaste fyra veckornas träning och sömn." };
}

// ---------------------------------------------------------------- weekly letter

export interface WeeklyLetter { week: string; title: string; improved: string[]; uncertain: string[]; priority: string; facts: string[]; }

export function weeklyLetter(b: DataBundle): WeeklyLetter {
  const thisMonday = weekStart(b.today);
  const from = addDays(thisMonday, -7), to = addDays(thisMonday, -1);
  const acts = b.activities.filter((a) => a.date >= from && a.date <= to);
  const prevActs = b.activities.filter((a) => a.date >= addDays(from, -7) && a.date < from);
  const mins = (x: typeof acts) => Math.round(x.reduce((s, a) => s + (a.durationS ?? 0) / 60, 0));
  const type = weekType(from, b.profile);
  const target = type === "A" ? { cond: 3, str: 2 } : { cond: 2, str: 3 };
  const str = acts.filter((a) => a.sport === "strength").length;
  const cond = acts.filter((a) => a.sport !== "strength" && a.sport !== "walking").length;
  const hard = acts.filter((a) => sessionKind(a, b.zones, b.profile) === "intervals").length;
  const sleepNow = sleepWindow(b.wellness, to, 7), sleepPrev = sleepWindow(b.wellness, addDays(from, -1), 7);
  const improved: string[] = [], uncertain: string[] = [];
  if (mins(acts) > mins(prevActs) && acts.length) improved.push(`Mer träningstid än veckan innan (${mins(acts)} mot ${mins(prevActs)} min).`);
  if (str >= target.str) improved.push(`Alla ${target.str} planerade styrkepass blev av.`);
  if (sleepNow.avgS && sleepPrev.avgS && sleepNow.avgS > sleepPrev.avgS + 900) improved.push(`Bättre sömn: ${formatDuration(sleepNow.avgS)} per natt.`);
  if (sleepNow.nights < 5) uncertain.push(`Sömn finns bara för ${sleepNow.nights} av 7 nätter.`);
  if (!b.checkins.some((c) => c.date >= from && c.date <= to)) uncertain.push("Inga check-ins förra veckan – bedömningarna bygger bara på klockan.");
  const wc = weightChange(weightTrend(b.weights), to, 1);
  if (wc.kg != null) uncertain.push(`Vikttrenden ändrades ${wc.kg > 0 ? "+" : ""}${wc.kg} kg. En enskild vecka säger lite.`);
  const priority = str < target.str ? "Nästa vecka: säkra styrkepassen först – de är viktigast för att behålla muskler."
    : hard === 0 ? "Nästa vecka: få in ett intervallpass om återhämtningen tillåter."
    : "Nästa vecka: samma upplägg. Kontinuitet är det som ger resultat.";
  return {
    week: from, title: `Veckan ${formatDay(from)} – ${formatDay(to)}`, improved, uncertain, priority,
    facts: [`${acts.length} pass, ${mins(acts)} min`, `${cond} kondition (mål ${target.cond}), ${str} styrka (mål ${target.str})`, `${hard} intervallpass`,
      ...(sleepNow.avgS ? [`Sömn ${formatDuration(sleepNow.avgS)} per natt`] : []),
      ...Object.entries(acts.reduce<Record<string, number>>((m, a) => ({ ...m, [SPORT_LABEL[a.sport]]: (m[SPORT_LABEL[a.sport]] ?? 0) + 1 }), {})).map(([k, v]) => `${k}: ${v}`)],
  };
}

export function loadChart(b: DataBundle, days: number) {
  return loadSeries(b.activities, b.profile, addDays(b.today, -(days - 1)), b.today);
}
