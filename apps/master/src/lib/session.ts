import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

export const COOKIE = "pm_session";
const TTL_MS = 8 * 3600 * 1000;
export const LOCAL_ADMIN = "admin";

export interface SessionInfo {
  username: string;
  kind: "local" | "ldap";
}

export const adminExists = (db: DatabaseSync = getDb()) => !!db.prepare("SELECT 1 FROM admin WHERE id = 1").get();

export async function setAdminPassword(pw: string, db: DatabaseSync = getDb()): Promise<void> {
  db.prepare("INSERT INTO admin (id, password_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash").run(await hashPassword(pw));
  db.exec("DELETE FROM sessions");
}

export async function checkAdminPassword(pw: string, db: DatabaseSync = getDb()): Promise<boolean> {
  const r = db.prepare("SELECT password_hash FROM admin WHERE id = 1").get() as { password_hash: string } | undefined;
  return r ? verifyPassword(pw, r.password_hash) : false;
}

export function createSession(info: SessionInfo, db: DatabaseSync = getDb()): string {
  const token = randomToken();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, expires_at, username, kind) VALUES (?, ?, ?, ?)").run(sha256(token), Date.now() + TTL_MS, info.username, info.kind);
  return token;
}

export function getSession(token: string | undefined, db: DatabaseSync = getDb()): SessionInfo | null {
  if (!token) return null;
  const r = db.prepare("SELECT expires_at, username, kind FROM sessions WHERE token_hash = ?").get(sha256(token)) as
    | { expires_at: number; username: string | null; kind: string | null }
    | undefined;
  if (!r || r.expires_at <= Date.now() || !r.username) return null;
  return { username: r.username, kind: r.kind === "ldap" ? "ldap" : "local" };
}

export async function startSession(info: SessionInfo): Promise<void> {
  (await cookies()).set(COOKIE, createSession(info), {
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
export async function requireAuth(): Promise<SessionInfo> {
  if (!adminExists()) redirect("/setup");
  const s = getSession((await cookies()).get(COOKIE)?.value);
  if (!s) redirect("/login");
  return s;
}

/** Login throttling: per login name and globally, sliding 60 s window. */
const byKey = new Map<string, number[]>();
let global: number[] = [];
const prune = (l: number[], now: number) => l.filter((t) => t > now - 60_000);

export function loginBlocked(key: string, now = Date.now()): boolean {
  global = prune(global, now);
  const k = key.toLowerCase().slice(0, 256);
  const l = prune(byKey.get(k) ?? [], now);
  if (l.length) byKey.set(k, l); else byKey.delete(k);
  return l.length >= 5 || global.length >= 60;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const k = key.toLowerCase().slice(0, 256);
  byKey.set(k, [...prune(byKey.get(k) ?? [], now), now]);
  global.push(now);
  if (byKey.size > 5000) byKey.clear();
}
