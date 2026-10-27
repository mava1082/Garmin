// Prepares Cloudflare for FORM from GitHub Actions, using only CLOUDFLARE_API_TOKEN
// (CLOUDFLARE_ACCOUNT_ID is optional). Idempotent: safe to run on every deploy.
//
//   node scripts/cloudflare.mjs ensure   -> account, workers.dev subdomain, D1 database; patches wrangler.toml
//   node scripts/cloudflare.mjs url      -> prints the app URL
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token && process.argv[2] !== "ingest") { console.error("CLOUDFLARE_API_TOKEN saknas."); process.exit(1); }
const API = "https://api.cloudflare.com/client/v4";

async function cf(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.status;
    throw new Error(`Cloudflare ${init.method ?? "GET"} ${path}: ${msg}`);
  }
  return body.result;
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const accounts = await cf("/accounts");
  if (!accounts?.length) throw new Error("API-token har inte åtkomst till något Cloudflare-konto.");
  return accounts[0].id;
}

async function subdomain(account, create) {
  try {
    const r = await cf(`/accounts/${account}/workers/subdomain`);
    if (r?.subdomain) return r.subdomain;
  } catch (e) { if (!create) throw e; }
  if (!create) throw new Error("Inget workers.dev-subdomän registrerat.");
  const name = `form-${account.slice(0, 6)}`;
  const r = await cf(`/accounts/${account}/workers/subdomain`, { method: "PUT", body: JSON.stringify({ subdomain: name }) });
  console.log(`Registrerade workers.dev-subdomän: ${r.subdomain}`);
  return r.subdomain;
}

async function database(account) {
  const list = await cf(`/accounts/${account}/d1/database?name=form-db`);
  const hit = (list ?? []).find((d) => d.name === "form-db");
  if (hit) return hit.uuid;
  const created = await cf(`/accounts/${account}/d1/database`, { method: "POST", body: JSON.stringify({ name: "form-db" }) });
  console.log("Skapade D1-databasen form-db.");
  return created.uuid;
}

// The ingest token is derived from the app password, so no extra secret is needed.
// `node scripts/cloudflare.mjs ingest` writes it to stdout for piping (never logged).
if (process.argv[2] === "ingest") {
  process.stdout.write(createHmac("sha256", process.env.FORM_PASSWORD ?? "").update("form-ingest-v1").digest("hex"));
  process.exit(0);
}

const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const cmd = process.argv[2];
const account = await accountId();
out("account_id", account);
if (cmd === "ensure") {
  const sub = await subdomain(account, true);
  const db = await database(account);
  const toml = readFileSync("wrangler.toml", "utf8").replace(/database_id = "[^"]*"/, `database_id = "${db}"`);
  writeFileSync("wrangler.toml", toml);
  out("url", `https://form.${sub}.workers.dev`);
  console.log(`App: https://form.${sub}.workers.dev`);
} else if (cmd === "url") {
  const sub = await subdomain(account, false);
  out("url", `https://form.${sub}.workers.dev`);
  console.log(`https://form.${sub}.workers.dev`);
}

