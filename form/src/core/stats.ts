/** Small statistics helpers. All of them ignore null / non-finite values. */

export type Maybe = number | null | undefined;

export function clean(values: Maybe[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function mean(values: Maybe[]): number | null {
  const v = clean(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sum(values: Maybe[]): number {
  return clean(values).reduce((a, b) => a + b, 0);
}

export function median(values: Maybe[]): number | null {
  const v = clean(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function sd(values: Maybe[]): number | null {
  const v = clean(values);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Rolling mean over a window of `n` points (only points with data count). */
export function rollingMean(values: Maybe[], n: number, minPoints = 1): (number | null)[] {
  return values.map((_, i) => {
    const w = clean(values.slice(Math.max(0, i - n + 1), i + 1));
    return w.length >= minPoints ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

function ranks(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/** Spearman rank correlation on pairs where both values exist. */
export function spearman(pairs: [Maybe, Maybe][]): { r: number | null; n: number } {
  const ok = pairs.filter((p): p is [number, number] =>
    typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ok.length < 3) return { r: null, n: ok.length };
  return { r: pearson(ranks(ok.map((p) => p[0])), ranks(ok.map((p) => p[1]))), n: ok.length };
}

/** Least-squares slope of y over x. */
export function slope(points: [number, number][]): number | null {
  if (points.length < 2) return null;
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const my = points.reduce((a, p) => a + p[1], 0) / points.length;
  let num = 0, den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}

export const round = (v: number | null, digits = 0): number | null =>
  v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits;
