/** Small input validators – the server never trusts the client's shape. */

export class BadRequest extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

export function date(v: unknown, field = "datum"): string {
  if (!isDate(v)) throw new BadRequest(`Ogiltigt ${field}.`);
  return v;
}

export function int(v: unknown, min: number, max: number, field: string, nullable = true): number | null {
  if (v == null || v === "") { if (nullable) return null; throw new BadRequest(`${field} saknas.`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequest(`${field} måste vara mellan ${min} och ${max}.`);
  return Math.round(n);
}

export function num(v: unknown, min: number, max: number, field: string, nullable = true): number | null {
  if (v == null || v === "") { if (nullable) return null; throw new BadRequest(`${field} saknas.`); }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequest(`${field} måste vara mellan ${min} och ${max}.`);
  return n;
}

export function str(v: unknown, max: number, nullable = true): string | null {
  if (v == null || v === "") { if (nullable) return null; throw new BadRequest("Text saknas."); }
  if (typeof v !== "string") throw new BadRequest("Ogiltig text.");
  return v.slice(0, max);
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], field: string): T {
  if (!options.includes(v as T)) throw new BadRequest(`Ogiltigt värde för ${field}.`);
  return v as T;
}

export function id(v: unknown): string {
  if (typeof v !== "string" || !/^[\w.:-]{1,80}$/.test(v)) throw new BadRequest("Ogiltigt id.");
  return v;
}
