import type { AgentRow } from "./agents";
import { naturalCompare, nextSortFor, parseSortFor, sortRows, timeOf, versionParts, type Sort as GenericSort, type SortValue } from "./table-sort";

export { naturalCompare, versionParts };

export const SORT_KEYS = ["agent", "address", "status", "heartbeat", "podman", "version", "containers", "storage"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type Sort = GenericSort<SortKey>;

/** `sort` and `dir` from the address; anything else means the default order (by host name). */
export const parseSort = (sort: string | undefined, dir: string | undefined): Sort | null => parseSortFor(SORT_KEYS, sort, dir);

/** Click order of a column header: ascending, descending, back to the default. */
export const nextSort = (current: Sort | null, key: SortKey): Sort | null => nextSortFor(current, key);

const STATUS_RANK: Record<string, number> = { online: 0, degraded: 1, unknown: 2, offline: 3, disabled: 4 };

export interface SortableHost {
  agent: Pick<AgentRow, "agent_id" | "address" | "port" | "kind" | "enabled" | "status" | "last_heartbeat" | "podman_version" | "agent_version">;
  /** number of containers; null if the host did not answer */
  containers: number | null;
  /** total storage in bytes; null if unknown */
  storage: number | null;
}

function valueOf(h: SortableHost, key: SortKey): SortValue {
  const a = h.agent;
  switch (key) {
    case "agent": return a.agent_id;
    case "address": return a.kind === "local" ? "local" : `${a.address}:${a.port}`;
    case "status": return STATUS_RANK[a.enabled ? a.status : "disabled"] ?? 2;
    case "heartbeat": return timeOf(a.last_heartbeat);
    case "podman": return versionParts(a.podman_version);
    case "version": return versionParts(a.agent_version);
    case "containers": return h.containers;
    case "storage": return h.storage;
  }
}

/** New array sorted by the column; missing values always last, equal values keep their order. */
export const sortHosts = <T extends SortableHost>(hosts: readonly T[], sort: Sort | null): T[] => sortRows(hosts, sort, valueOf);
