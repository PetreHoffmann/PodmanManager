import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto";
import { base32Decode, generateSecret, stepOf, verifyTotp } from "./totp";

/** Second factor (TOTP + one-time recovery codes) of the built-in `admin` and of local users. */
/** cookie of a sign-in that waits for the second factor */
export const MFA_COOKIE = "pm_mfa";
export const MFA_REQUIRED_KEY = "mfa.required";
export const RECOVERY_COUNT = 10;
export const PENDING_TTL_MS = 5 * 60_000;
export const MAX_PENDING_ATTEMPTS = 5;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const normCode = (c: string) => c.replace(/[\s-]/g, "").toUpperCase();
const hashCode = (c: string) => sha256(`recovery:${normCode(c)}`);

/** 10 characters (50 bits) shown as XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const b = randomBytes(10);
  let s = "";
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export interface MfaStatus { enabled: boolean; recoveryLeft: number }

type Row = { totp_secret_enc: string; last_step: number; recovery: string };
const row = (u: string, db: DatabaseSync) => db.prepare("SELECT totp_secret_enc, last_step, recovery FROM mfa WHERE username = ?").get(u) as Row | undefined;
const hashes = (r: Row): string[] => {
  try {
    const a = JSON.parse(r.recovery);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const hasMfa = (username: string, db: DatabaseSync = getDb()): boolean => !!row(username, db);

export function mfaStatus(username: string, db: DatabaseSync = getDb()): MfaStatus {
  const r = row(username, db);
  return { enabled: !!r, recoveryLeft: r ? hashes(r).length : 0 };
}

export const mfaRequired = (db: DatabaseSync = getDb()): boolean => (db.prepare("SELECT value FROM settings WHERE key = ?").get(MFA_REQUIRED_KEY) as { value: string } | undefined)?.value === "1";
export function setMfaRequired(on: boolean, db: DatabaseSync = getDb()): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MFA_REQUIRED_KEY, on ? "1" : "0");
}

export { generateSecret };

/** Activates the second factor once the user proved the app works by entering a current code. Returns the recovery codes (shown once). */
export function enableMfa(username: string, secretB32: string, code: string, now: number = Date.now(), db: DatabaseSync = getDb(), key?: Buffer): { ok: true; recoveryCodes: string[] } | { ok: false; reason: "secret" | "code" | "exists" } {
  const raw = base32Decode(secretB32);
  if (!raw || raw.length < 16 || raw.length > 64) return { ok: false, reason: "secret" };
  if (row(username, db)) return { ok: false, reason: "exists" };
  const step = verifyTotp(secretB32, code, now);
  if (step === null) return { ok: false, reason: "code" };
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  db.prepare("INSERT INTO mfa (username, totp_secret_enc, last_step, recovery, created_at) VALUES (?, ?, ?, ?, ?)").run(
    username, encryptSecret(secretB32.replace(/[\s=-]/g, "").toUpperCase(), key), step, JSON.stringify(codes.map(hashCode)), new Date(now).toISOString(),
  );
  return { ok: true, recoveryCodes: codes };
}

export function disableMfa(username: string, db: DatabaseSync = getDb()): void {
  db.prepare("DELETE FROM mfa WHERE username = ?").run(username);
  db.prepare("DELETE FROM pending_logins WHERE username = ? COLLATE NOCASE").run(username);
}

/** New set of recovery codes; the old ones stop working. */
export function regenerateRecovery(username: string, db: DatabaseSync = getDb()): string[] | null {
  if (!row(username, db)) return null;
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  db.prepare("UPDATE mfa SET recovery = ? WHERE username = ?").run(JSON.stringify(codes.map(hashCode)), username);
  return codes;
}

export type SecondFactor = { ok: true; via: "totp" | "recovery" } | { ok: false };

/** Verifies an authenticator code or a recovery code (consumed on success). */
export function verifySecondFactor(username: string, input: string, now: number = Date.now(), db: DatabaseSync = getDb(), key?: Buffer): SecondFactor {
  const r = row(username, db);
  if (!r) return { ok: false };
  const text = input.trim();
  if (/^\d[\d\s]{5,}$/.test(text)) {
    let secret: string;
    try {
      secret = decryptSecret(r.totp_secret_enc, key);
    } catch {
      return { ok: false }; // unreadable with the current key: only recovery codes (or the reset script) help
    }
    const step = verifyTotp(secret, text, now, r.last_step);
    if (step === null) return { ok: false };
    // compare-and-set: two parallel requests cannot both use the same code
    const res = db.prepare("UPDATE mfa SET last_step = ? WHERE username = ? AND last_step < ?").run(step, username, step);
    return Number(res.changes) === 1 ? { ok: true, via: "totp" } : { ok: false };
  }
  const want = hashCode(text);
  const list = hashes(r);
  const idx = list.findIndex((h) => h.length === want.length && timingSafeEqual(Buffer.from(h), Buffer.from(want)));
  if (idx < 0) return { ok: false };
  list.splice(idx, 1);
  const res = db.prepare("UPDATE mfa SET recovery = ? WHERE username = ? AND recovery = ?").run(JSON.stringify(list), username, r.recovery);
  return Number(res.changes) === 1 ? { ok: true, via: "recovery" } : { ok: false };
}

/** Step 1 of a login with second factor done: remember who passed the password until the code arrives. */
export function createPending(username: string, now: number = Date.now(), db: DatabaseSync = getDb()): string {
  const token = randomToken();
  db.prepare("DELETE FROM pending_logins WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO pending_logins (token_hash, username, expires_at) VALUES (?, ?, ?)").run(sha256(token), username, now + PENDING_TTL_MS);
  return token;
}

export function getPending(token: string | undefined, now: number = Date.now(), db: DatabaseSync = getDb()): { username: string } | null {
  if (!token) return null;
  const r = db.prepare("SELECT username, expires_at, attempts FROM pending_logins WHERE token_hash = ?").get(sha256(token)) as { username: string; expires_at: number; attempts: number } | undefined;
  if (!r || r.expires_at <= now || r.attempts >= MAX_PENDING_ATTEMPTS) return null;
  return { username: r.username };
}

/** Counts a wrong code; the fifth one ends the pending login. */
export function failPending(token: string, db: DatabaseSync = getDb()): number {
  const h = sha256(token);
  db.prepare("UPDATE pending_logins SET attempts = attempts + 1 WHERE token_hash = ?").run(h);
  const r = db.prepare("SELECT attempts FROM pending_logins WHERE token_hash = ?").get(h) as { attempts: number } | undefined;
  if (r && r.attempts >= MAX_PENDING_ATTEMPTS) db.prepare("DELETE FROM pending_logins WHERE token_hash = ?").run(h);
  return r?.attempts ?? MAX_PENDING_ATTEMPTS;
}

export const endPending = (token: string, db: DatabaseSync = getDb()): void => void db.prepare("DELETE FROM pending_logins WHERE token_hash = ?").run(sha256(token));

export const stepNow = (now: number = Date.now()) => stepOf(now);
