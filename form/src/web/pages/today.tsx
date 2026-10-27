import { useMemo, useState } from "preact/hooks";
import { addDays, formatDay, formatDuration, range, weekStart, weekdayName } from "../../core/dates";
import { effectivePlan, viewPlan } from "../../core/plan";
import { mean, round } from "../../core/stats";
import type { CheckIn, Modality, PainArea, SessionKind } from "../../core/types";
import { Sparkline } from "../components/charts";
import { Icon, Notice, PageHead, Seg, Sheet, fmt, useAsync } from "../components/ui";
import { WorkoutDetails, kindLabel } from "../components/workout";
import { brief, dataHealth, greeting, suggestion, syncText, weightSummary } from "../engine";
import { navigate } from "../router";
import { useBundle, useStore } from "../store";

const CAT_CLASS = { ready: "ready", normal: "normal", easy: "easy", recover: "recover" } as const;

export function Today() {
  const b = useBundle();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [swap, setSwap] = useState<{ kind: SessionKind; modality: Modality | null } | null>(null);
  const [sheet, setSheet] = useState<"workout" | "swap" | "recovery" | null>(null);
  const s = useMemo(() => suggestion(b, { minutes: minutes ?? undefined, kind: swap?.kind, modality: swap?.modality }), [b, minutes, swap]);
  const health = dataHealth(b);
  const w = s.workout;
  const r = s.recovery;

  return (
    <div class="stack fade-in">
      <PageHead title={greeting()} sub={formatDay(b.today, { weekday: true })}
        actions={<button class="icon-btn" aria-label="Inställningar" onClick={() => navigate("installningar")}><Icon name="settings" /></button>} />

      <div class="today-grid">
        <div class="stack">
          <section class="hero">
            <p class="eyebrow">Dagens läge</p>
            <p class="brief">{brief(b, s)}</p>
            <button class={`state ${CAT_CLASS[r.category]}`} onClick={() => setSheet("recovery")} aria-label={`${r.title}, säkerhet ${r.confidence}. Visa underlag.`}>
              <span class="dot" />{r.title}<span class="conf">· {r.confidence} säkerhet</span>
            </button>
            <p class="muted tiny" style="margin-top:8px">Appens uppskattning – inte Garmins Training Readiness.</p>
          </section>

          <section class="session">
            <div class="spread"><span class="kind">{swap ? "Ditt val" : s.planned ? "Dagens pass" : "Förslag"} · {kindLabel(w)}</span>
              {swap && <button class="link" onClick={() => setSwap(null)}>Återställ</button>}</div>
            <h2>{w.title}</h2>
            {w.kind !== "rest" && <div class="facts">
              <div class="fact"><div class="v">{w.minutes} min</div><div class="l">Tid</div></div>
              <div class="fact"><div class="v">{w.intensity.rpe.replace(" av 10", "").split(/,| –/)[0]}</div><div class="l">Ansträngning</div></div>
            </div>}
            <p class="purpose">{w.purpose}</p>
            {w.kind !== "rest" && <div style="margin-top:16px">
              <p class="small muted" style="margin-bottom:8px">Jag har</p>
              <Seg label="Tillgänglig tid" full value={minutes ?? 0} onChange={(v) => setMinutes(v === 0 ? null : v)}
                options={[{ value: 0, label: "Planerat" }, { value: 20, label: "20 min" }, { value: 40, label: "40 min" }, { value: 60, label: "60 min" }]} />
            </div>}
            <div class="row" style="margin-top:14px">
              <button class="btn primary" onClick={() => setSheet("workout")}>Visa passet</button>
              <button class="btn" onClick={() => setSheet("swap")}>Byt aktivitet</button>
            </div>
            {s.reasons[0] && <p class="small secondary" style="margin-top:14px"><b>Därför:</b> {s.reasons.filter((x) => x.source !== "plan").map((x) => x.text)[0] ?? s.reasons[0].text}</p>}
          </section>
          {s.notices.filter((n) => /smärta|1177/.test(n)).map((n) => <Notice>{n}</Notice>)}
        </div>

        <div class="stack">
          <CheckInCard />
          <Vitals />
          <WeekCard />
        </div>
      </div>

      {(health.stale || health.missing.length > 0 || b.sync.lastError) && b.mode === "real" && (
        <Notice>
          {b.sync.lastError ? <>Senaste synken misslyckades: {b.sync.lastError} </> : null}
          {health.stale && !b.sync.lastError ? "Data är äldre än sex timmar. " : null}
          {health.missing.length > 0 && <>Saknas för idag: {health.missing.join(", ")}. Bedömningen görs utan dessa.</>}
        </Notice>
      )}
      <SyncLine />

      <Sheet open={sheet === "workout"} onClose={() => setSheet(null)} title={w.title}><WorkoutDetails s={s} /></Sheet>
      <Sheet open={sheet === "swap"} onClose={() => setSheet(null)} title="Byt aktivitet">
        <div class="stack">
          <p class="secondary">Välj något annat som passar idag. Förslaget anpassas fortfarande efter din återhämtning och eventuell smärta.</p>
          {s.alternatives.map((a) => <button class="btn block" onClick={() => { setSwap({ kind: a.kind, modality: a.modality }); setSheet(null); }}>{a.label}</button>)}
        </div>
      </Sheet>
      <Sheet open={sheet === "recovery"} onClose={() => setSheet(null)} title={r.title}>
        <div class="stack">
          <p>{r.summary}</p>
          <p class="small muted">Säkerhet: {r.confidence}. {r.disclaimer}</p>
          <div class="list">{r.signals.map((sig) => (
            <div class="item" style="align-items:flex-start">
              <span class={`tag ${sig.state === "ok" ? "good" : sig.state === "unknown" ? "" : "attention"}`} style="margin-top:2px">{({ ok: "Normal", watch: "Avviker", strain: "Avviker tydligt", unknown: "Saknas" } as const)[sig.state]}</span>
              <div class="main"><div class="t">{sig.label} <span class="muted small">· {sig.subjective ? "din check-in" : sig.source === "computed" ? "beräknat" : "Garmin"}</span></div>
                <div class="small secondary" style="white-space:normal">{sig.observation}</div>
                {sig.interpretation && <div class="small muted" style="white-space:normal">{sig.interpretation}</div>}</div>
            </div>))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function SyncLine() {
  const b = useBundle();
  const store = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, run } = useAsync();
  return (
    <div class="sync-line">
      <span>{syncText(b)}</span>
      {b.mode === "real" && <button class="link" disabled={busy} onClick={() => run(async () => {
        await store.refresh();
        if (b.syncButton) { const r = await store.syncNow(); setMsg(r.message); }
        else setMsg("Uppdaterad från servern. Ny Garmin-data hämtas automatiskt varannan timme.");
      })}>{busy ? "Uppdaterar…" : "Uppdatera"}</button>}
      {msg && <span class="tiny" style="flex-basis:100%">{msg}</span>}
    </div>
  );
}

const PAIN_LABEL = ["Ingen", "Lätt", "Måttlig", "Kraftig"];
const AREA_LABEL: Record<PainArea, string> = { knee: "Knä", back: "Rygg", shoulder: "Axel", other: "Annat" };

export function CheckInCard() {
  const b = useBundle();
  const store = useStore();
  const existing = b.checkins.find((c) => c.date === b.today);
  const [editing, setEditing] = useState(!existing);
  const [form, setForm] = useState<CheckIn>(existing ?? { date: b.today, energy: null, soreness: null, stress: null, pain: 0, painAreas: [], minutesAvailable: null, note: null, updatedAt: "" });
  const { busy, error, run } = useAsync();
  const set = (patch: Partial<CheckIn>) => setForm({ ...form, ...patch });

  if (!editing && existing) {
    return (
      <section class="card">
        <div class="spread"><h3>Dagens check-in</h3><button class="link" onClick={() => setEditing(true)}>Ändra</button></div>
        <p class="secondary small" style="margin-top:6px">
          Energi {existing.energy ?? "–"}/5 · Träningsvärk {existing.soreness ?? "–"}/5 · Stress {existing.stress ?? "–"}/5
          {existing.pain > 0 && ` · ${PAIN_LABEL[existing.pain]} smärta (${existing.painAreas.map((a) => AREA_LABEL[a].toLowerCase()).join(", ") || "ospec."})`}
          {existing.minutesAvailable ? ` · ${existing.minutesAvailable} min` : ""}
        </p>
      </section>
    );
  }
  const scale = (label: string, key: "energy" | "soreness" | "stress", lo: string, hi: string) => (
    <div>
      <div class="spread small" style="margin-bottom:6px"><span>{label}</span><span class="muted tiny">{lo} → {hi}</span></div>
      <div class="scale" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((n) => <button type="button" class="chip" aria-pressed={form[key] === n} onClick={() => set({ [key]: n })}>{n}</button>)}</div>
    </div>
  );
  return (
    <section class="card">
      <div class="card-head"><div><h3>Hur känns det idag?</h3><p class="card-sub">Tar tio sekunder. Din känsla väger tyngre än klockan.</p></div></div>
      <div class="stack">
        {scale("Energi", "energy", "låg", "hög")}
        {scale("Träningsvärk", "soreness", "ingen", "mycket")}
        {scale("Stress", "stress", "låg", "hög")}
        <div>
          <div class="small" style="margin-bottom:6px">Smärta eller knäbesvär</div>
          <div class="chips">{PAIN_LABEL.map((l, i) => <button type="button" class="chip" aria-pressed={form.pain === i} onClick={() => set({ pain: i as CheckIn["pain"], painAreas: i === 0 ? [] : form.painAreas })}>{l}</button>)}</div>
          {form.pain > 0 && <div class="chips" style="margin-top:8px">{(Object.keys(AREA_LABEL) as PainArea[]).map((a) => (
            <button type="button" class="chip" aria-pressed={form.painAreas.includes(a)} onClick={() => set({ painAreas: form.painAreas.includes(a) ? form.painAreas.filter((x) => x !== a) : [...form.painAreas, a] })}>{AREA_LABEL[a]}</button>))}</div>}
        </div>
        <div>
          <div class="small" style="margin-bottom:6px">Tid för träning idag</div>
          <div class="chips">{[null, 20, 40, 60, 90].map((m) => <button type="button" class="chip" aria-pressed={form.minutesAvailable === m} onClick={() => set({ minutesAvailable: m })}>{m == null ? "Som planerat" : `${m} min`}</button>)}</div>
        </div>
        {error && <p class="small" style="color:var(--attention)">{error}</p>}
        <div class="row">
          <button class="btn primary" disabled={busy} onClick={() => run(async () => { await store.saveCheckin({ ...form, updatedAt: new Date().toISOString() }); setEditing(false); })}>{busy ? "Sparar…" : "Spara"}</button>
          {existing && <button class="btn ghost" onClick={() => setEditing(false)}>Avbryt</button>}
        </div>
      </div>
    </section>
  );
}

function Vitals() {
  const b = useBundle();
  const days = range(addDays(b.today, -13), b.today);
  const byDate = new Map(b.wellness.map((w) => [w.date, w]));
  const night = byDate.get(b.today);
  const usualSleep = mean(b.wellness.filter((w) => w.date < b.today && w.date >= addDays(b.today, -28)).map((w) => w.sleepS));
  const hrv7 = mean(days.slice(-7).map((d) => byDate.get(d)?.hrvLastNight));
  const latestBase = [...b.wellness].reverse().find((w) => w.hrvBaselineLow != null);
  const rhrLast = [...b.wellness].reverse().find((w) => w.restingHr != null && w.date >= addDays(b.today, -1));
  const rhrMed = mean(b.wellness.filter((w) => w.date < b.today && w.date >= addDays(b.today, -30)).map((w) => w.restingHr));
  const ws = weightSummary(b);
  const hrvState = hrv7 == null || !latestBase ? null : hrv7 < latestBase.hrvBaselineLow! ? "attention" : "good";
  return (
    <div class="vitals">
      <button class="vital" onClick={() => navigate("aterhamtning")}>
        <div class="l">Sömn i natt</div>
        <div class="v">{night?.sleepS ? formatDuration(night.sleepS).replace(" min", "") : "–"}</div>
        <div class="d">{night?.sleepS ? (usualSleep ? `vanligt ${formatDuration(usualSleep)}` : "") : "Ingen data än"}</div>
        <Sparkline values={days.map((d) => (byDate.get(d)?.sleepS ?? null) && byDate.get(d)!.sleepS! / 3600)} />
      </button>
      <button class="vital" onClick={() => navigate("aterhamtning")}>
        <div class="l">HRV, 7 dagar</div>
        <div class="v">{fmt(hrv7)}<small>ms</small></div>
        <div class={`d ${hrvState ?? ""}`}>{latestBase ? `normalt ${latestBase.hrvBaselineLow}–${latestBase.hrvBaselineHigh}` : "Bygger baslinje"}</div>
        <Sparkline values={days.map((d) => byDate.get(d)?.hrvLastNight ?? null)} band={latestBase ? [latestBase.hrvBaselineLow!, latestBase.hrvBaselineHigh!] : null} />
      </button>
      <button class="vital" onClick={() => navigate("aterhamtning")}>
        <div class="l">Vilopuls</div>
        <div class="v">{fmt(rhrLast?.restingHr)}<small>slag/min</small></div>
        <div class="d">{rhrMed ? `median ${round(rhrMed)}` : "–"}</div>
        <Sparkline values={days.map((d) => byDate.get(d)?.restingHr ?? null)} />
      </button>
      <button class="vital" onClick={() => navigate("kropp")}>
        <div class="l">Vikt, trend</div>
        <div class="v">{ws.last ? fmt(ws.last.trend, 1) : "–"}<small>kg</small></div>
        <div class="d">{ws.c4.kg != null ? `${ws.c4.kg > 0 ? "+" : ""}${fmt(ws.c4.kg, 1)} kg på 4 v` : "Inga vägningar"}</div>
        <Sparkline values={ws.trend.filter((p) => p.date >= addDays(b.today, -42)).map((p) => p.trend)} />
      </button>
    </div>
  );
}

function WeekCard() {
  const b = useBundle();
  const monday = weekStart(b.today);
  const days = range(monday, addDays(monday, 6));
  const fromTemplate = !b.plan.some((p) => p.date >= monday && p.date <= days[6]);
  const { views, extras } = viewPlan(effectivePlan(b.plan, b.profile, monday, days[6]), b.activities.filter((a) => a.date >= monday && a.date <= days[6]), b.zones, b.profile, b.today);
  const label = (k: string) => ({ strength: "S", easy: "K", intervals: "I", recovery: "Å", rest: "–" }[k] ?? "?");
  const done = views.filter((v) => v.state === "done").length;
  return (
    <section class="card">
      <div class="card-head"><div><h3>Veckan</h3><p class="card-sub">{views.length ? `${done} av ${views.length} ${fromTemplate ? "pass enligt veckoupplägget" : "planerade pass"} gjorda` : "Inga träningsdagar valda"}{extras.length ? ` · ${extras.length} extra` : ""}</p></div>
        <button class="link" onClick={() => navigate("traning/plan")}>Planen</button></div>
      <div class="week">{days.map((d) => {
        const v = views.find((x) => x.item.date === d);
        const extra = extras.find((a) => a.date === d);
        return (
          <div class={`day${d === b.today ? " today" : ""}`}>
            <div class="wd">{weekdayName(d, true)}</div>
            <div class="n">{Number(d.slice(8))}</div>
            {v ? <div class={`pip ${v.state}`} title={v.state}>{v.state === "skipped" ? "×" : label(v.item.kind)}</div>
              : extra ? <div class="pip extra">+</div> : <div class="pip none" />}
          </div>
        );
      })}</div>
      <p class="tiny muted" style="margin-top:10px">S styrka · K kondition · I intervaller. Fylld = gjort, streckad = planerat.</p>
    </section>
  );
}
