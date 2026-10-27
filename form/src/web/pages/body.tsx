import { useState } from "preact/hooks";
import { checkGoal, suggestedGoalDate, TREND_TAU_DAYS } from "../../core/body";
import { addDays, formatDay } from "../../core/dates";
import { explainWeight } from "../../core/insights";
import { LineChart } from "../components/charts";
import { Card, Empty, Explain, PageHead, Seg, Sheet, SourceTag, fmt, useAsync } from "../components/ui";
import { weightSummary } from "../engine";
import { useBundle, useStore } from "../store";

export function Body() {
  const b = useBundle();
  const store = useStore();
  const [days, setDays] = useState<90 | 180 | 365>(90);
  const ws = weightSummary(b);
  const pts = ws.trend.filter((p) => p.date >= addDays(b.today, -days));
  const [sheet, setSheet] = useState<"weight" | "waist" | "goal" | null>(null);
  const goal = b.profile.goals;
  const gc = ws.last && goal.weightTargetKg && goal.weightTargetDate ? checkGoal(ws.last.trend, goal.weightTargetKg, b.today, goal.weightTargetDate) : null;
  const comp = b.weights.filter((w) => w.bodyFatPct != null && w.date >= addDays(b.today, -days));
  const waist = [...b.measurements].filter((m) => m.kind === "waist").sort((x, y) => x.date.localeCompare(y.date));
  const recent = [...b.weights].sort((x, y) => y.measuredAt.localeCompare(x.measuredAt)).slice(0, 6);

  return (
    <div class="stack fade-in">
      <PageHead title="Kropp" sub="Vikt, trend och mått" />
      <div class="vitals">
        <div class="vital"><div class="l">Trend nu</div><div class="v">{ws.last ? fmt(ws.last.trend, 1) : "–"}<small>kg</small></div><div class="d">{ws.last ? `senaste vägning ${formatDay(ws.last.date)}` : "Inga vägningar"}</div></div>
        <div class="vital"><div class="l">4 veckor</div><div class="v">{ws.c4.kg != null ? `${ws.c4.kg > 0 ? "+" : ""}${fmt(ws.c4.kg, 1)}` : "–"}<small>kg</small></div><div class="d">{ws.c4.pctPerWeek != null ? `${fmt(ws.c4.pctPerWeek, 2)} % per vecka` : "för få vägningar"}</div></div>
        <div class="vital"><div class="l">12 veckor</div><div class="v">{ws.c12.kg != null ? `${ws.c12.kg > 0 ? "+" : ""}${fmt(ws.c12.kg, 1)}` : "–"}<small>kg</small></div><div class="d">{ws.c12.pctPerWeek != null ? `${fmt(ws.c12.pctPerWeek, 2)} % per vecka` : "för få vägningar"}</div></div>
        <button class="vital" onClick={() => setSheet("goal")}><div class="l">Viktmål</div><div class="v">{goal.weightTargetKg ? fmt(goal.weightTargetKg, 1) : "–"}<small>kg</small></div>
          <div class={`d ${gc?.verdict === "för snabb" ? "attention" : ""}`}>{gc ? `${gc.verdict}, ${fmt(gc.kgPerWeek, 2)} kg/v` : "Valfritt – tryck för att sätta"}</div></button>
      </div>

      <Card title="Vikt" sub={`Prickar = vägningar, linje = trend (${TREND_TAU_DAYS} dagars utjämning)`} right={<Explain get={() => explainWeight(b)} />}>
        <Seg label="Period" value={days} onChange={setDays} options={[{ value: 90, label: "3 mån" }, { value: 180, label: "6 mån" }, { value: 365, label: "1 år" }]} />
        <div style="margin-top:12px">{pts.length < 2 ? <Empty title="För få vägningar">Väg dig med Index S2 eller lägg in vikten manuellt.</Empty> :
          <LineChart data={pts.map((p) => ({ x: p.date, values: { raw: p.raw, trend: p.trend } }))} series={[{ id: "raw", label: "Vägning", color: "var(--muted)", dotsOnly: true }, { id: "trend", label: "Trend", color: "var(--line-chart)", width: 2.4 }]}
            xFormat={(x) => formatDay(x)} yFormat={(v) => fmt(v, 1)} />}</div>
        {gc && <p class="small secondary" style="margin-top:10px">{gc.text}</p>}
        <div class="row" style="margin-top:12px"><button class="btn small" onClick={() => setSheet("weight")}>Lägg in vikt</button></div>
      </Card>

      <div class="grid-2">
        <Card title="Kroppssammansättning" sub="Index S2 – uppskattning via bioimpedans">
          {comp.length < 2 ? <Empty title="Ingen data">Visas när vågen skickar fettprocent.</Empty> : <>
            <LineChart data={comp.map((w) => ({ x: w.date, values: { v: w.bodyFatPct } }))} series={[{ id: "v", label: "Fettprocent", color: "var(--s-cycling)", dots: true }]} xFormat={(x) => formatDay(x)} yFormat={(v) => fmt(v, 1)} height={150} />
            <p class="tiny muted" style="margin-top:8px">Vågens fettprocent påverkas av vätska, tid på dygnet och träning. Den kan inte ensam avgöra om viktförändringen är fett eller muskler – följ trenden över veckor, tillsammans med midjemått och styrka.</p>
          </>}
        </Card>
        <Card title="Midjemått" sub="Manuellt inmatat" right={<button class="btn small" onClick={() => setSheet("waist")}>Lägg till</button>}>
          {waist.length === 0 ? <Empty title="Inga mått">Mät runt naveln, på morgonen, avslappnat.</Empty> : <>
            {waist.length >= 2 && <LineChart data={waist.map((m) => ({ x: m.date, values: { v: m.valueCm } }))} series={[{ id: "v", label: "Midja", color: "var(--line-chart)", dots: true }]} xFormat={(x) => formatDay(x)} yFormat={(v) => fmt(v, 1)} height={140} />}
            <div class="list">{[...waist].reverse().slice(0, 4).map((m) => <div class="item"><div class="main"><div class="t">{fmt(m.valueCm, 1)} cm</div><div class="s">{formatDay(m.date)}</div></div>
              <button class="link" onClick={() => store.deleteMeasurement(m.id)}>Ta bort</button></div>)}</div>
          </>}
        </Card>
      </div>

      <Card title="Senaste vägningar">
        {recent.length === 0 ? <Empty title="Inga vägningar" /> : <div class="list">{recent.map((w) => (
          <div class="item"><div class="main"><div class="t">{fmt(w.weightKg, 1)} kg</div><div class="s">{formatDay(w.date)} {w.measuredAt.slice(11, 16)}{w.bodyFatPct != null ? ` · fett ${fmt(w.bodyFatPct, 1)} % (uppskattat)` : ""}</div></div>
            <SourceTag source={w.source} />{w.source === "manual" && <button class="link" onClick={() => store.deleteWeight(w.id)}>Ta bort</button>}</div>))}</div>}
      </Card>

      <NumberSheet open={sheet === "weight"} onClose={() => setSheet(null)} title="Lägg in vikt" unit="kg" min={30} max={250} step={0.1} onSave={(d, v) => store.addWeight(d, v)} />
      <NumberSheet open={sheet === "waist"} onClose={() => setSheet(null)} title="Midjemått" unit="cm" min={40} max={200} step={0.5} onSave={(d, v) => store.addMeasurement(d, v)} />
      <GoalSheet open={sheet === "goal"} onClose={() => setSheet(null)} current={ws.last?.trend ?? null} />
    </div>
  );
}

function NumberSheet({ open, onClose, title, unit, min, max, step, onSave }: { open: boolean; onClose: () => void; title: string; unit: string; min: number; max: number; step: number; onSave: (date: string, v: number) => Promise<void> }) {
  const b = useBundle();
  const [date, setDate] = useState(b.today);
  const [value, setValue] = useState("");
  const { busy, error, run, setError } = useAsync();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div class="stack">
        <label class="field">Datum<input class="input" type="date" max={b.today} value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        <label class="field">{unit}<input class="input" type="number" inputMode="decimal" step={step} min={min} max={max} value={value} onInput={(e) => setValue(e.currentTarget.value)} /></label>
        {error && <p class="small" style="color:var(--attention)">{error}</p>}
        <button class="btn primary" disabled={busy || !value} onClick={() => {
          const v = Number(value.replace(",", "."));
          if (!(v >= min && v <= max)) { setError(`Ange ett värde mellan ${min} och ${max}.`); return; }
          run(async () => { await onSave(date, v); setValue(""); onClose(); });
        }}>{busy ? "Sparar…" : "Spara"}</button>
      </div>
    </Sheet>
  );
}

function GoalSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: number | null }) {
  const b = useBundle();
  const store = useStore();
  const g = b.profile.goals;
  const [kg, setKg] = useState(g.weightTargetKg ? String(g.weightTargetKg) : "");
  const [date, setDate] = useState(g.weightTargetDate ?? "");
  const target = Number(kg.replace(",", "."));
  const suggested = current && target ? suggestedGoalDate(current, target, b.today) : null;
  const check = current && target && date ? checkGoal(current, target, b.today, date) : null;
  const { busy, error, run } = useAsync();
  return (
    <Sheet open={open} onClose={onClose} title="Viktmål">
      <div class="stack">
        <p class="secondary small">Ett mål är valfritt. För att behålla muskler brukar 0,5–1 % av kroppsvikten per vecka rekommenderas.</p>
        <label class="field">Målvikt (kg)<input class="input" type="number" inputMode="decimal" value={kg} onInput={(e) => setKg(e.currentTarget.value)} /></label>
        <label class="field">Måldatum<input class="input" type="date" min={b.today} value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        {suggested && <button class="link" style="justify-self:start" onClick={() => setDate(suggested)}>Föreslå datum i lugn takt (0,5 %/vecka): {formatDay(suggested)}</button>}
        {check && <p class="small">{check.text}</p>}
        {error && <p class="small" style="color:var(--attention)">{error}</p>}
        <div class="row">
          <button class="btn primary" disabled={busy} onClick={() => run(async () => { await store.saveProfile({ ...b.profile, goals: { ...g, weightTargetKg: kg ? target : null, weightTargetDate: date || null } }); onClose(); })}>Spara</button>
          {g.weightTargetKg && <button class="btn ghost" onClick={() => run(async () => { await store.saveProfile({ ...b.profile, goals: { ...g, weightTargetKg: null, weightTargetDate: null } }); onClose(); })}>Ta bort mål</button>}
        </div>
      </div>
    </Sheet>
  );
}
