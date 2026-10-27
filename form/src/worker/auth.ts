/** Single-user authentication: password → server-side session in D1 → HttpOnly cookie. */

export const COOKIE = "form_session";
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two secrets in constant time by comparing their hashes. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && a.length > 0;
}

export function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function tooManyFailures(db: D1Database, now = Date.now()): Promise<boolean> {
  const since = now - LOCK_MINUTES * 60_000;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ok = 0 AND at > ?").bind(since).first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordAttempt(db: D1Database, ok: boolean, now = Date.now()) {
  await db.batch([
    db.prepare("INSERT INTO login_attempts (at, ok) VALUES (?, ?)").bind(now, ok ? 1 : 0),
    db.prepare("DELETE FROM login_attempts WHERE at < ?").bind(now - 7 * 86_400_000),
    ...(ok ? [db.prepare("DELETE FROM login_attempts WHERE ok = 0")] : []),
  ]);
}

export async function createSession(db: D1Database, now = Date.now()): Promise<{ token: string; maxAge: number }> {
  const token = randomToken();
  const maxAge = SESSION_DAYS * 86_400;
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), now, now + maxAge * 1000),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
  return { token, maxAge };
}

export async function validSession(db: D1Database, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const row = await db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ expires_at: number }>();
  return !!row && row.expires_at > now;
}

export async function deleteSession(db: D1Database, token: string | undefined) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readCookie(header: string | null | undefined, name = COOKIE): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
