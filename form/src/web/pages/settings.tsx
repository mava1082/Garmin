import { useState } from "preact/hooks";
import { MODALITY_LABEL } from "../../core/activities";
import { CAPABILITIES } from "../../core/capabilities";
import { formatRaceTime, isoWeek, stockholmParts } from "../../core/dates";
import { weekType } from "../../core/plan";
import type { KneeStatus, Modality, Profile } from "../../core/types";
import { METHOD_LABEL, zonesFor } from "../../core/zones";
import { Card, PageHead, Seg, useAsync } from "../components/ui";
import { syncText } from "../engine";
import { useBundle, useStore } from "../store";

const KNEE: { value: KneeStatus; label: string; help: string }[] = [
  { value: "none", label: "Inga besvär", help: "Löpning kan planeras som vanligt." },
  { value: "sometimes", label: "Känner av ibland", help: "Löpning hålls kort och lätt, alternativ erbjuds alltid." },
  { value: "current", label: "Aktuella besvär", help: "Ingen löpning – crosstrainer och cykel i stället." },
];
const ALL_MOD: Modality[] = ["crosstrainer", "cycling", "indoor_cycling", "running", "walking"];
const DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

export function Settings() {
  const b = useBundle();
  const store = useStore();
  const [p, setP] = useState<Profile>(b.profile);
  const { busy, error, run } = useAsync();
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Profile>) => { setP({ ...p, ...patch }); setSaved(false); };
  const setGoal = (patch: Partial<Profile["goals"]>) => set({ goals: { ...p.goals, ...patch } });
  const thisWeek = weekType(b.today, p);
  const save = () => run(async () => { await store.saveProfile(p); setSaved(true); });
  const time = (s: number | null) => (s ? formatRaceTime(s) : "");
  const parseTime = (v: string) => { const m = v.match(/^(\d{1,3}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  return (
    <div class="stack fade-in">
      <button class="link" style="justify-self:start" onClick={() => history.back()}>← Tillbaka</button>
      <PageHead title="Inställningar" sub="Startvärdena kommer från din beskrivning – ändra fritt." />

      <Card title="Knät" sub="Ange hur det känns nu. Påverkar om löpning föreslås.">
        <div class="stack">{KNEE.map((k) => (
          <button class="chip" style="justify-content:flex-start;min-height:56px;text-align:left;border-radius:14px" aria-pressed={p.kneeStatus === k.value} onClick={() => set({ kneeStatus: k.value })}>
            <span><b>{k.label}</b><br /><span class="tiny">{k.help}</span></span></button>))}</div>
      </Card>

      <Card title="Veckoupplägg" sub="Vecka A: 3 kondition + 2 styrka. Vecka B: 2 kondition + 3 styrka.">
        <div class="stack">
          <div><div class="small" style="margin-bottom:6px">Den här veckan (v{isoWeek(b.today)}) är</div>
            <Seg label="Veckotyp" value={thisWeek} onChange={(v) => set({ weekAParity: (v === "A" ? isoWeek(b.today) % 2 : (isoWeek(b.today) + 1) % 2) as 0 | 1 })} options={[{ value: "A", label: "Vecka A" }, { value: "B", label: "Vecka B" }]} /></div>
          <div><div class="small" style="margin-bottom:6px">Träningsdagar</div>
            <div class="chips">{DAYS.map((d, i) => <button class="chip" aria-pressed={p.trainingDays.includes(i + 1)} onClick={() => set({ trainingDays: p.trainingDays.includes(i + 1) ? p.trainingDays.filter((x) => x !== i + 1) : [...p.trainingDays, i + 1].sort() })}>{d}</button>)}</div></div>
          <div><div class="small" style="margin-bottom:6px">Konditionsformer, i önskad ordning</div>
            <div class="chips">{ALL_MOD.map((m) => { const i = p.enduranceModalities.indexOf(m); return (
              <button class="chip" aria-pressed={i >= 0} onClick={() => set({ enduranceModalities: i >= 0 ? p.enduranceModalities.filter((x) => x !== m) : [...p.enduranceModalities, m] })}>{i >= 0 ? `${i + 1}. ` : ""}{MODALITY_LABEL[m]}</button>); })}</div></div>
          <div class="grid-2">
            <label class="field">Styrkepass (min)<input class="input" type="number" value={p.strengthMinutes} onInput={(e) => set({ strengthMinutes: Number(e.currentTarget.value) })} /></label>
            <label class="field">Lugnt konditionspass (min)<input class="input" type="number" value={p.easyMinutes} onInput={(e) => set({ easyMinutes: Number(e.currentTarget.value) })} /></label>
          </div>
        </div>
      </Card>

      <Card title="Profil och puls">
        <div class="grid-2">
          <label class="field">Födelseår<input class="input" type="number" value={p.birthYear} onInput={(e) => set({ birthYear: Number(e.currentTarget.value) })} /></label>
          <label class="field">Längd (cm)<input class="input" type="number" value={p.heightCm} onInput={(e) => set({ heightCm: Number(e.currentTarget.value) })} /></label>
          <label class="field">Maxpuls (uppskattad)<input class="input" type="number" value={p.maxHr} onInput={(e) => set({ maxHr: Number(e.currentTarget.value) })} /></label>
          <label class="field">Vilopuls (för belastningsberäkning)<input class="input" type="number" value={p.restingHr} onInput={(e) => set({ restingHr: Number(e.currentTarget.value) })} /></label>
          <label class="field">Behaglig lugn puls, från<input class="input" type="number" value={p.comfortableEasyHr?.[0] ?? ""} onInput={(e) => set({ comfortableEasyHr: [Number(e.currentTarget.value), p.comfortableEasyHr?.[1] ?? 140] })} /></label>
          <label class="field">till<input class="input" type="number" value={p.comfortableEasyHr?.[1] ?? ""} onInput={(e) => set({ comfortableEasyHr: [p.comfortableEasyHr?.[0] ?? 135, Number(e.currentTarget.value)] })} /></label>
        </div>
        <p class="tiny muted" style="margin-top:10px">Den behagliga pulsen är din egen upplevelse och används som riktmärke – den behandlas inte som en fysiologisk zon.</p>
      </Card>

      <Card title="Mål">
        <div class="grid-2">
          <label class="field">5 km-mål (mm:ss)<input class="input" inputMode="numeric" placeholder="20:00" value={time(p.goals.run5kTargetS)} onChange={(e) => setGoal({ run5kTargetS: parseTime(e.currentTarget.value) })} /></label>
          <label class="field">10 km-mål (mm:ss)<input class="input" inputMode="numeric" placeholder="40:00" value={time(p.goals.run10kTargetS)} onChange={(e) => setGoal({ run10kTargetS: parseTime(e.currentTarget.value) })} /></label>
          <label class="field">Senaste 5 km (mm:ss)<input class="input" inputMode="numeric" placeholder="23:50" value={time(p.goals.recent5kS)} onChange={(e) => setGoal({ recent5kS: parseTime(e.currentTarget.value) })} /></label>
        </div>
        <div class="chips" style="margin-top:12px">
          <button class="chip" aria-pressed={p.goals.fatLoss} onClick={() => setGoal({ fatLoss: !p.goals.fatLoss })}>Minska fettmassa</button>
          <button class="chip" aria-pressed={p.goals.keepMuscle} onClick={() => setGoal({ keepMuscle: !p.goals.keepMuscle })}>Behålla/bygga muskler</button>
          <button class="chip" aria-pressed={p.goals.fitness} onClick={() => setGoal({ fitness: !p.goals.fitness })}>Bättre kondition</button>
          <button class="chip" aria-pressed={p.useStrengthLog} onClick={() => set({ useStrengthLog: !p.useStrengthLog })}>Jag loggar i StrengthLog</button>
        </div>
      </Card>

      <div class="row" style="position:sticky;bottom:calc(var(--tabbar-h) + 14px + env(safe-area-inset-bottom));z-index:5">
        <button class="btn primary" disabled={busy} onClick={save}>{busy ? "Sparar…" : "Spara inställningar"}</button>
        {saved && <span class="small" style="color:var(--good)">Sparat</span>}
        {error && <span class="small" style="color:var(--attention)">{error}</span>}
      </div>

      <Zones />
      <GarminStatus />
      <DataCard />
    </div>
  );
}

function Zones() {
  const b = useBundle();
  const sports = [["DEFAULT", "Allmänt"], ["RUNNING", "Löpning"], ["CYCLING", "Cykling"]] as const;
  return (
    <Card title="Pulszoner" sub="Hämtas från Garmin Connect. Ändra dem där, så följer de med vid nästa synk.">
      <div class="list">{sports.map(([key, label]) => {
        const z = zonesFor(key === "RUNNING" ? "running" : key === "CYCLING" ? "cycling" : "other", b.zones, b.profile);
        const exact = b.zones.find((x) => x.sport === key);
        return (
          <div class="item" style="align-items:flex-start"><div class="main">
            <div class="t">{label}{!exact && key !== "DEFAULT" ? <span class="muted small"> (använder allmänna)</span> : null}</div>
            <div class="s" style="white-space:normal">{z.source === "garmin" ? "Garmin" : z.source === "manual" ? "Egna" : "Uppskattade från maxpuls"} · {METHOD_LABEL[z.method]}{z.maxHr ? ` · max ${z.maxHr}` : ""}</div>
            <div class="small num" style="margin-top:4px">{z.floors.map((f, i) => `Z${i + 1} ${f}`).join(" · ")}</div>
          </div></div>);
      })}</div>
    </Card>
  );
}

function GarminStatus() {
  const b = useBundle();
  const ds = Object.entries(b.sync.datasets ?? {});
  const NAMES: Record<string, string> = { activities: "Aktiviteter", wellness: "Sömn, HRV, vilopuls", weights: "Vikt", zones: "Pulszoner", streams: "Tidsserier (FIT)" };
  return (
    <Card title="Garmin" sub={b.mode === "demo" ? "Demoläge – ingen koppling" : syncText(b)}>
      <div class="stack">
        {b.mode === "real" && <>
          {b.sync.lastError && <p class="small" style="color:var(--attention)">Senaste fel: {b.sync.lastError}</p>}
          {ds.length > 0 && <div class="list">{ds.map(([k, v]) => <div class="item"><div class="main"><div class="t">{NAMES[k] ?? k}</div><div class="s">{v.note ?? ""}</div></div>
            <div class="r tiny">{v.lastSuccessAt ? stockholmParts(new Date(v.lastSuccessAt)).date : "–"}</div></div>)}</div>}
          <p class="small secondary">API-nyckeln finns bara som hemlighet i GitHub (GARMIN_PERSONAL_API_KEY) och används av synkjobbet. Den skickas aldrig till appen eller webbläsaren. Synk sker automatiskt varannan timme.</p>
        </>}
        <details><summary class="small" style="cursor:pointer">Vad Personal API ger (kapabilitetsöversikt)</summary>
          <div class="list" style="margin-top:8px">{CAPABILITIES.map((c) => (
            <div class="item" style="align-items:flex-start"><span class={`tag ${c.status === "verifierat" ? "good" : c.status === "saknas" ? "attention" : ""}`} style="margin-top:2px">{c.status}</span>
              <div class="main"><div class="t" style="white-space:normal">{c.area}</div><div class="s" style="white-space:normal">{c.note}</div></div></div>))}</div>
        </details>
      </div>
    </Card>
  );
}

function DataCard() {
  const b = useBundle();
  const store = useStore();
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useAsync();
  return (
    <Card title="Dina data">
      <div class="stack">
        {b.mode === "real" ? <>
          <a class="btn" href="/api/export" download>Exportera all data (JSON)</a>
          <div class="divider" />
          <p class="small secondary">Radera allt FORM har sparat: aktiviteter, sömn, vikt, check-ins, plan och inställningar. Din data i Garmin Connect påverkas inte. Nästa synk hämtar Garmin-data igen.</p>
          <label class="field">Skriv RADERA för att bekräfta<input class="input" value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} /></label>
          <button class="btn" disabled={confirm !== "RADERA" || busy} onClick={() => run(() => store.deleteAll())}>Radera all data</button>
          {error && <p class="small" style="color:var(--attention)">{error}</p>}
        </> : <p class="small secondary">I demoläget sparas ingenting. Logga ut för att lämna demon.</p>}
        <div class="divider" />
        <button class="btn" onClick={() => store.logout()}>{b.mode === "demo" ? "Lämna demoläget" : "Logga ut"}</button>
      </div>
    </Card>
  );
}
