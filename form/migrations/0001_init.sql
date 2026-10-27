-- FORM database (Cloudflare D1 / SQLite).
-- Records are stored as JSON documents (see src/core/types.ts) with indexed
-- columns for the fields we filter on. Every document carries its `source`.

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);

CREATE TABLE IF NOT EXISTS streams (
  activity_id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wellness (
  date TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weights (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weights_date ON weights(date);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  date TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_items(date);

CREATE TABLE IF NOT EXISTS strength_sets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  date TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strength_session ON strength_sets(session_id);

CREATE TABLE IF NOT EXISTS zones (
  key TEXT PRIMARY KEY,          -- "<source>:<sport>"
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
