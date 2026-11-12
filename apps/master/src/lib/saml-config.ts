import { X509Certificate } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";

const KEY = "saml";

/** Claim types ADFS uses by default. */
export const DEFAULT_USERNAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn";
export const DEFAULT_GROUP_CLAIM = "http://schemas.xmlsoap.org/claims/Group";

export interface SamlConfig {
  enabled: boolean;
  /** externally reachable address of this master, e.g. https://master.example.com (no path) */
  publicUrl: string;
  /** ADFS: https://adfs.example.com/adfs/services/trust (or http://…, as in the federation metadata) */
  idpEntityId: string;
  /** ADFS: https://adfs.example.com/adfs/ls/ */
  idpSsoUrl: string;
  /** one or more token-signing certificates (PEM) */
  idpCert: string;
  /** claim holding the user name; empty = use the NameID */
  usernameClaim: string;
  /** claim holding the groups */
  groupClaim: string;
  /** group value (e.g. CORP\PodmanAdmins) whose members get access to all agents */
  adminGroup: string;
}

export const EMPTY_SAML: SamlConfig = {
  enabled: false, publicUrl: "", idpEntityId: "", idpSsoUrl: "", idpCert: "",
  usernameClaim: DEFAULT_USERNAME_CLAIM, groupClaim: DEFAULT_GROUP_CLAIM, adminGroup: "",
};

export function loadSamlConfig(db: DatabaseSync = getDb()): SamlConfig | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!r) return null;
  try {
    const o = JSON.parse(r.value) as Partial<SamlConfig>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      enabled: o.enabled === true,
      publicUrl: str(o.publicUrl), idpEntityId: str(o.idpEntityId), idpSsoUrl: str(o.idpSsoUrl), idpCert: str(o.idpCert),
      usernameClaim: typeof o.usernameClaim === "string" ? o.usernameClaim : DEFAULT_USERNAME_CLAIM,
      groupClaim: str(o.groupClaim) || DEFAULT_GROUP_CLAIM, adminGroup: str(o.adminGroup),
    };
  } catch {
    return null;
  }
}

export function saveSamlConfig(cfg: SamlConfig, db: DatabaseSync = getDb()): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(cfg));
}

/** SSO is offered on the login page only when it is enabled and complete. */
export function samlReady(cfg: SamlConfig | null): cfg is SamlConfig {
  return !!cfg && cfg.enabled && !!cfg.publicUrl && !!cfg.idpEntityId && !!cfg.idpSsoUrl && splitCerts(cfg.idpCert).length > 0;
}

export const spEntityId = (cfg: Pick<SamlConfig, "publicUrl">) => `${cfg.publicUrl}/saml/metadata`;
export const spAcsUrl = (cfg: Pick<SamlConfig, "publicUrl">) => `${cfg.publicUrl}/saml/acs`;
export const spMetadataUrl = spEntityId;

const PEM_RE = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;

const wrap = (b64: string) => `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;

/** All certificates in a text, normalised to PEM. Accepts bare base64 (as found in metadata) as well. */
export function splitCerts(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const pems = t.match(PEM_RE);
  if (pems) return pems.map((p) => wrap(p.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "")));
  // bare base64 (as in metadata): no blanks inside, long enough to be a certificate
  if (/^[A-Za-z0-9+/=\r\n]{200,}$/.test(t)) return [wrap(t.replace(/[\r\n]/g, ""))];
  return [];
}

export interface CertInfo {
  subject: string;
  validTo: Date;
  expired: boolean;
}

export function certInfo(pem: string): CertInfo | null {
  try {
    const c = new X509Certificate(pem);
    const validTo = new Date(c.validTo);
    return { subject: c.subject.replace(/\n/g, ", ").slice(0, 200), validTo, expired: validTo.getTime() < Date.now() || new Date(c.validFrom).getTime() > Date.now() };
  } catch {
    return null;
  }
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";

function cleanUrl(input: string, opts: { httpsOnly: boolean; noPath?: boolean }): string | null {
  const t = input.trim();
  if (t.length > 512 || /[\u0000-\u001f\s]/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.username || u.password || u.hash) return null;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (!opts.httpsOnly || isLocalHost(u.hostname)))) return null;
  if (opts.noPath && ((u.pathname !== "/" && u.pathname !== "") || u.search)) return null;
  return opts.noPath ? u.origin : u.toString();
}

const bounded = (s: string, max: number) => s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

export type SamlParseError = "err.samlPublicUrl" | "err.samlSsoUrl" | "err.samlEntityId" | "err.samlCert" | "err.samlClaim" | "err.samlGroupValue";
export type SamlParseResult = { ok: true; config: SamlConfig } | { ok: false; error: SamlParseError };

/** Validates form input. */
export function parseSamlInput(input: SamlConfig): SamlParseResult {
  const publicUrl = input.publicUrl.trim() ? cleanUrl(input.publicUrl, { httpsOnly: false, noPath: true }) : "";
  if (publicUrl === null) return { ok: false, error: "err.samlPublicUrl" };
  // The IdP is contacted by the browser; it must be https (http only for local tests).
  const idpSsoUrl = input.idpSsoUrl.trim() ? cleanUrl(input.idpSsoUrl, { httpsOnly: true }) : "";
  if (idpSsoUrl === null) return { ok: false, error: "err.samlSsoUrl" };
  const idpEntityId = input.idpEntityId.trim();
  if (!bounded(idpEntityId, 512) || /\s/.test(idpEntityId)) return { ok: false, error: "err.samlEntityId" };
  const certs = splitCerts(input.idpCert);
  if (input.idpCert.trim() && (certs.length === 0 || certs.some((c) => certInfo(c) === null))) return { ok: false, error: "err.samlCert" };
  const usernameClaim = input.usernameClaim.trim();
  const groupClaim = input.groupClaim.trim() || DEFAULT_GROUP_CLAIM;
  if (!bounded(usernameClaim, 256) || !bounded(groupClaim, 256) || /\s/.test(usernameClaim) || /\s/.test(groupClaim)) return { ok: false, error: "err.samlClaim" };
  const adminGroup = input.adminGroup.trim();
  if (!bounded(adminGroup, 256)) return { ok: false, error: "err.samlGroupValue" };
  const config: SamlConfig = { enabled: input.enabled, publicUrl, idpEntityId, idpSsoUrl, idpCert: certs.join("\n"), usernameClaim, groupClaim, adminGroup };
  if (config.enabled && !samlReady(config)) return { ok: false, error: !publicUrl ? "err.samlPublicUrl" : !idpSsoUrl ? "err.samlSsoUrl" : !idpEntityId ? "err.samlEntityId" : "err.samlCert" };
  return { ok: true, config };
}
