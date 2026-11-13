import { mkdtempSync, readFileSync, rmSync, unlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as Db } from "node:sqlite";
import { getConfig } from "./config";
import { decryptSecret } from "./crypto";
import { getDb, openDb } from "../database/db";

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const HEADER = "SQLite format 3\0";
/** Parents last: delete in this order, insert in reverse. */
const TABLES = ["user_groups", "users", "agent_group_members", "agent_groups", "agents", "admin", "settings"] as const;
const REQUIRED = ["agents", "admin", "agent_groups", "agent_group_members", "settings"];

const sqlString = (p: string) => `'${p.replace(/'/g, "''")}'`;

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pm-backup-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Consistent copy of the running database without sessions and SSO cache (nobody can sign in with a backup). */
export function createBackup(db: Db = getDb()): Buffer {
  return withTmp((dir) => {
    const file = join(dir, "backup.db");
    db.exec(`VACUUM INTO ${sqlString(file)}`);
    const copy = new DatabaseSync(file);
    try {
      copy.exec("DELETE FROM sessions; DELETE FROM saml_cache; VACUUM;");
    } finally {
      copy.close();
    }
    return readFileSync(file);
  });
}

export type RestoreErr = "err.restoreFile" | "err.restoreKey";
export type RestoreResult =
  | { ok: true; agents: number; users: number; groups: number }
  | { ok: false; error: RestoreErr; unreadable?: number };

const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/**
 * Replaces hosts, groups, local users, admin password and settings with the content of an uploaded backup.
 * Everything runs in one transaction; the previous database is saved next to it as `<db>.bak` first.
 */
export function restoreBackup(data: Buffer, opts: { key?: Buffer; force?: boolean } = {}, db: Db = getDb(), bakPath: string | null = defaultBakPath(db)): RestoreResult {
  if (data.length < 512 || data.length > MAX_BACKUP_BYTES || data.subarray(0, 16).toString("latin1") !== HEADER) return { ok: false, error: "err.restoreFile" };
  return withTmp((dir) => {
    const file = join(dir, "upload.db");
    writeFileSync(file, data, { mode: 0o600 });
    // structure check on the untouched file
    try {
      const ro = new DatabaseSync(file, { readOnly: true });
      try {
        if ((ro.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok") return { ok: false, error: "err.restoreFile" } as const;
        const names = (ro.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
        if (!REQUIRED.every((n) => names.includes(n))) return { ok: false, error: "err.restoreFile" } as const;
      } finally {
        ro.close();
      }
    } catch {
      return { ok: false, error: "err.restoreFile" } as const;
    }
    // bring an older backup to the current schema (on the temporary copy only)
    let src: Db;
    try {
      src = openDb(file);
    } catch {
      return { ok: false, error: "err.restoreFile" } as const;
    }
    let unreadable = 0;
    try {
      // without an administrator the master would fall back to its first-run page, where anybody could set one
      if (count(src, "admin") === 0) return { ok: false, error: "err.restoreFile" } as const;
      if (opts.key) {
        const rows = src.prepare("SELECT token_enc FROM agents WHERE kind = 'remote' AND token_enc <> ''").all() as { token_enc: string }[];
        for (const r of rows) {
          try {
            decryptSecret(r.token_enc, opts.key);
          } catch {
            unreadable++;
          }
        }
        if (unreadable > 0 && !opts.force) return { ok: false, error: "err.restoreKey", unreadable } as const;
      }
    } finally {
      src.close();
    }

    if (bakPath) {
      if (existsSync(bakPath)) unlinkSync(bakPath);
      db.exec(`VACUUM INTO ${sqlString(bakPath)}`);
    }
    db.exec(`ATTACH DATABASE ${sqlString(file)} AS src`);
    try {
      db.exec("BEGIN");
      try {
        for (const t of TABLES) db.exec(`DELETE FROM main.${t}`);
        for (const t of [...TABLES].reverse()) {
          const cols = (db.prepare(`PRAGMA main.table_info(${t})`).all() as { name: string }[]).map((c) => c.name).join(", ");
          db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM src.${t}`);
        }
        // nobody stays signed in: the restored accounts are a different set
        db.exec("DELETE FROM main.sessions; DELETE FROM main.saml_cache");
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      db.exec("DETACH DATABASE src");
    }
    return { ok: true, agents: count(db, "agents"), users: count(db, "users"), groups: count(db, "agent_groups") } as const;
  });
}

export function defaultBakPath(db: Db = getDb()): string | null {
  void db;
  const p = getConfig().databasePath;
  return p === ":memory:" ? null : `${p}.bak`;
}
