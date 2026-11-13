import type { ApiResponse } from "../../../../shared/types/index.js";
import { createAgentHandler, type AgentHandler } from "@agent/api/handler";
import { PodmanClient } from "@agent/podman/client";
import { PodmanService } from "@agent/podman/service";
import { SelfUpdater } from "@agent/services/update";
import { appLogTail } from "./applog";

/**
 * The agent of the master's own host, run inside the master process: the master talks to the local Podman socket
 * itself, so that no separate agent (process, container, port, token) is needed on its host.
 * Switched on with LOCAL_PODMAN_SOCKET (path of the Podman socket as seen inside the master's container).
 */
export const LOCAL_AGENT_ID = "local";

export function localSocket(env: Record<string, string | undefined> = process.env): string | null {
  const p = (env.LOCAL_PODMAN_SOCKET ?? "").trim();
  return p.startsWith("/") && p.length <= 512 && !p.includes("\0") ? p : null;
}

const g = globalThis as unknown as { __pmLocal?: { socket: string; handle: AgentHandler } };

/** The in-process agent, or null when LOCAL_PODMAN_SOCKET is not set. */
export function localHandler(): AgentHandler | null {
  const socket = localSocket();
  if (!socket) return null;
  if (g.__pmLocal?.socket === socket) return g.__pmLocal.handle;
  const podman = new PodmanService(new PodmanClient(socket, 30_000), 10);
  const log = { info: (m: string) => console.info(`local host: ${m}`), error: (m: string) => console.error(`local host: ${m}`) };
  // the master updates itself like an agent does: pull its own image, then exit so that systemd recreates the container
  const updater = new SelfUpdater(podman, { log });
  // the master's own image must not be deleted
  podman.imageGuard = async () => [await updater.ownImageId()].filter((x): x is string => !!x);
  const handle = createAgentHandler({ agentId: LOCAL_AGENT_ID, podman, log, logs: { tail: appLogTail }, updater, hostName: () => podman.hostName() });
  g.__pmLocal = { socket, handle };
  return handle;
}

export type LocalResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; unreachable: boolean };

/** The same call as to a remote agent (method, /api/v1/... path), answered in-process. */
export async function localCall<T>(method: string, path: string): Promise<LocalResult<T>> {
  const handle = localHandler();
  if (!handle) return { ok: false, code: "UNREACHABLE", message: "Local host is not configured", unreachable: true };
  const url = new URL(path, "http://local");
  const r = await handle(method, url.pathname, url.searchParams);
  const body = r.body as ApiResponse<T>;
  if (body.ok) return { ok: true, data: body.data };
  return { ok: false, code: String(body.error?.code ?? "AGENT_ERROR"), message: String(body.error?.message ?? "Agent error"), unreachable: false };
}
