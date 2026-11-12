import type { SamlConfig } from "./saml-config";

/** An agent group mapped to a group value sent by ADFS. */
export interface MappedSamlGroup {
  id: number;
  name: string;
  samlGroup: string;
}

export type SamlAccess = { ok: true; admin: boolean; groupIds: number[] } | { ok: false; reason: "no_group" };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Same rules as for LDAP: members of the administrator group see everything, members of mapped groups see the
 * agents of those groups (union), everybody else is turned away. Values are compared case-insensitively,
 * exactly as sent (e.g. `CORP\Team-A`).
 */
export function resolveSamlAccess(cfg: Pick<SamlConfig, "adminGroup">, claimGroups: string[], mapped: MappedSamlGroup[]): SamlAccess {
  const have = new Set(claimGroups.map(norm));
  const admin = cfg.adminGroup.trim() !== "" && have.has(norm(cfg.adminGroup));
  const groupIds = mapped.filter((g) => g.samlGroup.trim() !== "" && have.has(norm(g.samlGroup))).map((g) => g.id);
  if (!admin && groupIds.length === 0) return { ok: false, reason: "no_group" };
  return { ok: true, admin, groupIds };
}

/** Only local paths come back from the IdP as relay target. */
export function safeNext(path: string): string {
  return /^\/(?!\/)[A-Za-z0-9/_\-.]{0,200}$/.test(path) && !path.includes("..") ? path : "/";
}
