import type { ContainerInfo, ImageInfo, PodInfo } from "../../../../shared/types/index.js";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { agentHealth, agentImages, agentList, agentPods, type AgentTarget, type CallResult } from "./agent-client";
import { getConfig } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { isHidden, isPodHidden } from "./hidden";
import { parseAgentUrl, validToken } from "./validate";
import { localSocket } from "./local-host";

export type AgentStatus = "unknown" | "online" | "degraded" | "offline";

export interface AgentRow {
  id: number;
  agent_id: string;
  hostname: string;
  address: string;
  port: number;
  registered_at: string;
  enabled: number;
  status: AgentStatus;
  fail_count: number;
  last_heartbeat: string | null;
  last_error: string | null;
  agent_version: string | null;
  podman_version: string | null;
  /** "local": the master's own host (in-process agent), "remote": an agent reached over the network */
  kind: "remote" | "local";
}

const COLS = "id, agent_id, hostname, address, port, registered_at, enabled, status, fail_count, last_heartbeat, last_error, agent_version, podman_version, kind";

export function listAgents(db: DatabaseSync = getDb()): AgentRow[] {
  return db.prepare(`SELECT ${COLS} FROM agents ORDER BY hostname COLLATE NOCASE`).all() as unknown as AgentRow[];
}

export function getAgent(id: number, db: DatabaseSync = getDb()): AgentRow | null {
  return (db.prepare(`SELECT ${COLS} FROM agents WHERE id = ?`).get(id) as unknown as AgentRow | undefined) ?? null;
}

export function targetFor(id: number, db: DatabaseSync = getDb()): AgentTarget | null {
  const r = db.prepare("SELECT address, port, token_enc, kind FROM agents WHERE id = ?").get(id) as
    | { address: string; port: number; token_enc: string; kind: string }
    | undefined;
  if (!r) return null;
  if (r.kind === "local") return localSocket() ? { address: "local", port: 0, token: "", local: true } : null;
  return { address: r.address, port: r.port, token: decryptSecret(r.token_enc) };
}

export type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; params?: Record<string, string> };

export async function registerAgent(urlInput: string, token: string, db: DatabaseSync = getDb()): Promise<Result<number>> {
  const addr = parseAgentUrl(urlInput);
  if (!addr) return { ok: false, error: "err.invalidAddress" };
  if (!validToken(token)) return { ok: false, error: "err.invalidToken" };
  const dup = db.prepare("SELECT id FROM agents WHERE address = ? AND port = ?").get(addr.address, addr.port);
  if (dup) return { ok: false, error: "err.alreadyRegistered" };

  const h = await agentHealth({ ...addr, token });
  if (!h.ok) {
    return h.code === "UNAUTHORIZED"
      ? { ok: false, error: "err.authFailed" }
      : { ok: false, error: "err.connFailed", params: { code: h.code, msg: h.message } };
  }
  const dupId = db.prepare("SELECT id FROM agents WHERE agent_id = ?").get(h.data.agentId);
  if (dupId) return { ok: false, error: "err.agentIdTaken", params: { id: h.data.agentId } };

  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at, enabled, status, fail_count, last_heartbeat, agent_version, podman_version)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`,
    )
    .run(
      h.data.agentId, h.data.hostname, addr.address, addr.port, encryptSecret(token), now,
      h.data.agentStatus === "ok" ? "online" : "degraded", now, h.data.agentVersion, h.data.podmanVersion,
    );
  return { ok: true, data: Number(r.lastInsertRowid) };
}

/**
 * Keeps the row of the master's own host in step with LOCAL_PODMAN_SOCKET: created when the variable is set, removed
 * (with its group memberships) when it is not. The row has no address and no token.
 */
export function ensureLocalHost(db: DatabaseSync = getDb()): void {
  const existing = db.prepare("SELECT id FROM agents WHERE kind = 'local'").get();
  if (!localSocket()) {
    if (existing) db.prepare("DELETE FROM agents WHERE kind = 'local'").run();
    return;
  }
  if (existing) return;
  const taken = db.prepare("SELECT 1 FROM agents WHERE agent_id = 'local'").get();
  db.prepare(
    `INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at, enabled, status, fail_count, kind)
     VALUES (?, 'local', 'local', 0, '', ?, 1, 'unknown', 0, 'local')`,
  ).run(taken ? "local-master" : "local", new Date().toISOString());
}

export function removeAgent(id: number, db: DatabaseSync = getDb()): void {
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
}

export function setEnabled(id: number, enabled: boolean, db: DatabaseSync = getDb()): void {
  db.prepare("UPDATE agents SET enabled = ?, status = CASE WHEN ? = 1 THEN 'unknown' ELSE status END, fail_count = 0 WHERE id = ?").run(enabled ? 1 : 0, enabled ? 1 : 0, id);
}

/** Runs one health check and persists the outcome. */
export async function checkAgent(id: number, db: DatabaseSync = getDb()): Promise<AgentRow | null> {
  const t = targetFor(id, db);
  if (!t) return null;
  const h = await agentHealth(t);
  const now = new Date().toISOString();
  if (h.ok) {
    db.prepare(
      `UPDATE agents SET status = ?, fail_count = 0, last_heartbeat = ?, last_error = ?, hostname = ?, agent_version = ?, podman_version = ? WHERE id = ?`,
    ).run(
      h.data.agentStatus === "ok" ? "online" : "degraded", now,
      h.data.error ? `${h.data.error.code}: ${h.data.error.message}`.slice(0, 300) : null,
      h.data.hostname, h.data.agentVersion, h.data.podmanVersion, id,
    );
  } else {
    const limit = getConfig().offlineAfterFailures;
    db.prepare(
      `UPDATE agents SET fail_count = fail_count + 1, last_error = ?, status = CASE WHEN fail_count + 1 >= ? THEN 'offline' ELSE status END WHERE id = ?`,
    ).run(`${h.code}: ${h.message}`.slice(0, 300), limit, id);
  }
  return getAgent(id, db);
}

export interface HostContainers {
  agent: AgentRow;
  result: CallResult<ContainerInfo[]> | { ok: false; code: "SKIPPED"; message: string; unreachable: true };
}

/** Live container query for all enabled agents, in parallel; never throws. */
export async function fetchAllContainers(
  db: DatabaseSync = getDb(),
  allowed: ReadonlySet<number> | null = null,
  hidden: readonly string[] = [],
): Promise<HostContainers[]> {
  const agents = listAgents(db).filter((a) => allowed === null || allowed.has(a.id));
  return Promise.all(
    agents.map(async (agent): Promise<HostContainers> => {
      if (!agent.enabled) return { agent, result: { ok: false, code: "SKIPPED", message: "", unreachable: true } };
      try {
        const t = targetFor(agent.id, db);
        if (!t) return { agent, result: { ok: false, code: "SKIPPED", message: "", unreachable: true } };
        const result = await agentList(t);
        // Hidden containers never leave this function for restricted users (lists, counts, dashboard).
        if (result.ok && hidden.length > 0) return { agent, result: { ok: true, data: result.data.filter((c) => !isHidden(c.name, hidden)) } };
        return { agent, result };
      } catch {
        return { agent, result: { ok: false, code: "SKIPPED", message: "", unreachable: true } };
      }
    }),
  );
}

export interface HostPods {
  agent: AgentRow;
  result: CallResult<PodInfo[]> | { ok: false; code: "SKIPPED"; message: string; unreachable: true };
}

/** Live pod query for all enabled agents, in parallel; never throws. Pods with hidden containers are dropped for restricted users. */
export async function fetchAllPods(
  db: DatabaseSync = getDb(),
  allowed: ReadonlySet<number> | null = null,
  hidden: readonly string[] = [],
): Promise<HostPods[]> {
  const agents = listAgents(db).filter((a) => allowed === null || allowed.has(a.id));
  return Promise.all(
    agents.map(async (agent): Promise<HostPods> => {
      const skipped: HostPods = { agent, result: { ok: false, code: "SKIPPED", message: "", unreachable: true } };
      if (!agent.enabled) return skipped;
      try {
        const t = targetFor(agent.id, db);
        if (!t) return skipped;
        const result = await agentPods(t);
        if (result.ok && hidden.length > 0) return { agent, result: { ok: true, data: result.data.filter((p) => !isPodHidden(p, hidden)) } };
        return { agent, result };
      } catch {
        return skipped;
      }
    }),
  );
}

export interface HostImages {
  agent: AgentRow;
  result: CallResult<ImageInfo[]> | { ok: false; code: "SKIPPED"; message: string; unreachable: true };
}

/** Live image query for all enabled agents (within the allowed set), in parallel; never throws. */
export async function fetchAllImages(db: DatabaseSync = getDb(), allowed: ReadonlySet<number> | null = null): Promise<HostImages[]> {
  const agents = listAgents(db).filter((a) => allowed === null || allowed.has(a.id));
  return Promise.all(
    agents.map(async (agent): Promise<HostImages> => {
      const skipped: HostImages = { agent, result: { ok: false, code: "SKIPPED", message: "", unreachable: true } };
      if (!agent.enabled) return skipped;
      try {
        const t = targetFor(agent.id, db);
        return t ? { agent, result: await agentImages(t) } : skipped;
      } catch {
        return skipped;
      }
    }),
  );
}
