import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

function useWidth(): [preact.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface LineSeries { id: string; label: string; color: string; width?: number; dots?: boolean; dashed?: boolean; dotsOnly?: boolean; }
export interface LinePoint { x: string; values: Record<string, number | null>; lo?: number | null; hi?: number | null; }

const PAD = { l: 34, r: 10, t: 10, b: 22 };

export function LineChart({ data, series, height = 180, yFormat = (v) => String(Math.round(v)), xFormat, tooltipFormat, zeroBased = false, legend = true }: {
  data: LinePoint[]; series: LineSeries[]; height?: number; yFormat?: (v: number) => string; xFormat: (x: string) => string;
  tooltipFormat?: (v: number, s: LineSeries) => string; zeroBased?: boolean; legend?: boolean;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.flatMap((d) => [...series.map((s) => d.values[s.id]), d.lo, d.hi]).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return <div ref={ref} class="empty small">Inga värden i perioden.</div>;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (zeroBased) min = Math.min(0, min);
  const pad = (max - min) * 0.12 || 1;
  const ticks = niceTicks(zeroBased ? min : min - pad, max + pad);
  const y0 = Math.min(ticks[0], zeroBased ? min : min - pad), y1 = Math.max(ticks[ticks.length - 1], max);
  const iw = width - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const path = (id: string) => {
    let d = "", pen = false;
    data.forEach((p, i) => {
      const v = p.values[id];
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const band = (() => {
    const pts = data.map((p, i) => [i, p.lo, p.hi] as const).filter((p) => p[1] != null && p[2] != null);
    if (pts.length < 2) return null;
    return `M${pts.map(([i, , hi]) => `${x(i).toFixed(1)},${y(hi!).toFixed(1)}`).join("L")}L${[...pts].reverse().map(([i, lo]) => `${x(i).toFixed(1)},${y(lo!).toFixed(1)}`).join("L")}Z`;
  })();
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 64))));

  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover != null ? data[hover] : null;

  return (
    <div class="chart" ref={ref}>
      <svg width={width} height={height} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Diagram: ${series.map((s) => s.label).join(", ")}`}>
        <g class="grid">{ticks.map((t) => <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />)}</g>
        <g class="axis">
          {ticks.map((t) => <text x={PAD.l - 6} y={y(t) + 4} text-anchor="end">{yFormat(t)}</text>)}
          {data.map((p, i) => (i % labelEvery === 0 || i === data.length - 1) && (data.length - 1 - i >= labelEvery / 2 || i === data.length - 1)
            ? <text x={x(i)} y={height - 5} text-anchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{xFormat(p.x)}</text> : null)}
        </g>
        {band && <path d={band} fill="var(--band)" />}
        {series.map((s) => s.dotsOnly ? null : <path d={path(s.id)} fill="none" stroke={s.color} stroke-width={s.width ?? 2} stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={s.dashed ? "4 4" : undefined} />)}
        {series.filter((s) => s.dots || s.dotsOnly).map((s) => data.map((p, i) => p.values[s.id] == null ? null
          : <circle cx={x(i)} cy={y(p.values[s.id]!)} r={s.dotsOnly ? 3 : 2.5} fill={s.color} opacity={s.dotsOnly ? 0.55 : 1} />))}
        {h && <g>
          <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--line-strong)" />
          {series.map((s) => h.values[s.id] == null ? null : <circle cx={x(hover!)} cy={y(h.values[s.id]!)} r={4.5} fill={s.color} stroke="var(--surface)" stroke-width="2" />)}
        </g>}
      </svg>
      {h && <Tooltip x={x(hover!)} width={width}>
        <div class="t">{xFormat(h.x)}</div>
        {series.map((s) => <div><span style={`color:${s.color}`}>●</span> {s.label}: <b>{h.values[s.id] == null ? "saknas" : (tooltipFormat ?? yFormat)(h.values[s.id]!, s)}</b></div>)}
        {h.lo != null && h.hi != null && <div class="t">Normalt: {yFormat(h.lo)}–{yFormat(h.hi)}</div>}
      </Tooltip>}
      {legend && series.length > 1 && <div class="legend">{series.map((s) => <span><i class={s.dotsOnly ? "" : "line"} style={`background:${s.color}`} />{s.label}</span>)}</div>}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ComponentChildren }) {
  const left = Math.min(Math.max(8, x - 70), width - 160);
  return <div class="tooltip" style={`left:${left}px`}>{children}</div>;
}

export interface BarSeries { id: string; label: string; color: string; }

export function BarChart({ data, series, height = 180, yFormat = (v) => String(Math.round(v)), tooltipFooter }: {
  data: { label: string; values: Record<string, number> }[]; series: BarSeries[]; height?: number; yFormat?: (v: number) => string;
  tooltipFooter?: (i: number) => string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.id] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(0, max * 1.08, 3);
  const top = Math.max(ticks[ticks.length - 1], max);
  const iw = width - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const slot = iw / data.length;
  const bw = Math.min(36, slot * 0.66);
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 40))));
  return (
    <div class="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`Stapeldiagram: ${series.map((s) => s.label).join(", ")}`} onPointerLeave={() => setHover(null)}>
        <g class="grid">{ticks.map((t) => <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} />)}</g>
        <g class="axis">
          {ticks.map((t) => <text x={PAD.l - 6} y={y(t) + 4} text-anchor="end">{yFormat(t)}</text>)}
          {data.map((d, i) => i % labelEvery === 0 ? <text x={PAD.l + slot * i + slot / 2} y={height - 5} text-anchor="middle">{d.label}</text> : null)}
        </g>
        {data.map((d, i) => {
          let acc = 0;
          const cx = PAD.l + slot * i + (slot - bw) / 2;
          const segs = series.filter((s) => (d.values[s.id] ?? 0) > 0);
          return (
            <g onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {segs.map((s, k) => {
                const v = d.values[s.id];
                const y1 = y(acc + v), y0 = y(acc);
                acc += v;
                const last = k === segs.length - 1;
                const hgt = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
                return last ? <path d={roundTop(cx, y1, bw, hgt, Math.min(4, hgt))} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />
                  : <rect x={cx} y={y1 + (k > 0 ? 0 : 0)} width={bw} height={hgt} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
              })}
            </g>
          );
        })}
      </svg>
      {hover != null && <Tooltip x={PAD.l + slot * hover + slot / 2} width={width}>
        <div class="t">{data[hover].label}</div>
        {series.filter((s) => data[hover].values[s.id]).map((s) => <div><span style={`color:${s.color}`}>■</span> {s.label}: <b>{yFormat(data[hover].values[s.id])}</b></div>)}
        {tooltipFooter && <div class="t">{tooltipFooter(hover)}</div>}
      </Tooltip>}
      {series.length > 1 && <div class="legend">{series.map((s) => <span><i style={`background:${s.color}`} />{s.label}</span>)}</div>}
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Sparkline({ values, color = "var(--line-chart)", height = 34, band }: { values: (number | null)[]; color?: string; height?: number; band?: [number, number] | null }) {
  const [ref, width] = useWidth();
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return <div ref={ref} style={`height:${height}px`} />;
  const lo = Math.min(...v, band?.[0] ?? Infinity), hi = Math.max(...v, band?.[1] ?? -Infinity);
  const y = (n: number) => 3 + (height - 6) * (1 - (n - lo) / (hi - lo || 1));
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  let d = "", pen = false;
  values.forEach((n, i) => { if (n == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(n).toFixed(1)}`; pen = true; });
  const lastI = values.map((n, i) => (n == null ? -1 : i)).filter((i) => i >= 0).pop()!;
  return (
    <div ref={ref}>
      <svg width={width} height={height} aria-hidden="true">
        {band && <rect x={0} width={width} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--band)" rx="3" />}
        <path d={d} fill="none" stroke={color} stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx={x(lastI)} cy={y(values[lastI]!)} r="3" fill={color} />
      </svg>
    </div>
  );
}

export function ZoneSplit({ low, mid, high }: { low: number; mid: number; high: number }) {
  const parts = [{ v: low, c: "#9ec5f4", t: "#101113", l: "Låg (zon 1–2)" }, { v: mid, c: "#5598e7", t: "#101113", l: "Medel (zon 3)" }, { v: high, c: "#1c5cab", t: "#f3eee5", l: "Hög (zon 4–5)" }];
  return (
    <div>
      <div class="split" role="img" aria-label={parts.map((p) => `${p.l} ${Math.round(p.v * 100)} %`).join(", ")}>
        {parts.map((p) => p.v > 0 && <div style={`flex:${p.v};background:${p.c};color:${p.t}`}>{p.v >= 0.1 ? `${Math.round(p.v * 100)} %` : ""}</div>)}
      </div>
      <div class="legend">{parts.map((p) => <span><i style={`background:${p.c}`} />{p.l} <b>{Math.round(p.v * 100)} %</b></span>)}</div>
    </div>
  );
}
