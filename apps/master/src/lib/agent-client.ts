import type { ImageDeleteResult, ImageInfo, ImagePruneResult, UpdateInfo, StorageInfo, PodLogs, PodActionResult, PodInfo, ActionResult, ApiResponse, ContainerAction, ContainerInfo, ContainerLogs, AppLogs, HealthInfo } from "../../../../shared/types/index.js";
import { getConfig } from "./config";
import { localCall } from "./local-host";
import { CONTAINER_ID_RE } from "./validate";

export interface AgentTarget {
  address: string;
  port: number;
  token: string;
  /** the master's own host: answered in-process (lib/local-host.ts), no network */
  local?: boolean;
}

export type CallResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; unreachable: boolean };

async function call<T>(t: AgentTarget, method: "GET" | "POST" | "DELETE", path: string, timeoutSec: number): Promise<CallResult<T>> {
  if (t.local) return localCall<T>(method, path);
  try {
    const res = await fetch(`http://${t.address}:${t.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t.token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    let body: ApiResponse<T> | null = null;
    try {
      body = (await res.json()) as ApiResponse<T>;
    } catch {
      /* non-JSON */
    }
    if (body && typeof body === "object" && "ok" in body) {
      if (body.ok) return { ok: true, data: body.data };
      const code = String(body.error?.code ?? "AGENT_ERROR");
      return { ok: false, code, message: String(body.error?.message ?? "Agent error"), unreachable: res.status === 401 || res.status === 429 };
    }
    return { ok: false, code: "BAD_RESPONSE", message: `Unexpected response (HTTP ${res.status})`, unreachable: true };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    // Low-level cause (ECONNREFUSED, ENOTFOUND, EHOSTUNREACH, ...) helps to tell DNS, firewall and port problems apart.
    const cause = (e as { cause?: { code?: unknown } })?.cause?.code;
    return {
      ok: false,
      code: timeout ? "TIMEOUT" : "UNREACHABLE",
      message: timeout ? "Agent did not respond in time" : typeof cause === "string" && /^[A-Z0-9_]{3,40}$/.test(cause) ? cause : "Agent not reachable",
      unreachable: true,
    };
  }
}

const cfg = () => getConfig();

export const agentHealth = (t: AgentTarget) => call<HealthInfo>(t, "GET", "/api/v1/health", cfg().agentTimeoutSec);
export const agentList = (t: AgentTarget) => call<ContainerInfo[]>(t, "GET", "/api/v1/containers", cfg().agentTimeoutSec);

export function agentInspect(t: AgentTarget, id: string) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<ContainerInfo>>({ ok: false, code: "INVALID_ID", message: "Invalid container id", unreachable: false });
  return call<ContainerInfo>(t, "GET", `/api/v1/containers/${id}`, cfg().agentTimeoutSec);
}

export function agentAction(t: AgentTarget, id: string, action: ContainerAction) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<ActionResult>>({ ok: false, code: "INVALID_ID", message: "Invalid container id", unreachable: false });
  return call<ActionResult>(t, "POST", `/api/v1/containers/${id}/${action}`, cfg().actionTimeoutSec);
}

export const LOG_TAIL = 150;

/** Last LOG_TAIL log lines of a container (read-only). */
export function agentLogs(t: AgentTarget, id: string) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<ContainerLogs>>({ ok: false, code: "INVALID_ID", message: "Invalid container id", unreachable: false });
  return call<ContainerLogs>(t, "GET", `/api/v1/containers/${id}/logs?tail=${LOG_TAIL}`, 15);
}

/** The agent's own recent log lines (read-only). */
export const agentAppLogs = (t: AgentTarget) => call<AppLogs>(t, "GET", `/api/v1/agent/logs?tail=${LOG_TAIL}`, 15);

export const agentPods = (t: AgentTarget) => call<PodInfo[]>(t, "GET", "/api/v1/pods", cfg().agentTimeoutSec);

export function agentPod(t: AgentTarget, id: string) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<PodInfo>>({ ok: false, code: "INVALID_ID", message: "Invalid pod id", unreachable: false });
  return call<PodInfo>(t, "GET", `/api/v1/pods/${id}`, cfg().agentTimeoutSec);
}

export function agentPodAction(t: AgentTarget, id: string, action: ContainerAction) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<PodActionResult>>({ ok: false, code: "INVALID_ID", message: "Invalid pod id", unreachable: false });
  return call<PodActionResult>(t, "POST", `/api/v1/pods/${id}/${action}`, cfg().actionTimeoutSec);
}

/** Merged last LOG_TAIL log lines of all containers of a pod (read-only). */
export function agentPodLogs(t: AgentTarget, id: string) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<PodLogs>>({ ok: false, code: "INVALID_ID", message: "Invalid pod id", unreachable: false });
  return call<PodLogs>(t, "GET", `/api/v1/pods/${id}/logs?tail=${LOG_TAIL}`, 20);
}

/** Disk space used by the agent's Podman storage (read-only; `podman system df` can take a while). */
export const agentStorage = (t: AgentTarget) => call<StorageInfo>(t, "GET", "/api/v1/system/storage", 40);

export const agentUpdateStart = (t: AgentTarget) => call<UpdateInfo>(t, "POST", "/api/v1/system/update", 20);
export const agentPeerInfo = (t: AgentTarget) => call<UpdateInfo>(t, "GET", "/api/v1/system/update-peer", 15);
export const agentPeerStart = (t: AgentTarget) => call<UpdateInfo>(t, "POST", "/api/v1/system/update-peer", 20);

export const agentImages = (t: AgentTarget) => call<ImageInfo[]>(t, "GET", "/api/v1/images", 40);
export function agentImageDelete(t: AgentTarget, id: string, tag: string | null) {
  if (!CONTAINER_ID_RE.test(id)) return Promise.resolve<CallResult<ImageDeleteResult>>({ ok: false, code: "INVALID_ID", message: "Invalid image id", unreachable: false });
  return call<ImageDeleteResult>(t, "DELETE", `/api/v1/images/${id}${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`, 60);
}
export const agentImagePrune = (t: AgentTarget) => call<ImagePruneResult>(t, "POST", "/api/v1/images/prune", 130);
export const agentSelfInfo = (t: AgentTarget) => call<UpdateInfo>(t, "GET", "/api/v1/system/update", 15);
