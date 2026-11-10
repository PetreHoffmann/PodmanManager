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
}

export interface ContainerLogs {
  tail: number;
  lines: LogLine[];
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
