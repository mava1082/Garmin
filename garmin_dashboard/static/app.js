"use strict";

// Fixed sport -> categorical slot mapping, so a sport keeps its color whatever is shown.
const SPORT_SLOT = { running: 1, cycling: 2, swimming: 3, strength: 4, walking: 5, skiing: 6, other: 7 };
const STATUS_ICON = { good: "✓", info: "i", warning: "!", critical: "!!" };
const LEVEL_STATUS = { high: "good", moderate: "good", low: "warning", rest: "critical", unknown: null };

const state = { days: 90, data: null, charts: {} };

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const sportColor = (s) => css(`--s${SPORT_SLOT[s] || 7}`);
const fmt = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("sv-SE", { maximumFractionDigits: d, minimumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortDate = (iso) => new Date(iso + "T00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

// --- data ---------------------------------------------------------------
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
  return body;
}

async function load() {
  try {
    state.data = await api(`/api/dashboard?days=${state.days}`);
    showError(null);
    render();
  } catch (e) {
    showError(`Kunde inte ladda data: ${e.message}`);
  }
}

function showError(msg) {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

// --- render -------------------------------------------------------------
function render() {
  const d = state.data;
  const s = d.settings;
  const src = { demo: "demodata", garminconnect: "Garmin Connect", health_api: "Garmin Health API" }[d.source] || d.source;
  $("#meta").textContent = `${src} · ${d.counts.activities} pass · senast synkad ${s.last_sync ? s.last_sync.replace("T", " ").slice(0, 16) : "aldrig"}`;
  renderReadiness(d.readiness);
  renderTiles(d);
  renderInsights(d.insights);
  renderRecords(d.records);
  renderRecent(d.recent);
  renderIntensitySplit(d.intensity);
  if (window.Chart) renderCharts(d);
  else showError("Chart.js kunde inte laddas (ingen internetanslutning?). Siffrorna visas ändå.");
}

function renderReadiness(r) {
  const status = LEVEL_STATUS[r.level];
  const color = status ? css(`--${status}`) : css("--muted");
  const fg = $("#ringFg");
  fg.style.stroke = color;
  fg.style.strokeDashoffset = 326.7 * (1 - (r.score ?? 0) / 100);
  $("#scoreNum").textContent = r.score ?? "–";
  $("#readyTitle").textContent = r.title;
  $("#readyAdvice").textContent = r.advice;
  $("#readyComponents").innerHTML = r.components.map((c) => `
    <li>
      <div class="row"><span>${esc(c.label)}</span><b>${c.score}</b></div>
      <div class="bar"><i style="width:${c.score}%"></i></div>
      <span class="detail">${esc(c.detail)}</span>
    </li>`).join("");
}

function renderTiles(d) {
  const c = d.current;
  const goal = Number(d.settings.weekly_goal_hours) || 0;
  const ctlDelta = c.ctl_week_ago != null ? c.ctl - c.ctl_week_ago : null;
  const tsbText = c.tsb > 5 ? "utvilad" : c.tsb < -30 ? "överbelastad" : c.tsb < -10 ? "produktiv träning" : "neutral";
  const tiles = [
    { label: "Fitness (CTL)", value: fmt(c.ctl), delta: ctlDelta != null ? `${ctlDelta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(ctlDelta), 1)} senaste 7 d` : "", up: ctlDelta > 0 },
    { label: "Trötthet (ATL)", value: fmt(c.atl), delta: "7 dagars belastning" },
    { label: "Form (TSB)", value: (c.tsb > 0 ? "+" : "") + fmt(c.tsb), delta: tsbText },
    { label: "Denna vecka", value: fmt(c.week_hours, 1), unit: goal ? `/ ${fmt(goal, 1)} h` : "h",
      delta: `${fmt(c.week_km, 1)} km`, progress: goal ? Math.min(100, (c.week_hours / goal) * 100) : null },
    { label: "Vilopuls", value: fmt(c.resting_hr), unit: "slag/min" },
    { label: "HRV", value: fmt(c.hrv), unit: "ms" },
  ];
  if (c.vo2max) tiles.push({ label: "VO₂max", value: fmt(c.vo2max, 1), unit: "ml/kg/min" });
  $("#tiles").innerHTML = tiles.map((t) => `
    <div class="card tile">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}${t.unit ? `<small>${t.unit}</small>` : ""}</div>
      ${t.delta ? `<div class="delta ${t.up ? "up" : ""}">${t.delta}</div>` : ""}
      ${t.progress != null ? `<div class="progress"><i style="width:${t.progress}%"></i></div>` : ""}
    </div>`).join("");
}

function renderInsights(items) {
  const status = { good: "good", info: null, warning: "warning", critical: "critical" };
  $("#insights").innerHTML = items.length ? items.map((i) => `
    <li>
      <span class="icon ${i.level}" style="background:${status[i.level] ? css(`--${status[i.level]}`) : css("--accent")}">${STATUS_ICON[i.level]}</span>
      <div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>
    </li>`).join("") : `<li class="muted">Inget att anmärka – fortsätt som vanligt.</li>`;
}

function renderRecords(items) {
  $("#records").innerHTML = items.length ? items.map((r) => `
    <li><span>${esc(r.label)}</span><span class="v">${esc(r.value)}<span class="d">${shortDate(r.date)}</span></span></li>`).join("")
    : `<li class="muted">Inga rekord än.</li>`;
}

function renderRecent(rows) {
  $("#recent").innerHTML = rows.map((a) => `
    <tr>
      <td>${esc(a.date)}</td>
      <td>${esc(a.name)}</td>
      <td><span class="dot" style="background:${sportColor(a.sport)}"></span>${esc(a.sport_label)}</td>
      <td class="num">${Math.floor(a.duration_min / 60) ? `${Math.floor(a.duration_min / 60)} h ` : ""}${a.duration_min % 60} min</td>
      <td class="num">${a.km != null ? fmt(a.km, 2) + " km" : "–"}</td>
      <td class="num">${a.pace ? a.pace + " /km" : a.speed_kmh ? fmt(a.speed_kmh, 1) + " km/h" : "–"}</td>
      <td class="num">${a.avg_hr ?? "–"}</td>
      <td class="num">${a.load}</td>
    </tr>`).join("");
}

function renderIntensitySplit(it) {
  const el = $("#split");
  if (!it.has_data) { el.innerHTML = ""; return; }
  const parts = [["Lätt (Z1–2)", it.low, "--ord-1"], ["Medel (Z3)", it.mid, "--ord-2"], ["Hårt (Z4–5)", it.high, "--ord-3"]];
  el.innerHTML = parts.map(([l, v, c]) => `<div style="flex:${Math.max(v, 1)};background:${css(c)}" title="${l}: ${v} %">${v >= 8 ? v + " %" : ""}</div>`).join("");
  let legend = el.nextElementSibling;
  if (!legend || !legend.classList.contains("split-legend")) {
    legend = document.createElement("div");
    legend.className = "split-legend";
    el.after(legend);
  }
  legend.innerHTML = parts.map(([l, v]) => `<span>${l} <b>${v} %</b></span>`).join("");
}

// --- charts -------------------------------------------------------------
function baseOptions(extra = {}) {
  const grid = css("--grid"), muted = css("--muted");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text-2"),
        borderColor: css("--axis"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 18 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5 } },
    },
    ...extra,
  };
}

function chart(id, config) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function lineDs(label, data, color, extra = {}) {
  return { label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0,
    pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBorderColor: css("--surface"), tension: 0.25, ...extra };
}

function rolling(values, n) {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

function legend(el, items) {
  $(el).innerHTML = items.map(([label, color, line]) => `<span><i class="${line ? "line" : ""}" style="background:${color}"></i>${esc(label)}</span>`).join("");
}

function renderCharts(d) {
  const labels = d.fitness.map((f) => shortDate(f.date));

  // Fitness & fatigue (same unit, one axis)
  chart("fitnessChart", {
    type: "line",
    data: { labels, datasets: [
      lineDs("Fitness", d.fitness.map((f) => f.ctl), css("--s1"), { fill: { target: "origin", above: css("--s1") + "1f" } }),
      lineDs("Trötthet", d.fitness.map((f) => f.atl), css("--s2")),
    ] },
    options: baseOptions(),
  });
  legend("#fitnessLegend", [["Fitness", css("--s1"), true], ["Trötthet", css("--s2"), true]]);

  // Form: diverging bars
  const pos = css("--div-pos"), neg = css("--div-neg");
  chart("formChart", {
    type: "bar",
    data: { labels, datasets: [{ label: "Form", data: d.fitness.map((f) => f.tsb),
      backgroundColor: d.fitness.map((f) => (f.tsb >= 0 ? pos : neg)), borderRadius: 2, barPercentage: 0.9, categoryPercentage: 1 }] },
    options: baseOptions({ scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, ticks: { display: false } } } }),
  });

  // Weekly volume stacked by sport
  chart("weeklyChart", {
    type: "bar",
    data: {
      labels: d.weekly.map((w) => w.label),
      datasets: d.sports.map((s) => ({
        label: s.label, data: d.weekly.map((w) => w.hours[s.key] || 0), backgroundColor: sportColor(s.key),
        borderColor: css("--surface"), borderWidth: { top: 2 }, borderSkipped: "bottom", borderRadius: 4, maxBarThickness: 44,
      })),
    },
    options: baseOptions({
      plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip,
        callbacks: {
          label: (ctx) => ctx.raw ? ` ${ctx.dataset.label}: ${fmt(ctx.raw, 1)} h` : null,
          footer: (items) => { const w = d.weekly[items[0].dataIndex]; return `Totalt ${fmt(w.total_hours, 1)} h · ${fmt(w.km, 0)} km · belastning ${w.load}`; },
        } } },
      scales: { x: { ...baseOptions().scales.x, stacked: true }, y: { ...baseOptions().scales.y, stacked: true, title: { display: true, text: "timmar", color: css("--muted") } } },
    }),
  });
  legend("#weeklyLegend", d.sports.map((s) => [s.label, sportColor(s.key)]));

  // HR zones
  const zoneColors = [css("--ord-1"), css("--ord-1"), css("--ord-2"), css("--ord-3"), css("--ord-3")];
  chart("zoneChart", {
    type: "bar",
    data: { labels: ["Z1", "Z2", "Z3", "Z4", "Z5"], datasets: [{ label: "Minuter", data: d.intensity.zones_min, backgroundColor: zoneColors, borderRadius: 4, maxBarThickness: 36 }] },
    options: baseOptions({ plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${fmt(c.raw)} min` } } } }),
  });

  // Recovery
  const dl = d.daily.map((x) => shortDate(x.date));
  chart("rhrChart", { type: "line", data: { labels: dl, datasets: [
    lineDs("Vilopuls", d.daily.map((x) => x.resting_hr), css("--s1"), { spanGaps: true }),
  ] }, options: baseOptions() });

  const hrv = d.daily.map((x) => x.hrv);
  chart("hrvChart", { type: "line", data: { labels: dl, datasets: [
    { label: "HRV", data: hrv, showLine: false, pointRadius: 2.5, pointHoverRadius: 5, backgroundColor: css("--s1") + "66", borderColor: "transparent" },
    lineDs("7 d snitt", rolling(hrv, 7).map((v) => (v == null ? null : Math.round(v))), css("--s1"), { spanGaps: true }),
  ] }, options: baseOptions() });

  chart("sleepChart", { type: "bar", data: { labels: dl, datasets: [
    { label: "Sömn (h)", data: d.daily.map((x) => (x.sleep_s ? +(x.sleep_s / 3600).toFixed(1) : null)), backgroundColor: css("--s7"), borderRadius: 2, categoryPercentage: 1, barPercentage: 0.8 },
  ] }, options: baseOptions({ plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip,
    callbacks: { afterLabel: (c) => { const s = d.daily[c.dataIndex].sleep_score; return s ? `Sömnpoäng ${s}` : ""; } } } } }) });

  // Aerobic efficiency
  const eff = d.efficiency;
  chart("effChart", { type: "line", data: { labels: eff.map((e) => shortDate(e.date)), datasets: [
    { label: "Pass", data: eff.map((e) => e.value), showLine: false, pointRadius: 3.5, pointHoverRadius: 6, backgroundColor: css("--s1") + "88", borderColor: "transparent" },
    lineDs("Trend (5 pass)", rolling(eff.map((e) => e.value), 5), css("--s1")),
  ] }, options: baseOptions({ plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip,
    callbacks: { label: (c) => c.datasetIndex === 0 ? ` ${fmt(c.raw, 2)} m/slag · ${eff[c.dataIndex].pace} /km @ ${eff[c.dataIndex].hr} bpm` : ` Trend ${fmt(c.raw, 2)}` } } } }) });
}

// --- interactions -------------------------------------------------------
$("#period").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.days = Number(btn.dataset.days);
  document.querySelectorAll("#period button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  load();
});

$("#syncBtn").addEventListener("click", async () => {
  const btn = $("#syncBtn");
  btn.disabled = true;
  btn.textContent = "Synkar…";
  try {
    const r = await api("/api/sync", { method: "POST" });
    btn.textContent = `+${r.activities} pass`;
    await load();
  } catch (e) {
    showError(e.message);
  } finally {
    setTimeout(() => { btn.textContent = "Synka"; btn.disabled = false; }, 1500);
  }
});

const dialog = $("#settingsDialog");
$("#settingsBtn").addEventListener("click", () => {
  const s = state.data?.settings || {};
  const f = $("#settingsForm");
  for (const k of ["max_hr", "resting_hr", "sex", "weekly_goal_hours"]) if (s[k] != null) f.elements[k].value = s[k];
  dialog.showModal();
});
dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "save") return;
  const f = $("#settingsForm");
  const body = { max_hr: +f.max_hr.value, resting_hr: +f.resting_hr.value, sex: f.sex.value, weekly_goal_hours: +f.weekly_goal_hours.value };
  try {
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  } catch (e) { showError(e.message); }
});

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  if (state.data) render();
}
$("#themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  try { localStorage.setItem("theme", next); } catch {}
  applyTheme(next);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.data && render());
try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}

load();
