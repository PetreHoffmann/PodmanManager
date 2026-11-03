import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { decryptSecret, encryptSecret } from "./crypto";
import { DEFAULT_FILTER, type LdapConfig } from "./ldap";

const KEY = "ldap";

interface Stored extends Omit<LdapConfig, "bindPassword"> {
  bindPasswordEnc: string;
}

export const EMPTY_LDAP: LdapConfig = {
  enabled: false, url: "", startTls: false, caCert: "", bindDn: "", bindPassword: "", baseDn: "",
  filter: DEFAULT_FILTER, groupDn: "",
};

export function loadLdapConfig(db: DatabaseSync = getDb()): LdapConfig | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!r) return null;
  try {
    const s = JSON.parse(r.value) as Stored;
    const { bindPasswordEnc, ...rest } = s;
    return { ...rest, bindPassword: bindPasswordEnc ? decryptSecret(bindPasswordEnc) : "" };
  } catch {
    return null;
  }
}

export function saveLdapConfig(cfg: LdapConfig, db: DatabaseSync = getDb()): void {
  const { bindPassword, ...rest } = cfg;
  const stored: Stored = { ...rest, bindPasswordEnc: bindPassword ? encryptSecret(bindPassword) : "" };
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(stored));
}

export type ParseResult =
  | { ok: true; config: LdapConfig }
  | { ok: false; error: "err.ldapUrl" | "err.ldapField" | "err.ldapFilter" | "err.ldapCa" | "err.ldapNeedPw"; params?: Record<string, string> };

const URL_RE = /^ldaps?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const bounded = (s: string, max = 512) => s.length > 0 && s.length <= max && !s.includes("\0");

/** Validates form input; an empty password keeps the existing one. */
export function parseLdapInput(
  input: { enabled: boolean; url: string; startTls: boolean; caCert: string; bindDn: string; bindPassword: string; baseDn: string; filter: string; groupDn: string },
  existing: LdapConfig | null,
): ParseResult {
  const url = input.url.trim().replace(/\/$/, "");
  if (!URL_RE.test(url)) return { ok: false, error: "err.ldapUrl" };
  const port = /:(\d+)$/.exec(url)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return { ok: false, error: "err.ldapUrl" };
  const bindDn = input.bindDn.trim();
  if (!bounded(bindDn)) return { ok: false, error: "err.ldapField", params: { field: "bind" } };
  const baseDn = input.baseDn.trim();
  if (!bounded(baseDn)) return { ok: false, error: "err.ldapField", params: { field: "base DN" } };
  const groupDn = input.groupDn.trim(); // optional: administrators group
  if (groupDn && !bounded(groupDn)) return { ok: false, error: "err.ldapField", params: { field: "group DN" } };
  const filter = input.filter.trim() || DEFAULT_FILTER;
  if (!filter.includes("{username}") || !filter.startsWith("(") || !filter.endsWith(")") || filter.length > 1024 || filter.includes("\0")) {
    return { ok: false, error: "err.ldapFilter" };
  }
  const ca = input.caCert.trim();
  if (ca && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----(\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----)*$/.test(ca)) {
    return { ok: false, error: "err.ldapCa" };
  }
  const bindPassword = input.bindPassword || existing?.bindPassword || "";
  if (!bindPassword) return { ok: false, error: "err.ldapNeedPw" };
  if (bindPassword.length > 1024) return { ok: false, error: "err.ldapField", params: { field: "password" } };
  return {
    ok: true,
    config: { enabled: input.enabled, url, startTls: input.startTls && url.startsWith("ldap://"), caCert: ca, bindDn, bindPassword, baseDn, filter, groupDn },
  };
}
