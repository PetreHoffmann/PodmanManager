export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type SocketStatus = "ok" | "missing" | "unreachable";
export type ApiStatus = "ok" | "error" | "unknown";
export type AgentStatus = "ok" | "degraded";

export interface HealthInfo {
  agentId: string;
  agentVersion: string;
  hostname: string;
  podmanVersion: string | null;
  podmanApiVersion: string | null;
  socketStatus: SocketStatus;
  apiStatus: ApiStatus;
  agentStatus: AgentStatus;
  error?: { code: string; message: string };
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  /** Pod the container belongs to (id / name), if any */
  podId?: string | null;
  podName?: string | null;
}

export interface PodContainer {
  id: string;
  name: string;
  state: string;
  /** infra container of the pod */
  infra: boolean;
}

export interface PodInfo {
  id: string;
  name: string;
  /** lower case: running, degraded, exited, stopped, created, paused */
  status: string;
  createdAt: string | null;
  containers: PodContainer[];
}

export interface PodActionResult {
  action: ContainerAction;
  changed: boolean;
  pod: PodInfo;
}

export type ContainerAction = "start" | "stop" | "restart";

export interface ActionResult {
  action: ContainerAction;
  changed: boolean;
  container: ContainerInfo;
}

export interface LogLine {
  /** RFC3339 timestamp from the container runtime, if present */
  ts: string | null;
  stream: "stdout" | "stderr";
  text: string;
  /** pod logs only: name of the container the line comes from */
  container?: string;
}

export interface ContainerLogs {
  tail: number;
  lines: LogLine[];
}

/** Merged logs of all containers of a pod (newest `tail` lines by timestamp). */
export interface PodLogs {
  tail: number;
  lines: LogLine[];
  /** containers whose logs could not be read (e.g. log driver "none") */
  skipped: string[];
}

export interface AppLogLine {
  /** ISO timestamp (UTC) */
  ts: string;
  level: "info" | "warn" | "error";
  text: string;
}

export interface AppLogs {
  lines: AppLogLine[];
}

/** Disk space used by the Podman storage of the agent's user (`podman system df`), in bytes. */
export interface StorageInfo {
  images: { count: number; unused: number; size: number; reclaimable: number };
  containers: { count: number; running: number; size: number; reclaimable: number };
  volumes: { count: number; size: number; reclaimable: number };
  /** images + containers + volumes */
  total: number;
  /** ISO time of the measurement (the agent caches it for a minute) */
  measuredAt: string;
}

export type UpdateState = "idle" | "pulling" | "restarting" | "current" | "error";

/** Whether and how the agent can update itself (container started by systemd/Quadlet from a floating tag). */
export interface UpdateInfo {
  possible: boolean;
  /** why not: no_container | inspect_failed | pinned_tag | not_systemd */
  reason?: string;
  /** image reference the agent container was started from, e.g. docker.io/…/podmanmanager-agent:latest */
  image?: string;
  tag?: string;
  state: UpdateState;
  message?: string;
}

export interface ImageInfo {
  id: string;
  /** repository:tag names; empty for a dangling image */
  tags: string[];
  size: number;
  createdAt: string | null;
  /** containers (running or not) that use the image */
  containers: number;
  dangling: boolean;
  /** the agent's own image and the image of the unit it may update cannot be deleted */
  protected: boolean;
}

export interface ImageDeleteResult {
  /** "removed": the image is gone; "untagged": only the given tag was removed */
  result: "removed" | "untagged";
}

export interface ImagePruneResult {
  removed: number;
  reclaimed: number;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  createdAt: string | null;
  /** bytes; null when the host could not measure it in time */
  size: number | null;
  /** no container (running or not) uses the volume */
  unused: boolean;
  /** created implicitly by a container (random name) */
  anonymous: boolean;
}

export interface NetworkInfo {
  name: string;
  id: string;
  driver: string;
  subnets: string[];
  internal: boolean;
  dnsEnabled: boolean;
  ipv6: boolean;
  /** running containers attached to the network */
  containers: string[];
  /** the default network cannot be removed */
  protected: boolean;
}

export interface RemoveResult {
  result: "removed";
}
