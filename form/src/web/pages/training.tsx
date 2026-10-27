import { useEffect, useMemo, useState } from "preact/hooks";
import { MODALITY_LABEL, SPORT_LABEL, comparableGroup, sessionKind } from "../../core/activities";
import { addDays, formatDay, formatDuration, formatPace, range, weekStart, weekdayName } from "../../core/dates";
import { moveWarnings, proposePlan, viewPlan, weekType, type PlanChange } from "../../core/plan";
import { exerciseProgress, muscleCoverage, parseStrengthCsv, type ParsedCsv } from "../../core/strength";
import { comparisons, intensitySplit, monthlySummary, weeklySummary } from "../../core/trends";
import type { Activity, ActivityStreams, Modality, PlanItem, SessionKind, Sport } from "../../core/types";
import { describeZones, zonesFor } from "../../core/zones";
import { rollingMean } from "../../core/stats";
import { explainIntensity } from "../../core/insights";
import { BarChart, LineChart, ZoneSplit } from "../components/charts";
import { Card, Empty, Explain, Icon, Notice, PageHead, Seg, Sheet, SourceTag, fmt, useAsync } from "../components/ui";
import { navigate } from "../router";
import { useBundle, useStore } from "../store";

export const SPORT_COLOR: Record<Sport, string> = {
  strength: "var(--s-strength)", crosstrainer: "var(--s-crosstrainer)", cycling: "var(--s-cycling)", running: "var(--s-running)", walking: "var(--s-other)", other: "var(--s-other)",
};
const KIND_LABEL: Record<SessionKind, string> = { strength: "Styrka", easy: "Lugn kondition", intervals: "Intervaller", recovery: "Återhämtning", rest: "Vila" };

export function Training({ sub, id }: { sub?: string; id?: string }) {
  const view = sub === "aktivitet" && id ? "detail" : (sub ?? "flode");
  if (view === "detail") return <ActivityDetail id={id!} />;
  return (
    <div class="stack fade-in">
      <PageHead title="Träning" sub="Historik, plan och utveckling" />
      <Seg label="Vy" full value={view} onChange={(v) => navigate(`traning/${v}`)}
        options={[{ value: "flode", label: "Flöde" }, { value: "plan", label: "Plan" }, { value: "trender", label: "Trender" }, { value: "styrka", label: "Styrka" }]} />
      {view === "flode" && <Feed />}
      {view === "plan" && <PlanView />}
      {view === "trender" && <Trends />}
      {view === "styrka" && <Strength />}
    </div>
  );
}

function Feed() {
  const b = useBundle();
  const [filter, setFilter] = useState<Sport | "all">("all");
  const [adding, setAdding] = useState(false);
  const acts = [...b.activities].filter((a) => filter === "all" || a.sport === filter || (filter === "other" && a.sport === "walking")).sort((x, y) => y.startLocal.localeCompare(x.startLocal));
  const filters: (Sport | "all")[] = ["all", "strength", "crosstrainer", "cycling", "running", "other"];
  return (
    <div class="stack">
      <div class="chips" role="group" aria-label="Filter">{filters.map((f) => <button class="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "Alla" : SPORT_LABEL[f]}</button>)}</div>
      <Card title={`${acts.length} pass`} right={<button class="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Lägg till</button>}>
        {acts.length === 0 ? <Empty title="Inga pass">Inget att visa med det här filtret.</Empty> :
          <div class="list">{acts.slice(0, 120).map((a) => <ActivityRow a={a} />)}</div>}
      </Card>
      <AddActivity open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

export function ActivityRow({ a }: { a: Activity }) {
  const b = useBundle();
  const kind = sessionKind(a, b.zones, b.profile);
  return (
    <button class="item" onClick={() => navigate(`traning/aktivitet/${a.id}`)}>
      <span class="swatch" style={`background:${SPORT_COLOR[a.sport]}`} aria-hidden="true" />
      <div class="main">
        <div class="t">{a.name ?? SPORT_LABEL[a.sport]}</div>
        <div class="s">{formatDay(a.date, { weekday: true })} · {SPORT_LABEL[a.sport]}{kind === "intervals" ? " · hårt" : ""}</div>
      </div>
      <div class="r">{formatDuration(a.durationS)}{a.avgHr ? <div class="tiny muted">{Math.round(a.avgHr)} slag/min</div> : null}</div>
    </button>
  );
}

function AddActivity({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBundle();
  const store = useStore();
  const [f, setF] = useState({ date: b.today, sport: "strength" as Sport, minutes: 40, name: "Styrka", rpe: 7 });
  const { busy, error, run } = useAsync();
  return (
    <Sheet open={open} onClose={onClose} title="Lägg till pass">
      <div class="stack">
        <p class="secondary small">För pass utan klockan, t.ex. ett styrkepass du bara loggade i StrengthLog. Märks som manuellt inmatat.</p>
        <label class="field">Datum<input class="input" type="date" value={f.date} max={b.today} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} /></label>
        <label class="field">Typ<select class="input" value={f.sport} onChange={(e) => setF({ ...f, sport: e.currentTarget.value as Sport })}>
          {(["strength", "crosstrainer", "cycling", "running", "walking", "other"] as Sport[]).map((s) => <option value={s}>{SPORT_LABEL[s]}</option>)}</select></label>
        <label class="field">Namn<input class="input" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} /></label>
        <label class="field">Minuter<input class="input" type="number" inputMode="numeric" value={f.minutes} onInput={(e) => setF({ ...f, minutes: Number(e.currentTarget.value) })} /></label>
        <label class="field">Upplevd ansträngning (RPE 1–10)<input class="input" type="number" min={1} max={10} value={f.rpe} onInput={(e) => setF({ ...f, rpe: Number(e.currentTarget.value) })} /></label>
        {error && <p class="small" style="color:var(--attention)">{error}</p>}
        <button class="btn primary" disabled={busy} onClick={() => run(async () => { await store.addActivity(f); onClose(); })}>{busy ? "Sparar…" : "Spara"}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ detail

function ActivityDetail({ id }: { id: string }) {
  const b = useBundle();
  const store = useStore();
  const a = b.activities.find((x) => x.id === id);
  const [streams, setStreams] = useState<ActivityStreams | null | "loading">("loading");
  const [rpe, setRpe] = useState<number | null>(a?.rpe ?? null);
  const [note, setNote] = useState(a?.note ?? "");
  const { busy, run } = useAsync();
  useEffect(() => { if (a?.hasStreams) store.streams(id).then(setStreams).catch(() => setStreams(null)); else setStreams(null); }, [id]);
  if (!a) return <div class="stack"><button class="link" onClick={() => history.back()}>← Tillbaka</button><Empty title="Passet hittades inte" /></div>;
  const zones = zonesFor(a.sport, b.zones, b.profile);
  const z = a.zoneSeconds;
  const similar = b.activities.filter((x) => x.id !== a.id && comparableGroup(x) === comparableGroup(a)).length;
  const facts: [string, string][] = [
    ["Tid", formatDuration(a.durationS)], ...(a.distanceM ? [["Distans", `${fmt(a.distanceM / 1000, 2)} km`] as [string, string]] : []),
    ...(a.avgHr ? [["Snittpuls", `${Math.round(a.avgHr)}`] as [string, string]] : []), ...(a.maxHr ? [["Maxpuls", `${Math.round(a.maxHr)}`] as [string, string]] : []),
    ...(a.avgSpeed && a.sport === "running" ? [["Tempo", formatPace(a.avgSpeed)] as [string, string]] : []),
    ...(a.avgSpeed && a.sport === "cycling" ? [["Fart", `${fmt(a.avgSpeed * 3.6, 1)} km/h`] as [string, string]] : []),
    ...(a.avgPower ? [["Effekt", `${Math.round(a.avgPower)} W`] as [string, string]] : []), ...(a.avgCadence ? [["Kadens", `${Math.round(a.avgCadence)}`] as [string, string]] : []),
    ...(a.aerobicTe ? [["Training Effect (Garmin)", `${fmt(a.aerobicTe, 1)} / ${fmt(a.anaerobicTe, 1)}`] as [string, string]] : []),
  ];
  const s = streams !== "loading" ? streams : null;
  // Display only: 30 s rolling mean (3 samples of 10 s). Stored data is untouched.
  const pts = (k: "hr" | "speed" | "power" | "cadence" | "altitude", f: (v: number) => number = (v) => v) => {
    if (!s?.[k]) return null;
    const smooth = rollingMean(s[k]!, 3);
    return s.t.map((t, i) => ({ x: String(t), values: { v: s[k]![i] == null || smooth[i] == null ? null : f(smooth[i]!) } }));
  };
  const mm = (x: string) => `${Math.floor(Number(x) / 60)}′`;
  return (
    <div class="stack fade-in">
      <button class="link" style="justify-self:start" onClick={() => history.back()}>← Tillbaka</button>
      <PageHead title={a.name ?? SPORT_LABEL[a.sport]} sub={<>{formatDay(a.date, { weekday: true })} {a.startLocal.slice(11, 16)} · {SPORT_LABEL[a.sport]} <SourceTag source={a.source} /></>} />
      <Card>
        <div class="row" style="gap:22px">{facts.map(([l, v]) => <div class="fact"><div class="v">{v}</div><div class="l">{l}</div></div>)}</div>
      </Card>
      {a.sport === "strength" && <StrengthSessionCard a={a} />}
      {z && <Card title="Tid i pulszoner" sub={describeZones(zones)}>
        <BarChart data={z.map((sec, i) => ({ label: `Zon ${i + 1}`, values: { m: sec / 60 } }))} series={[{ id: "m", label: "Minuter", color: "var(--s-strength)" }]} height={150} yFormat={(v) => `${Math.round(v)}`} />
      </Card>}
      {streams === "loading" && <div class="skeleton" style="height:180px" />}
      {s && <>
        {pts("hr") && <Card title="Puls" sub="slag/min · utjämnat över 30 s"><LineChart data={pts("hr")!} series={[{ id: "v", label: "Puls", color: "var(--line-chart)" }]} xFormat={mm} /></Card>}
        {pts("speed") && a.sport === "running" && <Card title="Tempo" sub="min/km (lägre är snabbare)"><LineChart data={pts("speed", (v) => (v > 0.5 ? 1000 / v / 60 : NaN))!} series={[{ id: "v", label: "Tempo", color: "var(--s-running)" }]} xFormat={mm} yFormat={(v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`} /></Card>}
        {pts("speed") && a.sport !== "running" && a.sport !== "crosstrainer" && <Card title="Fart" sub="km/h"><LineChart data={pts("speed", (v) => v * 3.6)!} series={[{ id: "v", label: "Fart", color: "var(--s-cycling)" }]} xFormat={mm} /></Card>}
        {pts("power") && <Card title="Effekt" sub={a.sport === "crosstrainer" ? "watt enligt maskinen – jämför bara pass på samma maskin" : "watt"}><LineChart data={pts("power")!} series={[{ id: "v", label: "Effekt", color: "var(--s-cycling)" }]} xFormat={mm} /></Card>}
        {pts("cadence") && <Card title="Kadens"><LineChart data={pts("cadence")!} series={[{ id: "v", label: "Kadens", color: "var(--s-other)" }]} xFormat={mm} /></Card>}
        {s.laps.length > 1 && <Card title="Varv">
          <div class="table-wrap"><table class="laps"><thead><tr><th>Varv</th><th>Tid</th><th>Distans</th><th>Puls</th>{a.sport === "running" ? <th>Tempo</th> : <th>Effekt</th>}</tr></thead>
            <tbody>{s.laps.map((l) => <tr><td>{l.index}</td><td>{formatDuration(l.durationS)}</td><td>{l.distanceM ? `${fmt(l.distanceM / 1000, 2)} km` : "–"}</td><td>{fmt(l.avgHr)}</td>
              <td>{a.sport === "running" ? formatPace(l.avgSpeed) : l.avgPower ? `${Math.round(l.avgPower)} W` : "–"}</td></tr>)}</tbody></table></div>
        </Card>}
      </>}
      {streams === null && a.source === "garmin" && <Notice kind="info">Tidsserier för passet har inte hämtats än. De laddas ner från Garmin vid nästa synk.</Notice>}
      {a.source !== "strengthlog" && <Card title="Din upplevelse" sub="Valfritt – hjälper coachen att förstå hur passen känns.">
        <div class="stack">
          <div class="small">RPE (1 = mycket lätt, 10 = maximalt)</div>
          <div class="chips">{[3, 4, 5, 6, 7, 8, 9].map((n) => <button class="chip" aria-pressed={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}>{n}</button>)}</div>
          <textarea class="input" placeholder="Anteckning, t.ex. hur knät kändes" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          <button class="btn" disabled={busy} onClick={() => run(() => store.patchActivity(a.id, { rpe, note: note || null }))}>{busy ? "Sparar…" : "Spara"}</button>
        </div>
      </Card>}
      {a.sport !== "strength" && <p class="muted small">{similar >= 5 ? `${similar} jämförbara pass (${SPORT_LABEL[a.sport].toLowerCase()}, samma miljö) finns i Trender.` : "För få jämförbara pass för en rättvis jämförelse än."}</p>}
    </div>
  );
}

const yearDay = (d: string) => `${formatDay(d)} ${d.slice(0, 4)}`;

function StrengthSessionCard({ a }: { a: Activity }) {
  const b = useBundle();
  const sets = b.strength.filter((s) => (a.source === "strengthlog" ? s.sessionId === a.id : s.date === a.date));
  if (!sets.length) return a.source === "garmin" ? <p class="muted small">Inga set från StrengthLog den här dagen.</p> : null;
  const byEx = new Map<string, typeof sets>();
  for (const s of sets) byEx.set(s.exercise, [...(byEx.get(s.exercise) ?? []), s]);
  return (
    <Card title="Övningar" sub={`Från StrengthLog · ${sets.length} set`}>
      <div class="list">{[...byEx.entries()].map(([ex, ss]) => (
        <div class="item"><div class="main"><div class="t">{ex}</div>
          <div class="s" style="white-space:normal">{ss.sort((x, y) => x.setIndex - y.setIndex).map((s) => `${s.reps ?? "–"} × ${s.weightKg != null ? `${fmt(s.weightKg, s.weightKg % 1 ? 1 : 0)} kg` : "kroppsvikt"}`).join(" · ")}</div></div></div>))}</div>
    </Card>
  );
}

// ------------------------------------------------------------------ plan

function PlanView() {
  const b = useBundle();
  const store = useStore();
  const monday = weekStart(b.today);
  const days = range(monday, addDays(monday, 13));
  const { views, extras } = viewPlan(b.plan.filter((p) => p.date >= monday), b.activities.filter((a) => a.date >= monday), b.zones, b.profile, b.today);
  const [proposal, setProposal] = useState<PlanChange[] | null>(null);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const { busy, error, run } = useAsync();
  const hasFuture = b.plan.some((p) => p.date >= b.today);
  return (
    <div class="stack">
      <Card title="Rullande tvåveckorsplan" sub={`Vecka ${weekType(monday, b.profile)} och ${weekType(addDays(monday, 7), b.profile)} · ändringar sparas först när du godkänner dem`}
        right={<button class="btn small" onClick={() => setProposal(proposePlan({ today: b.today, plan: b.plan, activities: b.activities, zones: b.zones, profile: b.profile }))}>{hasFuture ? "Föreslå justering" : "Skapa plan"}</button>}>
        <div class="list">{days.map((d) => {
          const items = views.filter((v) => v.item.date === d);
          const extra = extras.filter((a) => a.date === d);
          return (
            <div class="item" style={d === b.today ? "background:var(--raised);border-radius:12px;padding-left:10px" : ""}>
              <div style="width:64px;flex:none"><div class="small" style="text-transform:capitalize">{weekdayName(d, true)} {Number(d.slice(8))}</div>{d === b.today && <div class="tiny muted">idag</div>}</div>
              <div class="main" style="display:grid;gap:6px">
                {items.length === 0 && extra.length === 0 && <span class="muted small">–</span>}
                {items.map((v) => (
                  <button class="row" style="background:none;border:0;padding:0;text-align:left;justify-content:space-between;width:100%" onClick={() => setEditing(v.item)}>
                    <span><b style={v.state === "skipped" ? "text-decoration:line-through;color:var(--muted)" : ""}>{KIND_LABEL[v.item.kind]}</b>
                      <span class="muted small"> · {v.item.minutes} min{v.item.modality && v.item.kind !== "strength" ? ` · ${MODALITY_LABEL[v.item.modality]}` : ""}</span></span>
                    <span class={`tag ${v.state === "done" ? "good" : v.state === "missed" ? "attention" : ""}`}>{({ done: "Gjort", missed: "Missat", planned: "Planerat", today: "Idag", skipped: "Överhoppat" } as const)[v.state]}</span>
                  </button>))}
                {extra.map((a) => <button class="row small" style="background:none;border:0;padding:0;color:var(--text-2)" onClick={() => navigate(`traning/aktivitet/${a.id}`)}>+ {a.name ?? SPORT_LABEL[a.sport]} (oplanerat)</button>)}
              </div>
            </div>
          );
        })}</div>
      </Card>
      <p class="muted small">Missade hårda pass flyttas aldrig automatiskt. Max ett intervallpass per vecka och minst 48 timmar mellan hårda pass.</p>

      <Sheet open={!!proposal} onClose={() => setProposal(null)} title="Förslag på plan">
        {proposal && (proposal.length === 0 ? <p class="secondary">Planen följer redan ditt upplägg – inget att ändra.</p> : (
          <div class="stack">
            <p class="secondary">Granska ändringarna. Inget sparas förrän du godkänner.</p>
            <div class="list">{proposal.map((c) => (
              <div class="item"><div class="main"><div class="t">{formatDay(c.date, { weekday: true })}: {c.type === "add" ? "Nytt" : "Ändras till"} {KIND_LABEL[c.after.kind].toLowerCase()}, {c.after.minutes} min</div>
                <div class="s" style="white-space:normal">{c.before ? `Tidigare: ${KIND_LABEL[c.before.kind].toLowerCase()}. ` : ""}{c.reason}</div></div></div>))}</div>
            {error && <p class="small" style="color:var(--attention)">{error}</p>}
            <div class="row">
              <button class="btn primary" disabled={busy} onClick={() => run(async () => {
                await store.savePlan(proposal.map((c) => ({ ...(c.before ? { id: c.before.id } : {}), ...c.after })));
                setProposal(null);
              })}>{busy ? "Sparar…" : "Godkänn"}</button>
              <button class="btn ghost" onClick={() => setProposal(null)}>Avbryt</button>
            </div>
          </div>))}
      </Sheet>
      {editing && <EditItem item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditItem({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const b = useBundle();
  const store = useStore();
  const [date, setDate] = useState(item.date);
  const [kind, setKind] = useState<SessionKind>(item.kind);
  const [modality, setModality] = useState<Modality | null>(item.modality);
  const [minutes, setMinutes] = useState(item.minutes);
  const warnings = date !== item.date ? moveWarnings(b.plan, item.id, date) : [];
  const { busy, error, run } = useAsync();
  const options = range(b.today, addDays(weekStart(b.today), 13));
  return (
    <Sheet open onClose={onClose} title="Ändra pass">
      <div class="stack">
        <label class="field">Dag<select class="input" value={date} onChange={(e) => setDate(e.currentTarget.value)}>
          {[...new Set([item.date, ...options])].map((d) => <option value={d}>{formatDay(d, { weekday: true })}</option>)}</select></label>
        <label class="field">Pass<select class="input" value={kind} onChange={(e) => setKind(e.currentTarget.value as SessionKind)}>
          {(Object.keys(KIND_LABEL) as SessionKind[]).map((k) => <option value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        {(kind === "easy" || kind === "intervals") && <label class="field">Aktivitet<select class="input" value={modality ?? ""} onChange={(e) => setModality(e.currentTarget.value as Modality)}>
          {b.profile.enduranceModalities.map((m) => <option value={m}>{MODALITY_LABEL[m]}</option>)}</select></label>}
        <label class="field">Minuter<input class="input" type="number" value={minutes} onInput={(e) => setMinutes(Number(e.currentTarget.value))} /></label>
        {warnings.map((w) => <Notice>{w}</Notice>)}
        {error && <p class="small" style="color:var(--attention)">{error}</p>}
        <div class="row">
          <button class="btn primary" disabled={busy} onClick={() => run(async () => { await store.savePlan([{ ...item, date, kind, modality: kind === "strength" ? "gym" : modality, minutes }]); onClose(); })}>Spara</button>
          <button class="btn" disabled={busy} onClick={() => run(async () => { await store.savePlan([{ ...item, status: item.status === "skipped" ? "planned" : "skipped" }]); onClose(); })}>{item.status === "skipped" ? "Ångra överhoppning" : "Hoppa över"}</button>
          <button class="btn ghost" disabled={busy} onClick={() => run(async () => { await store.savePlan([], [item.id]); onClose(); })}>Ta bort</button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ trends

function Trends() {
  const b = useBundle();
  const weeks = useMemo(() => weeklySummary(b.activities, b.zones, b.profile, b.today, 12), [b]);
  const months = monthlySummary(b.activities, b.today, 6);
  const split = intensitySplit(b.activities, b.zones, b.profile, addDays(b.today, -27), b.today);
  const comps = useMemo(() => comparisons(b.activities, b.profile), [b]);
  const sports: Sport[] = ["strength", "crosstrainer", "cycling", "running", "walking"];
  const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return (
    <div class="stack">
      <Card title="Träningstid per vecka" sub="Minuter, senaste 12 veckorna">
        <BarChart data={weeks.map((w) => ({ label: `v${isoW(w.week)}`, values: Object.fromEntries(sports.map((s) => [s, w.minutes[s]])) }))}
          series={sports.filter((s) => weeks.some((w) => w.minutes[s] > 0)).map((s) => ({ id: s, label: SPORT_LABEL[s], color: SPORT_COLOR[s] }))}
          yFormat={(v) => `${Math.round(v)}`} tooltipFooter={(i) => `${weeks[i].sessions} pass, varav ${weeks[i].hard} hårda`} />
      </Card>
      <div class="grid-2">
        <Card title="Intensitetsfördelning" sub="Kondition, senaste 4 veckorna" right={<Explain get={() => explainIntensity(b)} />}>
          {split ? <><ZoneSplit {...split} />{split.estimatedShare > 0.3 && <p class="tiny muted" style="margin-top:8px">{Math.round(split.estimatedShare * 100)} % uppskattat från snittpuls (pass utan FIT-data).</p>}</>
            : <Empty title="Ingen pulsdata">Inga konditionspass med puls senaste 4 veckorna.</Empty>}
        </Card>
        <Card title="Per månad" sub="Timmar och antal pass">
          <BarChart data={months.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], values: { h: m.minutes / 60 } }))} series={[{ id: "h", label: "Timmar", color: "var(--s-strength)" }]}
            yFormat={(v) => fmt(v, v < 10 ? 1 : 0)} height={150} tooltipFooter={(i) => `${months[i].sessions} pass`} />
        </Card>
      </div>
      <h3 class="section-title">Jämförbara pass</h3>
      {comps.length === 0 && <Card><Empty title="Inga jämförelser än">Det behövs minst några lugna pass av samma typ (minst 20 min) för att jämföra.</Empty></Card>}
      {comps.map((c) => (
        <Card title={c.title} sub={`${c.points.length} pass · ${c.unit}`}>
          <LineChart data={c.points.map((p) => ({ x: p.date, values: { v: p.value } }))} series={[{ id: "v", label: c.title, color: "var(--line-chart)", dots: true }]}
            xFormat={(x) => formatDay(x)} yFormat={(v) => fmt(v, c.unit === "slag/min" ? 0 : 2)} />
          <p class="small secondary" style="margin-top:10px">
            {!c.enough ? "För få pass för en trend – minst sex behövs." : c.trendPerMonth != null ? `Trend: ${c.trendPerMonth > 0 ? "+" : ""}${fmt(c.trendPerMonth, 3)} ${c.unit} per månad.` : ""}
          </p>
          {c.caveats.map((x) => <p class="tiny muted">{x}</p>)}
        </Card>
      ))}
    </div>
  );
}

const isoW = (d: string) => { const x = new Date(Date.parse(d) + 3 * 86400000); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 4)); return 1 + Math.round((x.getTime() - y.getTime()) / 604800000); };

// ------------------------------------------------------------------ strength

function Strength() {
  const b = useBundle();
  const store = useStore();
  const weeks = weeklySummary(b.activities, b.zones, b.profile, b.today, 8);
  // Last 12 weeks only: over longer periods, program changes look like regression.
  const progress = exerciseProgress(b.strength.filter((x) => x.date >= addDays(b.today, -84)), 4);
  const coverage = muscleCoverage(b.strength, b.today);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const { busy, error, run, setError } = useAsync();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div class="stack">
      <Card title="Styrkepass per vecka" sub="Från Garmin, StrengthLog och manuellt inlagda pass (räknas en gång per dag)">
        <BarChart data={weeks.map((w) => ({ label: `v${isoW(w.week)}`, values: { s: w.strength } }))} series={[{ id: "s", label: "Styrkepass", color: "var(--s-strength)" }]} height={140} />
      </Card>
      <Card title="StrengthLog" sub="Fortsätt logga i StrengthLog. Importera exporten här när du vill se progression och volym.">
        <div class="stack">
          <label class="btn" style="cursor:pointer">Välj CSV-fil från StrengthLog
            <input type="file" accept=".csv,text/csv,text/plain" style="display:none" onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              const p = parseStrengthCsv(await f.text());
              setDone(null);
              if (!p.sets.length) setError("Hittade inga set i filen. Kontrollera att det är StrengthLogs export (CSV) med kolumner för datum och övning.");
              setParsed(p);
            }} /></label>
          {parsed && parsed.sets.length > 0 && <div class="stack">
            <p class="small">Hittade <b>{parsed.sets.length}</b> set från <b>{parsed.sessions}</b> pass ({yearDay(parsed.sets.reduce((m, x) => (x.date < m ? x.date : m), parsed.sets[0].date))} – {yearDay(parsed.sets.reduce((m, x) => (x.date > m ? x.date : m), parsed.sets[0].date))}).
              {parsed.warmups ? ` ${parsed.warmups} uppvärmningsset räknas inte.` : ""}{parsed.skipped ? ` ${parsed.skipped} rader kunde inte läsas.` : ""}</p>
            <p class="tiny muted">Samma pass importeras aldrig två gånger – du kan importera en ny export när du vill.</p>
            <button class="btn primary" disabled={busy} onClick={() => run(async () => {
              const n = await store.importStrength(parsed.sets, (d) => setDone(`Importerar… ${d} av ${parsed.sets.length} set`));
              setDone(`${n} set från ${parsed.sessions} pass importerade.`); setParsed(null);
            })}>{busy ? "Importerar…" : "Importera"}</button>
          </div>}
          {done && <p class="small" style="color:var(--good)">{done}</p>}
          {error && <p class="small" style="color:var(--attention)">{error}</p>}
          <p class="tiny muted">I StrengthLog: Inställningar → Exportera data. Filen läses i telefonen och bara seten sparas. Formatet är inte officiellt dokumenterat – säg till om importen missar något.</p>
        </div>
      </Card>
      <Card title="Muskelgrupper senaste 4 veckorna" sub="Antal set, tolkat från övningsnamn">
        {b.strength.length === 0 ? <Empty title="Inget underlag">Täckning och progression visas när det finns set med övning, vikt och repetitioner.</Empty> :
          <BarChart data={coverage.map((c) => ({ label: c.group.split(" ")[0], values: { s: c.sets } }))} series={[{ id: "s", label: "Set", color: "var(--s-strength)" }]} height={150} />}
      </Card>
      {progress.slice(0, 6).map((p) => (
        <Card title={p.exercise} sub={`Uppskattat 1RM (Epley), senaste 12 veckorna · ${p.sessions.length} pass${p.changePct != null ? ` · ${p.changePct >= 0 ? "+" : ""}${fmt(p.changePct, 1)} %` : ""}`}>
          <LineChart data={p.sessions.map((s) => ({ x: s.date, values: { v: s.best } }))} series={[{ id: "v", label: "1RM", color: "var(--s-strength)", dots: true }]} xFormat={(x) => formatDay(x)} yFormat={(v) => `${Math.round(v)}`} height={150} />
        </Card>
      ))}
    </div>
  );
}
