import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfig } from "./config";
import { createBackup } from "./backup";

const NAME_RE = /^master-\d{4}-\d{2}-\d{2}\.db$/;
export const isBackupName = (n: string) => NAME_RE.test(n);

export const backupDir = () => join(dirname(getConfig().databasePath), "backups");

export interface BackupFile { name: string; size: number; mtime: number }

export function listBackups(dir: string = backupDir()): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Content of a stored backup; the name is checked against the fixed pattern, so no path can be reached. */
export function readStoredBackup(name: string, dir: string = backupDir()): Buffer | null {
  if (!isBackupName(name)) return null;
  const f = join(dir, name);
  return existsSync(f) ? readFileSync(f) : null;
}

/** Writes today's copy (UTC date) if it is not there yet and keeps only the newest `keep`. Returns the new file name. */
export function runAutoBackup(keep: number = getConfig().backupKeep, now: Date = new Date(), dir: string = backupDir(), make: () => Buffer = createBackup): string | null {
  if (keep <= 0) return null;
  const name = `master-${now.toISOString().slice(0, 10)}.db`;
  let created: string | null = null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(join(dir, name))) {
    const f = join(dir, name);
    writeFileSync(f, make(), { mode: 0o600 });
    chmodSync(f, 0o600);
    created = name;
  }
  for (const old of listBackups(dir).slice(keep)) unlinkSync(join(dir, old.name));
  return created;
}

const g = globalThis as unknown as { __pmAutoBackup?: NodeJS.Timeout };

/** Checks hourly, so a master that runs through midnight or restarts during the day still gets its daily copy. */
export function startAutoBackup(): void {
  if (g.__pmAutoBackup || getConfig().backupKeep <= 0) return;
  const tick = () => {
    try {
      const n = runAutoBackup();
      if (n) console.warn(`automatic database backup written: ${n}`);
    } catch (e) {
      console.warn(`automatic database backup failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  };
  g.__pmAutoBackup = setInterval(tick, 3600 * 1000);
  g.__pmAutoBackup.unref();
  tick();
}
