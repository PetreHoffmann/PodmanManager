import type { DatabaseSync } from "node:sqlite";
import { headers } from "next/headers";
import { getDb } from "../database/db";
import { getConfig } from "./config";

export const AUDIT_ACTIONS = [
  "login.ok", "login.fail", "login.denied", "login.blocked", "logout", "password.change",
  "container.start", "container.stop", "container.restart", "pod.start", "pod.stop", "pod.restart",
  "image.delete", "image.prune", "volume.delete", "volume.prune", "network.delete", "network.prune",
  "host.add", "host.remove", "host.enable", "host.disable", "host.update", "master.update",
  "group.save", "group.delete", "user.save", "user.delete", "ldap.save", "saml.save", "branding.save", "hidden.save",
  "backup.download", "backup.restore",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const isAuditAction = (v: unknown): v is AuditAction => typeof v === "string" && (AUDIT_ACTIONS as readonly string[]).includes(v);

/** Fixed detail texts that the log page shows translated (anything else is shown as stored). */
export const DETAIL_KEYS = {
  "unknown user": "unknown", "wrong password": "wrongpw", "disabled": "disabled", "no agent group": "nogroup", "directory unavailable": "unavailable",
  "unknown user or wrong password": "unknownorwrong", "host tokens not readable": "tokens", "invalid file": "invalidfile", "error": "error",
  "created": "created", "changed": "changed", "enabled": "enabled", "reset": "reset", "metadata import": "metaimport",
} as const;

export interface Actor { username: string; kind: string }
export interface AuditInfo { target?: string; host?: string; ok?: boolean; detail?: string; ip?: string }
export interface AuditRow { id: number; ts: string; username: string; kind: string; action: string; target: string; host: string; ok: boolean; detail: string; ip: string }

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g;
const clean = (s: string | undefined, max: number) => (s ?? "").replace(CTRL, " ").trim().slice(0, max);

/** Writes one entry. Never throws: a failing audit write must not block the action it describes. */
export function writeAudit(actor: Actor | null, action: AuditAction, info: AuditInfo = {}, db: DatabaseSync = getDb(), now: Date = new Date()): void {
  try {
    db.prepare("INSERT INTO audit (ts, username, kind, action, target, host, ok, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      now.toISOString(), clean(actor?.username, 128) || "-", clean(actor?.kind, 16) || "-", action,
      clean(info.target, 200), clean(info.host, 128), info.ok === false ? 0 : 1, clean(info.detail, 200), clean(info.ip, 64),
    );
  } catch (e) {
    console.warn(`audit write failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
}

/** Client address as the reverse proxy reports it (not verifiable without a proxy; shown for orientation only). */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const v = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "";
    return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : "";
  } catch {
    return "";
  }
}

export async function audit(actor: Actor | null, action: AuditAction, info: AuditInfo = {}): Promise<void> {
  writeAudit(actor, action, { ...info, ip: info.ip ?? (await clientIp()) });
}

export interface AuditFilter { user?: string; action?: string; result?: "ok" | "fail"; from?: string; to?: string }
export const PAGE_SIZE = 50;

/** Filter taken from a query string (settings page and CSV export share it). */
export const filterFrom = (p: URLSearchParams): AuditFilter => ({
  user: p.get("user")?.slice(0, 128) || undefined,
  action: p.get("action") || undefined,
  result: p.get("result") === "ok" ? "ok" : p.get("result") === "fail" ? "fail" : undefined,
  from: p.get("from") || undefined,
  to: p.get("to") || undefined,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function where(f: AuditFilter): { sql: string; args: (string | number)[] } {
  const c: string[] = [];
  const a: (string | number)[] = [];
  if (f.user) { c.push("username LIKE ? ESCAPE '\\'"); a.push(`%${f.user.replace(/[\\%_]/g, "\\$&")}%`); }
  if (isAuditAction(f.action)) { c.push("action = ?"); a.push(f.action); }
  if (f.result === "ok" || f.result === "fail") { c.push("ok = ?"); a.push(f.result === "ok" ? 1 : 0); }
  if (f.from && DATE_RE.test(f.from)) { c.push("ts >= ?"); a.push(`${f.from}T00:00:00.000Z`); }
  if (f.to && DATE_RE.test(f.to)) { c.push("ts < ?"); a.push(`${new Date(Date.parse(`${f.to}T00:00:00Z`) + 86400_000).toISOString()}`); }
  return { sql: c.length ? `WHERE ${c.join(" AND ")}` : "", args: a };
}

type Raw = Omit<AuditRow, "ok"> & { ok: number };
const toRow = (r: Raw): AuditRow => ({ ...r, ok: !!r.ok });

export function listAudit(f: AuditFilter, page = 1, db: DatabaseSync = getDb()): { rows: AuditRow[]; total: number; pages: number; page: number } {
  const w = where(f);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit ${w.sql}`).get(...w.args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = (db.prepare(`SELECT * FROM audit ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...w.args, PAGE_SIZE, (p - 1) * PAGE_SIZE) as unknown as Raw[]).map(toRow);
  return { rows, total, pages, page: p };
}

const CSV_MAX = 50_000;
/** Spreadsheet programs run cells that start with = + - @ as formulas: neutralize them. */
const cell = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function auditCsv(f: AuditFilter, db: DatabaseSync = getDb()): string {
  const w = where(f);
  const rows = (db.prepare(`SELECT * FROM audit ${w.sql} ORDER BY id DESC LIMIT ?`).all(...w.args, CSV_MAX) as unknown as Raw[]).map(toRow);
  const head = ["time_utc", "user", "kind", "action", "target", "host", "result", "detail", "ip"];
  return [head.join(","), ...rows.map((r) => [r.ts, r.username, r.kind, r.action, r.target, r.host, r.ok ? "ok" : "fail", r.detail, r.ip].map(cell).join(","))].join("\r\n") + "\r\n";
}

export function pruneAudit(days: number = getConfig().auditKeepDays, db: DatabaseSync = getDb(), now: Date = new Date()): number {
  if (days <= 0) return 0;
  const cut = new Date(now.getTime() - days * 86400_000).toISOString();
  return Number(db.prepare("DELETE FROM audit WHERE ts < ?").run(cut).changes);
}

const g = globalThis as unknown as { __pmAuditPrune?: NodeJS.Timeout };
export function startAuditPrune(): void {
  if (g.__pmAuditPrune) return;
  const tick = () => {
    try {
      pruneAudit();
    } catch (e) {
      console.warn(`audit prune failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  };
  g.__pmAuditPrune = setInterval(tick, 3600_000);
  g.__pmAuditPrune.unref();
  tick();
}
