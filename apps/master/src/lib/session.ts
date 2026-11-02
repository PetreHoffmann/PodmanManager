import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

export const COOKIE = "pm_session";
const TTL_MS = 8 * 3600 * 1000;

export const adminExists = (db: DatabaseSync = getDb()) => !!db.prepare("SELECT 1 FROM admin WHERE id = 1").get();

export async function setAdminPassword(pw: string, db: DatabaseSync = getDb()): Promise<void> {
  db.prepare("INSERT INTO admin (id, password_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash").run(await hashPassword(pw));
  db.exec("DELETE FROM sessions");
}

export async function checkAdminPassword(pw: string, db: DatabaseSync = getDb()): Promise<boolean> {
  const r = db.prepare("SELECT password_hash FROM admin WHERE id = 1").get() as { password_hash: string } | undefined;
  return r ? verifyPassword(pw, r.password_hash) : false;
}

export function createSession(db: DatabaseSync = getDb()): string {
  const token = randomToken();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").run(sha256(token), Date.now() + TTL_MS);
  return token;
}

export function validSession(token: string | undefined, db: DatabaseSync = getDb()): boolean {
  if (!token) return false;
  const r = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(sha256(token)) as { expires_at: number } | undefined;
  return !!r && r.expires_at > Date.now();
}

export async function startSession(): Promise<void> {
  (await cookies()).set(COOKIE, createSession(), {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: TTL_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(t));
  jar.delete(COOKIE);
}

/** Call at the top of every page and server action. */
export async function requireAuth(): Promise<void> {
  if (!adminExists()) redirect("/setup");
  if (!validSession((await cookies()).get(COOKIE)?.value)) redirect("/login");
}

/** Simple global limiter for login attempts. */
const fails: number[] = [];
export function loginBlocked(now = Date.now()): boolean {
  while (fails.length && fails[0]! < now - 60_000) fails.shift();
  return fails.length >= 5;
}
export const recordLoginFailure = () => void fails.push(Date.now());
