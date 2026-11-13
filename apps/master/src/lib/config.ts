import { resolve } from "node:path";

function num(key: string, def: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

export function getConfig() {
  const url = process.env.DATABASE_URL || "file:./data/master.db";
  return {
    databasePath: resolve(url.replace(/^file:/, "")),
    heartbeatIntervalSec: num("HEARTBEAT_INTERVAL", 30, 5, 3600),
    agentTimeoutSec: num("AGENT_TIMEOUT", 5, 1, 60),
    offlineAfterFailures: num("HEARTBEAT_FAILURES", 3, 1, 100),
    actionTimeoutSec: 30,
    /** daily automatic database copies to keep in <data dir>/backups; 0 = off */
    backupKeep: num("BACKUP_KEEP", 0, 0, 365),
  };
}

/** 32-byte key from MASTER_SECRET_KEY (base64 or hex). Throws if invalid. */
export function getSecretKey(): Buffer {
  const raw = process.env.MASTER_SECRET_KEY ?? "";
  let key: Buffer | null = null;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else if (raw) {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) key = b;
  }
  if (!key) throw new Error("MASTER_SECRET_KEY must be 32 bytes (base64 or 64 hex chars)");
  return key;
}
