import { Client, InvalidCredentialsError } from "ldapts";

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
}

export const DEFAULT_FILTER =
  "(&(objectClass=user)(objectCategory=person)(|(sAMAccountName={username})(userPrincipalName={username})))";
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
      attributes: ["dn", "sAMAccountName", "displayName"],
      sizeLimit: 2,
    });
    return searchEntries.length === 1 ? searchEntries[0]! : null;
  } catch (e) {
    if ((e as { code?: unknown })?.code === 4) return null; // sizeLimitExceeded: ambiguous
    throw mapError(e, "LDAP_SEARCH");
  }
}

/** Direct or nested membership of userDn in groupDn. */
export async function isMember(c: LdapClientLike, userDn: string, groupDn: string): Promise<boolean> {
  try {
    const { searchEntries } = await c.search(userDn, {
      scope: "base",
      filter: `(memberOf:${CHAIN_OID}:=${escapeFilterValue(groupDn)})`,
      attributes: ["dn"],
      sizeLimit: 1,
    });
    return searchEntries.length === 1;
  } catch (e) {
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
  | { ok: true; username: string; dn: string; admin: boolean; groupIds: number[] }
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
  let admin = false;
  const groupIds: number[] = [];
  const svc = await serviceBind(cfg, factory).catch((e: LdapError) => e);
  if (svc instanceof LdapError) return { ok: false, reason: "unavailable", code: svc.code };
  try {
    user = await findUser(svc, cfg, username);
    if (!user) return { ok: false, reason: "invalid" };
    // Administrators group first (full access); otherwise collect the mapped agent groups.
    admin = cfg.groupDn ? await isMember(svc, user.dn, cfg.groupDn) : false;
    if (!admin) {
      for (const g of mapped) if (await isMember(svc, user.dn, g.dn)) groupIds.push(g.id);
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
  const sam = user["sAMAccountName"];
  return { ok: true, username: typeof sam === "string" && sam ? sam : username, dn: user.dn, admin, groupIds: admin ? [] : groupIds };
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
      } else if (cfg.groupDn && (await isMember(c, u.dn, cfg.groupDn))) {
        steps.push({ key: "userOk", ok: true, name: accessAll });
      } else {
        const names: string[] = [];
        for (const g of mapped) if (await isMember(c, u.dn, g.dn)) names.push(g.name);
        steps.push(names.length ? { key: "userOk", ok: true, name: names.join(", ") } : { key: "userNoMember", ok: false });
      }
    }
  } finally {
    await c.unbind().catch(() => {});
  }
  return steps;
}
