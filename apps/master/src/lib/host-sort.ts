import type { AgentRow } from "./agents";

export const SORT_KEYS = ["agent", "address", "status", "heartbeat", "podman", "version", "containers", "storage"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface Sort { key: SortKey; dir: SortDir }

/** `sort` and `dir` from the address; anything else means the default order (by host name). */
export function parseSort(sort: string | undefined, dir: string | undefined): Sort | null {
  const key = (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : null;
  return key ? { key, dir: dir === "desc" ? "desc" : "asc" } : null;
}

/** Click order of a column header: ascending, descending, back to the default. */
export function nextSort(current: Sort | null, key: SortKey): Sort | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** Text with numbers compared as numbers ("host-2" before "host-10"), case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  const x = a.toLowerCase().split(/(\d+)/), y = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? "", q = y[i] ?? "";
    if (p === q) continue;
    if (i % 2 === 1) return Number(p) - Number(q) || (p < q ? -1 : 1); // digit groups
    return p < q ? -1 : 1;
  }
  return 0;
}

/** "5.8.2", "4.9.4-rhel", "v0.28.0" → [5,8,2]; null if there is no version number. */
export function versionParts(v: string | null | undefined): number[] | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

const STATUS_RANK: Record<string, number> = { online: 0, degraded: 1, unknown: 2, offline: 3, disabled: 4 };

export interface SortableHost {
  agent: Pick<AgentRow, "agent_id" | "address" | "port" | "kind" | "enabled" | "status" | "last_heartbeat" | "podman_version" | "agent_version">;
  /** number of containers; null if the host did not answer */
  containers: number | null;
  /** total storage in bytes; null if unknown */
  storage: number | null;
}

type Value = string | number | number[] | null;

function valueOf(h: SortableHost, key: SortKey): Value {
  const a = h.agent;
  switch (key) {
    case "agent": return a.agent_id;
    case "address": return a.kind === "local" ? "local" : `${a.address}:${a.port}`;
    case "status": return STATUS_RANK[a.enabled ? a.status : "disabled"] ?? 2;
    case "heartbeat": { const t = a.last_heartbeat ? Date.parse(a.last_heartbeat) : NaN; return Number.isNaN(t) ? null : t; }
    case "podman": return versionParts(a.podman_version);
    case "version": return versionParts(a.agent_version);
    case "containers": return h.containers;
    case "storage": return h.storage;
  }
}

function cmp(a: Value, b: Value): number {
  if (typeof a === "string" && typeof b === "string") return naturalCompare(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  }
  return (a as number) - (b as number);
}

/** New array sorted by the column; missing values always last, equal values keep their order. */
export function sortHosts<T extends SortableHost>(hosts: readonly T[], sort: Sort | null): T[] {
  const list = [...hosts];
  if (!sort) return list;
  const sign = sort.dir === "desc" ? -1 : 1;
  return list
    .map((h, i) => ({ h, i, v: valueOf(h, sort.key) }))
    .sort((p, q) => {
      if (p.v === null && q.v === null) return p.i - q.i;
      if (p.v === null) return 1;
      if (q.v === null) return -1;
      return sign * cmp(p.v, q.v) || p.i - q.i;
    })
    .map((x) => x.h);
}
