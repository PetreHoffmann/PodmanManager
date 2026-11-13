import { Client, InvalidCredentialsError } from "ldapts";
import { formatDisplayName } from "./display-name";
import { DEFAULT_FILTER, type GroupMode } from "./ldap-presets";
export { DEFAULT_FILTER };

export interface LdapConfig {
  enabled: boolean;
  url: string;
  startTls: boolean;
  caCert: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  filter: string;
  groupDn: string;
  /** attribute names; the defaults are those of Active Directory (see ldap-presets.ts) */
  accountAttr: string;
  displayAttr: string;
  groupMode: GroupMode;
  memberAttr: string;
}

/** AD matching rule "in chain": direct and nested group membership. */
export const CHAIN_OID = "1.2.840.113556.1.4.1941";

export type LdapErrorCode = "LDAP_CONNECT" | "LDAP_BIND" | "LDAP_TLS" | "LDAP_SEARCH";

export class LdapError extends Error {
  constructor(readonly code: LdapErrorCode, message: string) {
    super(message);
  }
}

/** RFC 4515 filter value escaping. */
export function escapeFilterValue(s: string): string {
  return s.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

export interface LdapEntry {
  dn: string;
  [k: string]: unknown;
}

/** Subset of the ldapts Client used here (also implemented by test doubles). */
export interface LdapClientLike {
  startTLS(options: { ca?: string[]; rejectUnauthorized: boolean }): Promise<void>;
  bind(dn: string, password: string): Promise<void>;
  search(
    base: string,
    options: { scope: "base" | "sub"; filter: string; attributes: string[]; sizeLimit?: number },
  ): Promise<{ searchEntries: LdapEntry[] }>;
  unbind(): Promise<void>;
}

export type ClientFactory = (cfg: LdapConfig) => LdapClientLike;

const tlsOptions = (cfg: LdapConfig) => ({
  ...(cfg.caCert ? { ca: [cfg.caCert] } : {}),
  rejectUnauthorized: true,
});

export const defaultFactory: ClientFactory = (cfg) =>
  new Client({
    url: cfg.url,
    timeout: 8000,
    connectTimeout: 5000,
    strictDN: false,
    ...(cfg.url.startsWith("ldaps://") ? { tlsOptions: tlsOptions(cfg) } : {}),
  }) as unknown as LdapClientLike;

function mapError(e: unknown, fallback: LdapErrorCode): LdapError {
  if (e instanceof LdapError) return e;
  const code = String((e as { code?: unknown })?.code ?? "");
  const msg = e instanceof Error ? e.message : "";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL|ERR_OSSL/i.test(code + " " + msg)) {
    return new LdapError("LDAP_TLS", "TLS error");
  }
  if (/ECONN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|timed? ?out|socket/i.test(code + " " + msg)) {
    return new LdapError("LDAP_CONNECT", "connect failed");
  }
  return new LdapError(fallback, fallback === "LDAP_BIND" ? "bind failed" : "search failed");
}

const isInvalidCredentials = (e: unknown) =>
  e instanceof InvalidCredentialsError || (e as { code?: unknown })?.code === 49;

async function open(cfg: LdapConfig, factory: ClientFactory): Promise<LdapClientLike> {
  const c = factory(cfg);
  try {
    if (cfg.startTls && cfg.url.startsWith("ldap://")) await c.startTLS(tlsOptions(cfg));
  } catch (e) {
    await c.unbind().catch(() => {});
    throw mapError(e, "LDAP_CONNECT");
  }
  return c;
}

async function serviceBind(cfg: LdapConfig, factory: ClientFactory): Promise<LdapClientLike> {
  const c = await open(cfg, factory);
  try {
    await c.bind(cfg.bindDn, cfg.bindPassword);
  } catch (e) {
    await c.unbind().catch(() => {});
    throw isInvalidCredentials(e) ? new LdapError("LDAP_BIND", "service bind rejected") : mapError(e, "LDAP_BIND");
  }
  return c;
}

export async function findUser(c: LdapClientLike, cfg: LdapConfig, username: string): Promise<LdapEntry | null> {
  const filter = cfg.filter.split("{username}").join(escapeFilterValue(username));
  try {
    const { searchEntries } = await c.search(cfg.baseDn, {
      scope: "sub",
      filter,
      attributes: ["dn", cfg.accountAttr, cfg.displayAttr],
      sizeLimit: 2,
    });
    return searchEntries.length === 1 ? searchEntries[0]! : null;
  } catch (e) {
    if ((e as { code?: unknown })?.code === 4) return null; // sizeLimitExceeded: ambiguous
    throw mapError(e, "LDAP_SEARCH");
  }
}

/** The value of an attribute of an entry; attribute names are compared case-insensitively (servers return them in their own spelling). */
export function attrValue(entry: LdapEntry, name: string): unknown {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : entry[key];
}

/** The first non-empty text of an attribute (ldapts returns a string, or a list for multi-valued attributes). */
export function attrText(entry: LdapEntry, name: string): string {
  const v = attrValue(entry, name);
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === "string" ? first.trim() : "";
}

export interface LdapUser {
  dn: string;
  /** account (login) name as the directory knows it */
  account: string;
}

/** Membership of the user in a group, as configured (cfg.groupMode); only Active Directory's mode includes nested groups. */
export async function isMember(c: LdapClientLike, cfg: Pick<LdapConfig, "groupMode" | "memberAttr">, user: LdapUser, groupDn: string): Promise<boolean> {
  try {
    if (cfg.groupMode === "group") {
      // the group entry lists its members: by DN (member, uniqueMember) or by login name (memberUid)
      const attr = cfg.memberAttr || "member";
      const value = attr.toLowerCase() === "memberuid" ? user.account : user.dn;
      if (!value) return false;
      const { searchEntries } = await c.search(groupDn, { scope: "base", filter: `(${attr}=${escapeFilterValue(value)})`, attributes: ["dn"], sizeLimit: 1 });
      return searchEntries.length === 1;
    }
    const filter = cfg.groupMode === "user" ? `(${cfg.memberAttr || "memberOf"}=${escapeFilterValue(groupDn)})` : `(memberOf:${CHAIN_OID}:=${escapeFilterValue(groupDn)})`;
    const { searchEntries } = await c.search(user.dn, { scope: "base", filter, attributes: ["dn"], sizeLimit: 1 });
    return searchEntries.length === 1;
  } catch (e) {
    // a group that does not exist is simply no membership
    if ((e as { code?: unknown })?.code === 32) return false;
    throw mapError(e, "LDAP_SEARCH");
  }
}

/** An agent group mapped to an AD group. */
export interface MappedGroup {
  id: number;
  name: string;
  dn: string;
}

export type LdapAuthResult =
  | { ok: true; username: string; dn: string; admin: boolean; groupIds: number[]; displayName?: string }
  | { ok: false; reason: "invalid" | "not_member" | "disabled" }
  | { ok: false; reason: "unavailable"; code: LdapErrorCode };

export async function authenticateLdap(
  cfg: LdapConfig,
  username: string,
  password: string,
  mapped: MappedGroup[] = [],
  factory: ClientFactory = defaultFactory,
): Promise<LdapAuthResult> {
  if (!cfg.enabled) return { ok: false, reason: "disabled" };
  // An empty password would turn the user bind into an anonymous (successful) bind.
  if (!username || username.length > 256 || username.includes("\0") || !password || password.length > 1024) {
    return { ok: false, reason: "invalid" };
  }

  let user: LdapEntry | null;
  let member: LdapUser = { dn: "", account: username };
  let admin = false;
  const groupIds: number[] = [];
  const svc = await serviceBind(cfg, factory).catch((e: LdapError) => e);
  if (svc instanceof LdapError) return { ok: false, reason: "unavailable", code: svc.code };
  try {
    user = await findUser(svc, cfg, username);
    if (!user) return { ok: false, reason: "invalid" };
    // Administrators group first (full access); otherwise collect the mapped agent groups.
    member = { dn: user.dn, account: attrText(user, cfg.accountAttr) || username };
    admin = cfg.groupDn ? await isMember(svc, cfg, member, cfg.groupDn) : false;
    if (!admin) {
      for (const g of mapped) if (await isMember(svc, cfg, member, g.dn)) groupIds.push(g.id);
    }
    if (!admin && groupIds.length === 0) return { ok: false, reason: "not_member" };
  } catch (e) {
    return { ok: false, reason: "unavailable", code: (e as LdapError).code ?? "LDAP_SEARCH" };
  } finally {
    await svc.unbind().catch(() => {});
  }

  let uc: LdapClientLike | null = null;
  try {
    uc = await open(cfg, factory);
    await uc.bind(user.dn, password);
  } catch (e) {
    if (isInvalidCredentials(e)) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "unavailable", code: mapError(e, "LDAP_BIND").code };
  } finally {
    await uc?.unbind().catch(() => {});
  }
  const account = attrText(user, cfg.accountAttr) || username;
  const display = formatDisplayName(attrText(user, cfg.displayAttr), account);
  return { ok: true, username: account, dn: user.dn, admin, groupIds: admin ? [] : groupIds, ...(display ? { displayName: display } : {}) };
}

export interface LdapTestStep {
  key: "conn" | "group" | "groupMissing" | "mapOk" | "mapMissing" | "userOk" | "userNoMember" | "userNone";
  ok: boolean;
  /** group name (map*) or access description (userOk) */
  name?: string;
}

async function groupExists(c: LdapClientLike, dn: string): Promise<boolean> {
  try {
    const g = await c.search(dn, { scope: "base", filter: "(objectClass=*)", attributes: ["dn"], sizeLimit: 1 });
    return g.searchEntries.length > 0;
  } catch (e) {
    if ((e as { code?: unknown })?.code === 32) return false;
    throw mapError(e, "LDAP_SEARCH");
  }
}

/**
 * Diagnoses a configuration without verifying any user password. Throws LdapError on connection problems.
 * `accessAll` is the text used for administrators-group members.
 */
export async function testLdap(
  cfg: LdapConfig,
  testUser: string,
  mapped: MappedGroup[] = [],
  accessAll = "*",
  factory: ClientFactory = defaultFactory,
): Promise<LdapTestStep[]> {
  const steps: LdapTestStep[] = [];
  const c = await serviceBind(cfg, factory);
  try {
    steps.push({ key: "conn", ok: true });
    if (cfg.groupDn) steps.push((await groupExists(c, cfg.groupDn)) ? { key: "group", ok: true } : { key: "groupMissing", ok: false });
    for (const g of mapped) steps.push((await groupExists(c, g.dn)) ? { key: "mapOk", ok: true, name: g.name } : { key: "mapMissing", ok: false, name: g.name });
    if (testUser) {
      const u = await findUser(c, cfg, testUser);
      if (!u) {
        steps.push({ key: "userNone", ok: false });
      } else if (cfg.groupDn && (await isMember(c, cfg, { dn: u.dn, account: attrText(u, cfg.accountAttr) || testUser }, cfg.groupDn))) {
        steps.push({ key: "userOk", ok: true, name: accessAll });
      } else {
        const names: string[] = [];
        for (const g of mapped) if (await isMember(c, cfg, { dn: u.dn, account: attrText(u, cfg.accountAttr) || testUser }, g.dn)) names.push(g.name);
        steps.push(names.length ? { key: "userOk", ok: true, name: names.join(", ") } : { key: "userNoMember", ok: false });
      }
    }
  } finally {
    await c.unbind().catch(() => {});
  }
  return steps;
}
