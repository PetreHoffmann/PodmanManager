import type { PodLogs, PodActionResult, PodInfo, ActionResult, ApiResponse, ContainerAction, ContainerInfo, ContainerLogs, AppLogs, HealthInfo } from "../../../../shared/types/index.js";
import { getConfig } from "./config";
import { CONTAINER_ID_RE } from "./validate";

export interface AgentTarget {
  address: string;
  port: number;
  token: string;
}

export type CallResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; unreachable: boolean };

async function call<T>(t: AgentTarget, method: "GET" | "POST", path: string, timeoutSec: number): Promise<CallResult<T>> {
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
