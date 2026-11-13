import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "../lib/config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  address TEXT NOT NULL,
  port INTEGER NOT NULL,
  token_enc TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,
  last_error TEXT,
  agent_version TEXT,
  podman_version TEXT,
  UNIQUE(address, port)
);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  username TEXT,
  kind TEXT,
  access TEXT,
  group_ids TEXT
);
CREATE TABLE IF NOT EXISTS agent_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  ad_group_dn TEXT NOT NULL,
  saml_group TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agent_group_members (
  group_id INTEGER NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, agent_id)
);
CREATE TABLE IF NOT EXISTS saml_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // Migration: sessions of older versions lack identity columns; force a fresh login.
  const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("username")) {
    db.exec("DELETE FROM sessions; ALTER TABLE sessions ADD COLUMN username TEXT; ALTER TABLE sessions ADD COLUMN kind TEXT;");
  }
  if (!cols.includes("access")) {
    // Sessions created before agent groups existed carry no scope; drop them.
    db.exec("DELETE FROM sessions; ALTER TABLE sessions ADD COLUMN access TEXT; ALTER TABLE sessions ADD COLUMN group_ids TEXT;");
  }
  if (!cols.includes("display_name")) db.exec("ALTER TABLE sessions ADD COLUMN display_name TEXT");
  const groupCols = (db.prepare("PRAGMA table_info(agent_groups)").all() as { name: string }[]).map((c) => c.name);
  if (!groupCols.includes("saml_group")) {
    db.exec("ALTER TABLE agent_groups ADD COLUMN saml_group TEXT NOT NULL DEFAULT ''");
  }
  return db;
}

const g = globalThis as unknown as { __pmDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  g.__pmDb ??= openDb(getConfig().databasePath);
  return g.__pmDb;
}
