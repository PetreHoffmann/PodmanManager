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
}

export type ContainerAction = "start" | "stop" | "restart";

export interface ActionResult {
  action: ContainerAction;
  changed: boolean;
  container: ContainerInfo;
}
