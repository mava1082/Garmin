// @ts-nocheck – test shim, typed loosely on purpose.
/** Minimal D1 implementation on node:sqlite, enough for testing the Worker. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Stmt(this.db, this.sql, args); }
  private p() { return this.db.prepare(this.sql); }
  async all<T>() { return { results: this.p().all(...(this.args as any[])) as T[], success: true }; }
  async first<T>() { return (this.p().get(...(this.args as any[])) as T) ?? null; }
  async run() { this.p().run(...(this.args as any[])); return { success: true }; }
  runSync() { this.p().run(...(this.args as any[])); }
}

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    batch: async (stmts: Stmt[]) => { db.exec("BEGIN"); try { stmts.forEach((s) => s.runSync()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as D1Database;
}
