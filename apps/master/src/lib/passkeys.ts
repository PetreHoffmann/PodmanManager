import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JsonWebKey } from "node:crypto";
import { getDb } from "../database/db";
import { b64u, newChallenge, type Registered } from "./webauthn";

export const MAX_PASSKEYS = 10;
export const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 1000;

export interface PasskeyRow { id: number; username: string; credentialId: string; userHandle: string; alg: number; jwk: JsonWebKey; signCount: number; name: string; createdAt: string; lastUsed: string | null }

type Raw = { id: number; username: string; credential_id: string; user_handle: string; public_key: string; alg: number; sign_count: number; name: string; created_at: string; last_used: string | null };
const map = (r: Raw): PasskeyRow => ({ id: r.id, username: r.username, credentialId: r.credential_id, userHandle: r.user_handle, alg: r.alg, jwk: JSON.parse(r.public_key) as JsonWebKey, signCount: r.sign_count, name: r.name, createdAt: r.created_at, lastUsed: r.last_used });

export const listPasskeys = (username: string, db: DatabaseSync = getDb()): PasskeyRow[] =>
  (db.prepare("SELECT * FROM passkeys WHERE username = ? ORDER BY id").all(username) as unknown as Raw[]).map(map);

export const hasPasskey = (username: string, db: DatabaseSync = getDb()): boolean => !!db.prepare("SELECT 1 FROM passkeys WHERE username = ?").get(username);

export function findPasskey(credentialId: string, db: DatabaseSync = getDb()): PasskeyRow | null {
  const r = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId) as Raw | undefined;
  return r ? map(r) : null;
}

/** One opaque handle per account (the same for all its passkeys); it carries no name. */
export function userHandleFor(username: string, db: DatabaseSync = getDb()): string {
  const r = db.prepare("SELECT user_handle FROM passkeys WHERE username = ? LIMIT 1").get(username) as { user_handle: string } | undefined;
  return r?.user_handle ?? b64u(randomBytes(16));
}

export function addPasskey(username: string, reg: Registered, name: string, userHandle: string, now: number = Date.now(), db: DatabaseSync = getDb()): { ok: true; id: number } | { ok: false; reason: "limit" | "exists" } {
  if ((db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE username = ?").get(username) as { n: number }).n >= MAX_PASSKEYS) return { ok: false, reason: "limit" };
  if (findPasskey(b64u(reg.credentialId), db)) return { ok: false, reason: "exists" };
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 64) || "Passkey";
  const r = db.prepare("INSERT INTO passkeys (username, credential_id, user_handle, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(username, b64u(reg.credentialId), userHandle, JSON.stringify(reg.jwk), reg.alg, reg.signCount, clean, new Date(now).toISOString());
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export function recordPasskeyUse(id: number, signCount: number, now: number = Date.now(), db: DatabaseSync = getDb()): void {
  db.prepare("UPDATE passkeys SET sign_count = ?, last_used = ? WHERE id = ?").run(signCount, new Date(now).toISOString(), id);
}

/** Deletes one passkey of that account (never another account's). */
export const deletePasskey = (username: string, id: number, db: DatabaseSync = getDb()): boolean => Number(db.prepare("DELETE FROM passkeys WHERE id = ? AND username = ?").run(id, username).changes) > 0;
export const deleteAllPasskeys = (username: string, db: DatabaseSync = getDb()): void => void db.prepare("DELETE FROM passkeys WHERE username = ?").run(username);

/** A challenge is valid once, for five minutes, for the ceremony and account it was issued for. */
export function issueChallenge(kind: "register" | "login", username = "", now: number = Date.now(), db: DatabaseSync = getDb()): string {
  db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").run(now);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM webauthn_challenges").get() as { n: number }).n;
  if (n >= MAX_CHALLENGES) db.prepare("DELETE FROM webauthn_challenges WHERE challenge IN (SELECT challenge FROM webauthn_challenges ORDER BY expires_at LIMIT ?)").run(n - MAX_CHALLENGES + 1);
  const c = newChallenge();
  db.prepare("INSERT INTO webauthn_challenges (challenge, kind, username, expires_at) VALUES (?, ?, ?, ?)").run(c, kind, username, now + CHALLENGE_TTL_MS);
  return c;
}

export function consumeChallenge(challenge: string, kind: "register" | "login", now: number = Date.now(), db: DatabaseSync = getDb()): { username: string } | null {
  const r = db.prepare("SELECT kind, username, expires_at FROM webauthn_challenges WHERE challenge = ?").get(challenge) as { kind: string; username: string; expires_at: number } | undefined;
  if (!r) return null;
  db.prepare("DELETE FROM webauthn_challenges WHERE challenge = ?").run(challenge);
  return r.kind === kind && r.expires_at > now ? { username: r.username } : null;
}
