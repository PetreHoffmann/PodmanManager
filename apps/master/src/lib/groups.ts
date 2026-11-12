import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import type { SessionInfo } from "./session-types";

export interface AgentGroup {
  id: number;
  name: string;
  /** AD group for LDAP login ("" if the group is only used for SAML) */
  ad_group_dn: string;
  /** group value sent by ADFS for SAML login, e.g. CORP\Team-A ("" if only used for LDAP) */
  saml_group: string;
  agentIds: number[];
}

export const MAX_GROUPS = 200;

export function listGroups(db: DatabaseSync = getDb()): AgentGroup[] {
  const groups = db.prepare("SELECT id, name, ad_group_dn, saml_group FROM agent_groups ORDER BY name COLLATE NOCASE").all() as unknown as Omit<AgentGroup, "agentIds">[];
  const members = db.prepare("SELECT group_id, agent_id FROM agent_group_members").all() as unknown as { group_id: number; agent_id: number }[];
  return groups.map((g) => ({ ...g, agentIds: members.filter((m) => m.group_id === g.id).map((m) => m.agent_id).sort((a, b) => a - b) }));
}

export type GroupInput = { id?: number; name: string; adGroupDn: string; samlGroup?: string; agentIds: number[] };
export type GroupResult = { ok: true; id: number } | { ok: false; error: "err.groupName" | "err.groupDn" | "err.groupSaml" | "err.groupNeedOne" | "err.groupDup" | "err.groupLimit" | "err.groupNotFound" };

/** Creates or updates a group and replaces its agent membership. */
export function saveGroup(input: GroupInput, db: DatabaseSync = getDb()): GroupResult {
  const name = input.name.trim();
  const dn = input.adGroupDn.trim();
  const saml = (input.samlGroup ?? "").trim();
  if (!name || name.length > 64 || name.includes("\0")) return { ok: false, error: "err.groupName" };
  if (dn.length > 512 || dn.includes("\0")) return { ok: false, error: "err.groupDn" };
  if (saml.length > 256 || /[\u0000-\u001f\u007f]/.test(saml)) return { ok: false, error: "err.groupSaml" };
  if (!dn && !saml) return { ok: false, error: "err.groupNeedOne" };
  const dup = db.prepare("SELECT id FROM agent_groups WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | undefined;
  if (dup && dup.id !== input.id) return { ok: false, error: "err.groupDup" };

  let id = input.id;
  db.exec("BEGIN");
  try {
    if (id === undefined) {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM agent_groups").get() as { n: number }).n;
      if (n >= MAX_GROUPS) {
        db.exec("ROLLBACK");
        return { ok: false, error: "err.groupLimit" };
      }
      id = Number(db.prepare("INSERT INTO agent_groups (name, ad_group_dn, saml_group) VALUES (?, ?, ?)").run(name, dn, saml).lastInsertRowid);
    } else {
      const r = db.prepare("UPDATE agent_groups SET name = ?, ad_group_dn = ?, saml_group = ? WHERE id = ?").run(name, dn, saml, id);
      if (Number(r.changes) === 0) {
        db.exec("ROLLBACK");
        return { ok: false, error: "err.groupNotFound" };
      }
      db.prepare("DELETE FROM agent_group_members WHERE group_id = ?").run(id);
    }
    const exists = db.prepare("SELECT 1 FROM agents WHERE id = ?");
    const ins = db.prepare("INSERT OR IGNORE INTO agent_group_members (group_id, agent_id) VALUES (?, ?)");
    for (const a of new Set(input.agentIds)) if (Number.isInteger(a) && exists.get(a)) ins.run(id, a);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, id };
}

export function deleteGroup(id: number, db: DatabaseSync = getDb()): void {
  db.prepare("DELETE FROM agent_groups WHERE id = ?").run(id);
}

/** null = unrestricted. Otherwise the agent ids the session may see and operate. */
export function allowedAgentIds(session: SessionInfo, db: DatabaseSync = getDb()): Set<number> | null {
  if (session.access === "all") return null;
  if (session.groupIds.length === 0) return new Set();
  const marks = session.groupIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT DISTINCT agent_id FROM agent_group_members WHERE group_id IN (${marks})`).all(...session.groupIds) as unknown as { agent_id: number }[];
  return new Set(rows.map((r) => r.agent_id));
}

export const mayAccessAgent = (allowed: Set<number> | null, agentId: number) => allowed === null || allowed.has(agentId);

/** Names of the session's groups (for display). */
export function groupNames(session: SessionInfo, db: DatabaseSync = getDb()): string[] {
  if (session.access === "all" || session.groupIds.length === 0) return [];
  const marks = session.groupIds.map(() => "?").join(",");
  return (db.prepare(`SELECT name FROM agent_groups WHERE id IN (${marks}) ORDER BY name COLLATE NOCASE`).all(...session.groupIds) as unknown as { name: string }[]).map((r) => r.name);
}
