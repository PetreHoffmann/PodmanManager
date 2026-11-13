import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { hashPassword, verifyPassword } from "./crypto";
import type { SessionInfo } from "./session-types";

export const MAX_USERS = 500;
export const MIN_USER_PW = 10;
export const RESERVED_NAME = "admin";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;

export interface LocalUser {
  id: number;
  username: string;
  isAdmin: boolean;
  enabled: boolean;
  mustChange: boolean;
  groupIds: number[];
}

export type UserErr = "err.userName" | "err.userDup" | "err.userPw" | "err.userLimit" | "err.userNotFound";
export type UserResult = { ok: true; id: number } | { ok: false; error: UserErr };

type Row = { id: number; username: string; is_admin: number; enabled: number; must_change: number };
const toUser = (r: Row, groupIds: number[]): LocalUser => ({ id: r.id, username: r.username, isAdmin: !!r.is_admin, enabled: !!r.enabled, mustChange: !!r.must_change, groupIds });

export function listUsers(db: DatabaseSync = getDb()): LocalUser[] {
  const rows = db.prepare("SELECT id, username, is_admin, enabled, must_change FROM users ORDER BY username COLLATE NOCASE").all() as unknown as Row[];
  const m = db.prepare("SELECT user_id, group_id FROM user_groups").all() as unknown as { user_id: number; group_id: number }[];
  return rows.map((r) => toUser(r, m.filter((x) => x.user_id === r.id).map((x) => x.group_id).sort((a, b) => a - b)));
}

export function getUserByName(name: string, db: DatabaseSync = getDb()): LocalUser | null {
  const r = db.prepare("SELECT id, username, is_admin, enabled, must_change FROM users WHERE username = ?").get(name) as unknown as Row | undefined;
  if (!r) return null;
  const g = db.prepare("SELECT group_id FROM user_groups WHERE user_id = ?").all(r.id) as unknown as { group_id: number }[];
  return toUser(r, g.map((x) => x.group_id).sort((a, b) => a - b));
}

/** Drops all sessions of a local user (after a change of password, groups, rights or state). */
export function dropUserSessions(username: string, db: DatabaseSync = getDb()): void {
  db.prepare("DELETE FROM sessions WHERE kind = 'user' AND username = ? COLLATE NOCASE").run(username);
}

export type UserInput = { id?: number; username: string; password?: string; isAdmin: boolean; enabled: boolean; mustChange: boolean; groupIds: number[] };

export async function saveUser(input: UserInput, db: DatabaseSync = getDb()): Promise<UserResult> {
  const name = input.username.trim();
  const pw = input.password ?? "";
  if (input.id === undefined) {
    if (!NAME_RE.test(name) || name.toLowerCase() === RESERVED_NAME) return { ok: false, error: "err.userName" };
    if (pw.length < MIN_USER_PW) return { ok: false, error: "err.userPw" };
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(name)) return { ok: false, error: "err.userDup" };
    if ((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n >= MAX_USERS) return { ok: false, error: "err.userLimit" };
  } else if (pw && pw.length < MIN_USER_PW) return { ok: false, error: "err.userPw" };
  const hash = pw ? await hashPassword(pw) : null;
  let id = input.id;
  let uname = name;
  db.exec("BEGIN");
  try {
    if (id === undefined) {
      id = Number(db.prepare("INSERT INTO users (username, password_hash, is_admin, enabled, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(name, hash!, input.isAdmin ? 1 : 0, input.enabled ? 1 : 0, input.mustChange ? 1 : 0, new Date().toISOString()).lastInsertRowid);
    } else {
      const cur = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as { username: string } | undefined;
      if (!cur) { db.exec("ROLLBACK"); return { ok: false, error: "err.userNotFound" }; }
      uname = cur.username;
      db.prepare("UPDATE users SET is_admin = ?, enabled = ?, must_change = ? WHERE id = ?").run(input.isAdmin ? 1 : 0, input.enabled ? 1 : 0, input.mustChange ? 1 : 0, id);
      if (hash) db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
      db.prepare("DELETE FROM user_groups WHERE user_id = ?").run(id);
    }
    const exists = db.prepare("SELECT 1 FROM agent_groups WHERE id = ?");
    const ins = db.prepare("INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)");
    for (const g of new Set(input.groupIds)) if (Number.isInteger(g) && exists.get(g)) ins.run(id, g);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  dropUserSessions(uname, db);
  return { ok: true, id };
}

export function deleteUser(id: number, db: DatabaseSync = getDb()): void {
  const r = db.prepare("SELECT username FROM users WHERE id = ?").get(id) as { username: string } | undefined;
  if (!r) return;
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  dropUserSessions(r.username, db);
}

// Hash checked for unknown names, so the time taken does not reveal whether a user exists.
let dummy: Promise<string> | undefined;

export type UserAuth =
  | { ok: true; user: LocalUser }
  | { ok: false; reason: "unknown" | "invalid" | "disabled" | "no_group" };

/** Local user login: unknown and wrong-password cases are indistinguishable to the caller of the UI (only the log differs). */
export async function authenticateUser(name: string, password: string, db: DatabaseSync = getDb()): Promise<UserAuth> {
  const r = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(name) as { password_hash: string } | undefined;
  if (!r) {
    dummy ??= hashPassword("dummy-password");
    await verifyPassword(password, await dummy);
    return { ok: false, reason: "unknown" };
  }
  if (!(await verifyPassword(password, r.password_hash))) return { ok: false, reason: "invalid" };
  const u = getUserByName(name, db)!;
  if (!u.enabled) return { ok: false, reason: "disabled" };
  if (!u.isAdmin && u.groupIds.length === 0) return { ok: false, reason: "no_group" };
  return { ok: true, user: u };
}

export const sessionFor = (u: LocalUser): SessionInfo => ({ username: u.username, kind: "user", access: u.isAdmin ? "all" : "groups", groupIds: u.isAdmin ? [] : u.groupIds });

export async function checkUserPassword(name: string, pw: string, db: DatabaseSync = getDb()): Promise<boolean> {
  const r = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(name) as { password_hash: string } | undefined;
  return r ? verifyPassword(pw, r.password_hash) : false;
}

/** Own password change: clears the "must change" flag; other sessions of the user end. */
export async function setUserPassword(name: string, pw: string, db: DatabaseSync = getDb()): Promise<void> {
  db.prepare("UPDATE users SET password_hash = ?, must_change = 0 WHERE username = ?").run(await hashPassword(pw), name);
  dropUserSessions(name, db);
}
