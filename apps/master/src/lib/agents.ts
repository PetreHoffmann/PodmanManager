import type { ContainerInfo } from "../../../../shared/types/index.js";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../database/db";
import { agentHealth, agentList, type AgentTarget, type CallResult } from "./agent-client";
import { getConfig } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { parseAgentUrl, validToken } from "./validate";

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
}

const COLS = "id, agent_id, hostname, address, port, registered_at, enabled, status, fail_count, last_heartbeat, last_error, agent_version, podman_version";

export function listAgents(db: DatabaseSync = getDb()): AgentRow[] {
  return db.prepare(`SELECT ${COLS} FROM agents ORDER BY hostname COLLATE NOCASE`).all() as unknown as AgentRow[];
}

export function getAgent(id: number, db: DatabaseSync = getDb()): AgentRow | null {
  return (db.prepare(`SELECT ${COLS} FROM agents WHERE id = ?`).get(id) as unknown as AgentRow | undefined) ?? null;
}

export function targetFor(id: number, db: DatabaseSync = getDb()): AgentTarget | null {
  const r = db.prepare("SELECT address, port, token_enc FROM agents WHERE id = ?").get(id) as
    | { address: string; port: number; token_enc: string }
    | undefined;
  if (!r) return null;
  return { address: r.address, port: r.port, token: decryptSecret(r.token_enc) };
}

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export async function registerAgent(urlInput: string, token: string, db: DatabaseSync = getDb()): Promise<Result<number>> {
  const addr = parseAgentUrl(urlInput);
  if (!addr) return { ok: false, error: "Invalid address. Expected http://host:port" };
  if (!validToken(token)) return { ok: false, error: "Invalid token format" };
  const dup = db.prepare("SELECT id FROM agents WHERE address = ? AND port = ?").get(addr.address, addr.port);
  if (dup) return { ok: false, error: "Agent already registered" };

  const h = await agentHealth({ ...addr, token });
  if (!h.ok) {
    return { ok: false, error: h.code === "UNAUTHORIZED" ? "Authentication failed: token rejected by agent" : `Connection test failed: ${h.message}` };
  }
  const dupId = db.prepare("SELECT id FROM agents WHERE agent_id = ?").get(h.data.agentId);
  if (dupId) return { ok: false, error: `Agent ID "${h.data.agentId}" already registered` };

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
export async function fetchAllContainers(db: DatabaseSync = getDb()): Promise<HostContainers[]> {
  const agents = listAgents(db);
  return Promise.all(
    agents.map(async (agent): Promise<HostContainers> => {
      if (!agent.enabled) return { agent, result: { ok: false, code: "SKIPPED", message: "Agent disabled", unreachable: true } };
      try {
        const t = targetFor(agent.id, db);
        if (!t) return { agent, result: { ok: false, code: "SKIPPED", message: "Agent missing", unreachable: true } };
        return { agent, result: await agentList(t) };
      } catch {
        return { agent, result: { ok: false, code: "SKIPPED", message: "Cannot read agent credentials", unreachable: true } };
      }
    }),
  );
}
