import { useMemo, useState } from "preact/hooks";
import { minimalSession } from "../../core/coach";
import { formatDay } from "../../core/dates";
import { answerChanges, answerFitness, answerPriority, continuity, explainLoad, loadChart, weeklyLetter, type Answer } from "../../core/insights";
import { LineChart } from "../components/charts";
import { Card, Explain, PageHead, Sheet, fmt } from "../components/ui";
import { WorkoutDetails } from "../components/workout";
import { coachInput } from "../engine";
import { navigate } from "../router";
import { useBundle } from "../store";

const QUESTIONS = ["Hur går min kondition?", "Vad har förändrats senaste månaden?", "Vad bör jag prioritera nästa vecka?"] as const;

export function Coach() {
  const b = useBundle();
  const [minimal, setMinimal] = useState(false);
  const [q, setQ] = useState<number | null>(null);
  const [sources, setSources] = useState(false);
  const letter = useMemo(() => weeklyLetter(b), [b]);
  const cont = continuity(b);
  const load = useMemo(() => loadChart(b, 120), [b]);
  const min = minimal ? minimalSession(coachInput(b)) : null;
  const answer: Answer | null = q == null ? null : q === 0 ? answerFitness(b) : q === 1 ? answerChanges(b) : answerPriority({ ...coachInput(b), bundle: b });

  return (
    <div class="stack fade-in">
      <PageHead title="Coach" sub="Rekommendationer med motivering" />

      <section class="hero">
        <p class="eyebrow">Lite tid idag?</p>
        <p class="brief">Minsta effektiva passet – 20 minuter som gör mest nytta utifrån veckan hittills.</p>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" onClick={() => setMinimal(true)}>Ge mig ett kortpass</button>
          <button class="btn" onClick={() => navigate("traning/plan")}>Tvåveckorsplanen</button>
        </div>
      </section>

      <Card title="Fråga coachen" sub="Svaren räknas fram ur dina data med fasta regler – ingen AI gissar.">
        <div class="chips">{QUESTIONS.map((t, i) => <button class="chip" aria-pressed={q === i} onClick={() => setQ(q === i ? null : i)}>{t}</button>)}</div>
        {answer && <div class="stack fade-in" style="margin-top:16px">
          {answer.paragraphs.map((p) => <p>{p}</p>)}
          <p class="tiny muted">Underlag: {answer.basis}</p>
        </div>}
      </Card>

      <Card title="Veckobrevet" sub={letter.title}>
        <div class="stack">
          {letter.improved.length > 0 && <div><h4 class="section-title" style="margin:0 0 6px">Det här gick bra</h4><ul style="margin:0;padding-left:18px;display:grid;gap:4px">{letter.improved.map((x) => <li>{x}</li>)}</ul></div>}
          {letter.uncertain.length > 0 && <div><h4 class="section-title" style="margin:0 0 6px">Osäkert</h4><ul style="margin:0;padding-left:18px;display:grid;gap:4px" class="secondary">{letter.uncertain.map((x) => <li>{x}</li>)}</ul></div>}
          <div><h4 class="section-title" style="margin:0 0 6px">Prioritet</h4><p>{letter.priority}</p></div>
          <p class="small muted">{letter.facts.join(" · ")}</p>
        </div>
      </Card>

      <div class="grid-2">
        <Card title="Kontinuitet" sub="Vanor över tid – vilodagar räknas inte emot dig">
          <div class="big-number">{cont.activeWeeks}<span class="muted" style="font-size:20px"> / {cont.ofWeeks} veckor</span></div>
          <p class="secondary" style="margin-top:8px">{cont.text}</p>
        </Card>
        <Card title="Belastning" sub="Senaste 4 månaderna" right={<Explain get={explainLoad} />}>
          <LineChart data={load.map((d) => ({ x: d.date, values: { f: d.fitness, a: d.fatigue } }))} height={160}
            series={[{ id: "f", label: "Långsiktig (42 d)", color: "var(--line-chart)", width: 2.2 }, { id: "a", label: "Kortsiktig (7 d)", color: "var(--s-crosstrainer)" }]}
            xFormat={(x) => formatDay(x)} yFormat={(v) => fmt(v)} />
        </Card>
      </div>

      <Card>
        <div class="spread"><div><h3>Principer och källor</h3><p class="card-sub">Reglerna bakom rekommendationerna</p></div><button class="btn small" onClick={() => setSources(true)}>Läs</button></div>
        <p class="tiny muted" style="margin-top:10px">FORM använder ingen språkmodell. Ingen hälsodata skickas till extern AI.</p>
      </Card>

      <Sheet open={minimal} onClose={() => setMinimal(false)} title={min?.workout.title ?? ""}>{min && <WorkoutDetails s={min} />}</Sheet>
      <Sheet open={sources} onClose={() => setSources(false)} title="Principer och källor"><Principles /></Sheet>
    </div>
  );
}

function Principles() {
  const rules: [string, string, string][] = [
    ["Mest lugn träning, lite hård", "Ungefär 80 % av konditionstiden i låg intensitet och en mindre del hård. Lugna pass ska vara lugna.", "Seiler S. What is best practice for training intensity and duration distribution in endurance athletes? Int J Sports Physiol Perform. 2010."],
    ["4 × 4 minuter som kvalitetspass", "Intervaller på 85–95 % av maxpuls förbättrar maximal syreupptagning effektivt.", "Helgerud J et al. Aerobic high-intensity intervals improve VO2max more than moderate training. Med Sci Sports Exerc. 2007."],
    ["Minst 48 timmar mellan hårda pass, max ett i veckan", "Ger tid för återhämtning och undviker att missade pass staplas.", "Allmän periodiseringspraxis; se Seiler 2010 och ACSM:s riktlinjer för konditionsträning."],
    ["Belastning från tid och puls", "Banister-TRIMP och 7/42-dagars viktade snitt. Används för att se trender, inte som exakt riskmått.", "Banister EW. Modeling elite athletic performance. 1991. Kritik av belastningskvoter som riskgräns: Impellizzeri FM et al. 2020."],
    ["HRV och vilopuls mot din egen baslinje", "Jämförelse med ditt normalintervall och 7-dagarssnitt i stället för enskilda nätter.", "Plews DJ et al. Training adaptation and heart rate variability in elite endurance athletes. Sports Med. 2013. Buchheit M. Monitoring training status with HR measures. Front Physiol. 2014."],
    ["Din känsla väger tyngst", "Låg energi sänker alltid förslaget; god känsla kan väga upp en enskild avvikande siffra.", "Saw AE et al. Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures. Br J Sports Med. 2016."],
    ["Styrka 2–3 gånger i veckan vid viktminskning", "Behåller muskelmassa när du äter mindre. 2–3 repetitioner i reserv räcker för utveckling.", "ACSM Position Stand: Progression models in resistance training. 2009. Helms ER et al. 2014 om energiunderskott och muskelmassa."],
    ["Viktnedgång 0,5–1 % per vecka", "Långsam takt skyddar muskler. Vikttrenden utjämnas eftersom dagliga svängningar mest är vätska.", "Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation. J Int Soc Sports Nutr. 2014."],
    ["Smärta: anpassa, diagnostisera inte", "Ingen löpning vid knäbesvär, ingen träning genom smärta. Vid kraftig, ihållande smärta, svullnad eller instabilitet: kontakta vården.", "1177.se om knäsmärta; allmänna råd från fysioterapin."],
  ];
  return (
    <div class="stack">
      {rules.map(([t, d, s]) => <div><h3 style="font-size:16px">{t}</h3><p class="secondary small" style="margin-top:4px">{d}</p><p class="tiny muted" style="margin-top:4px">{s}</p></div>)}
      <p class="tiny muted">Appens återhämtningsbedömning är en egen sammanvägning av dessa principer – inte ett medicinskt validerat mått och inte Garmins Training Readiness.</p>
    </div>
  );
}
