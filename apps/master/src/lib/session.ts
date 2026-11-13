import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import type { SessionInfo } from "./session-types";

export type { SessionInfo } from "./session-types";

export const COOKIE = "pm_session";
const TTL_MS = 8 * 3600 * 1000;
export const LOCAL_ADMIN = "admin";
export const LOCAL_SESSION: SessionInfo = { username: "admin", kind: "local", access: "all", groupIds: [] };


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
  db.prepare("INSERT INTO sessions (token_hash, expires_at, username, kind, access, group_ids, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    sha256(token), Date.now() + TTL_MS, info.username, info.kind, info.access, JSON.stringify(info.groupIds), info.displayName ?? null,
  );
  return token;
}

export function getSession(token: string | undefined, db: DatabaseSync = getDb()): SessionInfo | null {
  if (!token) return null;
  const r = db.prepare("SELECT expires_at, username, kind, access, group_ids, display_name FROM sessions WHERE token_hash = ?").get(sha256(token)) as
    | { expires_at: number; username: string | null; kind: string | null; access: string | null; group_ids: string | null; display_name: string | null }
    | undefined;
  if (!r || r.expires_at <= Date.now() || !r.username) return null;
  let groupIds: number[] = [];
  try {
    const g = JSON.parse(r.group_ids ?? "[]");
    if (Array.isArray(g)) groupIds = g.filter((x): x is number => Number.isInteger(x));
  } catch {
    /* ignore */
  }
  const kind = r.kind === "ldap" ? "ldap" : r.kind === "saml" ? "saml" : "local";
  // Unknown or missing access values never widen permissions: only local sessions default to "all".
  const access = r.access === "all" || (r.access === null && kind === "local") ? "all" : "groups";
  return { username: r.username, kind, access, groupIds, ...(r.display_name ? { displayName: r.display_name } : {}) };
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

/** Records a failed login; returns how many failures this name has within the last minute (5 block it). */
export function recordLoginFailure(key: string, now = Date.now()): number {
  const k = key.toLowerCase().slice(0, 256);
  const list = [...prune(byKey.get(k) ?? [], now), now];
  byKey.set(k, list);
  global.push(now);
  if (byKey.size > 5000) byKey.clear();
  return list.length;
}
