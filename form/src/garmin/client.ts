/**
 * Minimal client for the official Garmin Connect Personal API.
 *
 * Verified against Garmin's own Python client (garmin-connect-personal-api-python 1.0.0)
 * and live runs:
 * - POST {base}/personalapitoken-service/personal-api/personal-api-key/token with
 *   "Authorization: ApiKey <key>" returns a JWT bearer token (24 h; `exp` claim).
 *   There is no refresh token: a new token is minted from the key.
 * - Data endpoints are GET with "Authorization: Bearer <token>".
 * - Rate limiting answers HTTP 429 with JSON {count, limit, retryInSeconds}; we
 *   observed limit 100 per window.
 *
 * The key and tokens are never logged.
 */

export const DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

export type GarminErrorKind = "auth" | "denied" | "blocked" | "rate" | "http" | "network" | "config";

export class GarminError extends Error {
  constructor(public kind: GarminErrorKind, message: string, public status: number | null = null) {
    super(message);
    this.name = "GarminError";
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
  log?: (msg: string) => void;
}

export class GarminClient {
  private token: { value: string; exp: number } | null = null;
  private lastRequest = 0;
  requests = 0;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly base: string;
  private readonly minInterval: number;
  private readonly maxRetries: number;
  private readonly log: (msg: string) => void;

  constructor(private opts: ClientOptions) {
    if (!opts.apiKey?.trim()) throw new GarminError("config", "GARMIN_PERSONAL_API_KEY saknas.");
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.minInterval = opts.minIntervalMs ?? 700;
    this.maxRetries = opts.maxRetries ?? 4;
    this.log = opts.log ?? (() => {});
  }

  private async pace() {
    const wait = this.lastRequest + this.minInterval - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequest = this.now();
    this.requests++;
  }

  async bearer(force = false): Promise<string> {
    // Reuse until one hour before expiry, like Garmin's own client.
    if (!force && this.token && this.token.exp * 1000 - this.now() > 3600_000) return this.token.value;
    await this.pace();
    let res: Response;
    try {
      res = await this.f(this.base + TOKEN_PATH, { method: "POST", headers: { Accept: "*/*", Authorization: `ApiKey ${this.opts.apiKey.trim()}` } });
    } catch (e) {
      throw new GarminError("network", `Kunde inte nå Garmin: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw classify(res.status, text, "token");
    const value = text.trim();
    const exp = jwtExp(value);
    if (!exp) throw new GarminError("http", "Garmin svarade inte med en giltig token.");
    this.token = { value, exp };
    this.log("Ny åtkomsttoken hämtad.");
    return value;
  }

  async get<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T | null> {
    const res = await this.request(path, params, "application/json");
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  async getBytes(path: string): Promise<Uint8Array> {
    const res = await this.request(path, undefined, "application/zip, application/octet-stream");
    return new Uint8Array(await res.arrayBuffer());
  }

  private async request(path: string, params: Record<string, string | number> | undefined, accept: string): Promise<Response> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.bearer();
      await this.pace();
      let res: Response;
      try {
        res = await this.f(url, { headers: { Accept: accept, Authorization: `Bearer ${token}` } });
      } catch (e) {
        if (attempt >= this.maxRetries) throw new GarminError("network", `Nätverksfel mot Garmin: ${(e as Error).message}`);
        await this.sleep(backoff(attempt));
        continue;
      }
      if (res.ok) return res;
      const text = await res.text();
      if (res.status === 401 && !renewed) { renewed = true; await this.bearer(true); continue; }
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = retryAfter(text, res.headers.get("retry-after"));
        this.log(`Garmins anropsgräns nådd, väntar ${Math.round(wait / 1000)} s.`);
        await this.sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) { await this.sleep(backoff(attempt)); continue; }
      throw classify(res.status, text, path);
    }
  }
}

function backoff(attempt: number) { return 2000 * 2 ** attempt; }

export function retryAfter(body: string, header: string | null): number {
  try {
    const s = JSON.parse(body)?.retryInSeconds;
    if (typeof s === "number") return (s + 1) * 1000;
  } catch { /* not JSON */ }
  const h = Number(header);
  return Number.isFinite(h) && h > 0 ? h * 1000 : 60_000;
}

export function classify(status: number, body: string, what: string): GarminError {
  const html = /<html|cloudflare|captcha|cf-ray/i.test(body);
  if (status === 403 && html) {
    return new GarminError("blocked", "Garmins skydd (Cloudflare) stoppade anropet innan det nådde API:et. Det beror på nätverket som anropet görs från, inte på nyckeln.", status);
  }
  if (status === 401 || (status === 400 && what === "token")) return new GarminError("auth", "Garmin godkände inte API-nyckeln eller token. Kontrollera att nyckeln är rätt och inte har gått ut.", status);
  if (status === 403) return new GarminError("denied", "Garmin nekade åtkomst till den här datan.", status);
  if (status === 429) return new GarminError("rate", "Garmins anropsgräns är nådd. Försök igen senare.", status);
  return new GarminError("http", `Garmin svarade HTTP ${status} för ${what}.`, status);
}

export function jwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}
