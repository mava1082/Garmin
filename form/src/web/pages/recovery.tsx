import { useMemo, useState } from "preact/hooks";
import { addDays, clockMinutesAroundMidnight, formatClock, formatDay, formatDuration, range } from "../../core/dates";
import { explainHrv, explainRhr, explainSleep, patterns } from "../../core/insights";
import { sleepWindow } from "../../core/sleep";
import { mean, rollingMean } from "../../core/stats";
import { BarChart, LineChart } from "../components/charts";
import { Card, Empty, Explain, PageHead, Seg, fmt } from "../components/ui";
import { useBundle } from "../store";

export function Recovery() {
  const b = useBundle();
  const [days, setDays] = useState<7 | 28 | 90>(28);
  const dates = range(addDays(b.today, -(days - 1)), b.today);
  const w = new Map(b.wellness.map((x) => [x.date, x]));
  const s = sleepWindow(b.wellness, b.today, days);
  const prev = sleepWindow(b.wellness, addDays(b.today, -days), days);
  const pats = useMemo(() => patterns(b), [b]);
  const xf = (x: string) => formatDay(x);
  const hrvVals = dates.map((d) => w.get(d)?.hrvLastNight ?? null);
  const hrvRoll = rollingMean(b.wellness.filter((x) => x.date <= b.today).map((x) => x.hrvLastNight), 7, 3);
  const rollBy = new Map(b.wellness.filter((x) => x.date <= b.today).map((x, i) => [x.date, hrvRoll[i]]));
  const anyStress = dates.some((d) => w.get(d)?.stressAvg != null || w.get(d)?.bodyBatteryMax != null);

  return (
    <div class="stack fade-in">
      <PageHead title="Återhämtning" sub="Sömn, HRV och vilopuls jämfört med din egen historik" />
      <Seg label="Period" value={days} onChange={setDays} options={[{ value: 7, label: "7 dagar" }, { value: 28, label: "28 dagar" }, { value: 90, label: "90 dagar" }]} />

      <div class="vitals">
        <div class="vital"><div class="l">Sömn per natt</div><div class="v">{s.avgS ? formatDuration(s.avgS).replace(" min", "") : "–"}</div>
          <div class="d">{prev.avgS && s.avgS ? `${s.avgS >= prev.avgS ? "+" : "−"}${formatDuration(Math.abs(s.avgS - prev.avgS))} mot förra perioden` : `${s.nights} nätter med data`}</div></div>
        <div class="vital"><div class="l">Läggdags / vaknar</div><div class="v" style="font-size:22px">{s.bedtime != null ? formatClock(s.bedtime) : "–"} <small>–</small> {s.wake != null ? formatClock(s.wake) : "–"}</div>
          <div class="d">{s.regularityMin != null ? `variation ±${Math.round(s.regularityMin)} min` : "för få nätter"}</div></div>
        <div class="vital"><div class="l">HRV, snitt</div><div class="v">{fmt(mean(hrvVals))}<small>ms</small></div><div class="d">Garmin, nattligt snitt</div></div>
        <div class="vital"><div class="l">Vilopuls, snitt</div><div class="v">{fmt(mean(dates.map((d) => w.get(d)?.restingHr)))}<small>slag/min</small></div><div class="d">Garmin</div></div>
      </div>

      <Card title="Sömn" sub="Timmar per natt (natten räknas till morgonen du vaknar)" right={<Explain get={() => explainSleep(b)} />}>
        {s.nights === 0 ? <Empty title="Ingen sömndata" /> :
          <BarChart data={dates.map((d) => ({ label: days > 28 ? (d.endsWith("01") || d.endsWith("15") ? xf(d) : "") : String(Number(d.slice(8))), values: { h: (w.get(d)?.sleepS ?? 0) / 3600 } }))}
            series={[{ id: "h", label: "Sömn", color: "var(--rest)" }]} yFormat={(v) => fmt(v, 1)}
            tooltipFooter={(i) => { const x = w.get(dates[i]); return x?.sleepS ? `${formatDay(dates[i])}${x.sleepScore ? ` · sömnpoäng ${x.sleepScore}` : ""}` : `${formatDay(dates[i])} · saknas`; }} />}
        <p class="tiny muted" style="margin-top:8px">Sömnfaser och sömnpoäng är klockans uppskattningar. Saknade nätter visas som tomma, inte som noll timmar sömn.</p>
      </Card>

      <Card title="Sovtider" sub="När du somnade och vaknade">
        <LineChart data={dates.map((d) => ({ x: d, values: { bed: w.get(d)?.sleepStartLocal ? clockMinutesAroundMidnight(w.get(d)!.sleepStartLocal!) : null, wake: w.get(d)?.sleepEndLocal ? clockMinutesAroundMidnight(w.get(d)!.sleepEndLocal!) : null } }))}
          series={[{ id: "bed", label: "Somnade", color: "var(--rest)", dotsOnly: true }, { id: "wake", label: "Vaknade", color: "var(--line-chart)", dotsOnly: true }]}
          xFormat={xf} yFormat={(v) => formatClock(v)} height={170} />
      </Card>

      <Card title="HRV" sub="Nattligt snitt · linje = 7-dagarssnitt · band = Garmins normalintervall för dig" right={<Explain get={() => explainHrv(b)} />}>
        <LineChart data={dates.map((d) => ({ x: d, values: { n: w.get(d)?.hrvLastNight ?? null, r: rollBy.get(d) ?? null }, lo: w.get(d)?.hrvBaselineLow ?? null, hi: w.get(d)?.hrvBaselineHigh ?? null }))}
          series={[{ id: "n", label: "Natt", color: "var(--line-chart)", dotsOnly: true }, { id: "r", label: "7-dagarssnitt", color: "var(--line-chart)", width: 2.2 }]} xFormat={xf} />
      </Card>

      <Card title="Vilopuls" sub="slag/min" right={<Explain get={() => explainRhr(b)} />}>
        <LineChart data={dates.map((d) => ({ x: d, values: { v: w.get(d)?.restingHr ?? null } }))} series={[{ id: "v", label: "Vilopuls", color: "var(--line-chart)", dots: days <= 28 }]} xFormat={xf} />
      </Card>

      {anyStress && <div class="grid-2">
        <Card title="Body Battery" sub="Dagens högsta och lägsta (Garmin, 0–100)">
          <LineChart data={dates.map((d) => ({ x: d, values: { max: w.get(d)?.bodyBatteryMax ?? null, min: w.get(d)?.bodyBatteryMin ?? null } }))}
            series={[{ id: "max", label: "Högsta", color: "var(--good)" }, { id: "min", label: "Lägsta", color: "var(--s-other)" }]} xFormat={xf} height={160} />
        </Card>
        <Card title="Stress" sub="Dagligt snitt enligt Garmin (0–100)">
          <LineChart data={dates.map((d) => ({ x: d, values: { v: w.get(d)?.stressAvg ?? null } }))} series={[{ id: "v", label: "Stress", color: "var(--attention)" }]} xFormat={xf} height={160} />
        </Card>
      </div>}

      <h3 class="section-title">Vad driver din återhämtning?</h3>
      <Card sub="Samband i dina egna data senaste fyra månaderna. Visas bara när det finns minst 20 dagar med båda värdena. Samband betyder inte orsak.">
        <div class="list">{pats.map((p) => (
          <div class="item" style="align-items:flex-start">
            <span class={`tag ${p.status === "samband" ? "good" : ""}`} style="margin-top:2px">{p.status === "samband" ? "Samband" : p.status === "för lite data" ? "För lite data" : "Inget tydligt"}</span>
            <div class="main"><div class="t" style="white-space:normal">{p.title}</div><div class="s" style="white-space:normal">{p.text}</div><div class="tiny muted">{p.period} · n = {p.n}</div></div>
          </div>))}
        </div>
      </Card>
    </div>
  );
}
