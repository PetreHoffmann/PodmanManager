import type { ApiResponse, AppLogLine, ContainerAction } from "../../../../shared/types/index.js";
import { PodmanError } from "../podman/client.js";
import { isValidContainerId, isValidPodId, type PodmanService } from "../podman/service.js";
import { collectHealth } from "../services/health.js";
import type { PeerUpdater, SelfUpdater } from "../services/update.js";

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const ACTIONS: ReadonlySet<string> = new Set(["start", "stop", "restart"]);
const DEFAULT_TAIL = 150;
const MAX_TAIL = 500;

/** What a route answers: HTTP status, JSON body and extra headers. The HTTP server sends it; the master calls the handler in-process for its own host. */
export interface Reply {
  status: number;
  body: ApiResponse<unknown>;
  headers?: Record<string, string>;
}

export type AgentHandler = (method: string, pathname: string, query: URLSearchParams) => Promise<Reply>;

export interface HandlerDeps {
  agentId: string;
  podman: PodmanService;
  log: Logger;
  /** the agent's own log lines (GET /agent/logs) */
  logs?: { tail(n: number): AppLogLine[] };
  updater?: SelfUpdater;
  peer?: PeerUpdater;
  /** real name of the host (the in-process agent of the master runs in a container, where the host name is the container id) */
  hostName?: () => Promise<string | undefined>;
}

const reply = (status: number, body: ApiResponse<unknown>, headers?: Record<string, string>): Reply => ({ status, body, ...(headers ? { headers } : {}) });
const failR = (status: number, code: string, message: string, headers?: Record<string, string>): Reply => reply(status, { ok: false, error: { code, message } }, headers);

function statusFor(e: PodmanError): number {
  switch (e.code) {
    case "CONTAINER_NOT_FOUND":
    case "POD_NOT_FOUND":
    case "IMAGE_NOT_FOUND":
    case "VOLUME_NOT_FOUND":
    case "NETWORK_NOT_FOUND":
      return 404;
    case "IMAGE_IN_USE":
    case "IMAGE_PROTECTED":
    case "VOLUME_IN_USE":
    case "STATS_UNAVAILABLE":
    case "NETWORK_IN_USE":
    case "NETWORK_PROTECTED":
      return 409;
    case "INVALID_PARAM":
      return 400;
    case "SOCKET_MISSING":
    case "SOCKET_UNREACHABLE":
      return 503;
    case "PODMAN_TIMEOUT":
      return 504;
    default:
      return e.upstreamStatus === 409 ? 409 : 502;
  }
}

/** The routes of the agent API without any HTTP: authentication, rate limiting and body handling belong to the caller. */
export function createAgentHandler(deps: HandlerDeps): AgentHandler {
  const { podman, log, updater, peer } = deps;
  return async (method, pathname, query) => {
    try {
    const segs = pathname.split("/").filter(Boolean);

    if (segs[0] !== "api" || segs[1] !== "v1") return failR(404, "NOT_FOUND", "Not found");
    const route = segs.slice(2);

    if (route.length === 1 && route[0] === "health") {
      if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
      return reply(200, { ok: true, data: await collectHealth(deps.agentId, podman, await deps.hostName?.().catch(() => undefined)) });
    }

    if (route.length === 2 && route[0] === "agent" && route[1] === "logs") {
      if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
      const raw = query.get("tail");
      const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
      if (tail < 1 || tail > MAX_TAIL) return failR(400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
      return reply(200, { ok: true, data: { lines: deps.logs ? deps.logs.tail(tail) : [] } });
    }

    if (route.length === 2 && route[0] === "system" && route[1] === "storage") {
      if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
      return reply(200, { ok: true, data: await podman.storage() });
    }

    if (route.length === 2 && route[0] === "system" && route[1] === "update") {
      if (method !== "GET" && method !== "POST") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET, POST" });
      if (!updater) return failR(404, "NOT_FOUND", "Not found");
      if (method === "GET") return reply(200, { ok: true, data: await updater.info() });
      const info = await updater.start();
      if (!info.possible) return failR(409, "UPDATE_NOT_POSSIBLE", info.reason ?? "not_possible");
      log.info(`update requested (state ${info.state})`);
      return reply(202, { ok: true, data: info });
    }

    if (route.length === 2 && route[0] === "system" && route[1] === "update-peer") {
      if (method !== "GET" && method !== "POST") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET, POST" });
      if (!peer) return failR(404, "NOT_FOUND", "Not found");
      if (method === "GET") return reply(200, { ok: true, data: await peer.info() });
      const info = await peer.start();
      if (!info.possible) return failR(409, "UPDATE_NOT_POSSIBLE", info.reason ?? "not_possible");
      log.info(`peer update requested (state ${info.state})`);
      return reply(202, { ok: true, data: info });
    }

    if (route[0] === "images") {
      if (route.length === 1) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: await podman.listImages() });
      }
      if (route.length === 2 && route[1] === "prune") {
        if (method !== "POST") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
        const r = await podman.pruneImages();
        log.info(`images pruned: ${r.removed} removed, ${r.reclaimed} bytes`);
        return reply(200, { ok: true, data: r });
      }
      if (route.length === 2) {
        if (method !== "DELETE") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "DELETE" });
        const tag = query.get("tag") ?? undefined;
        const r = await podman.deleteImage(route[1]!, tag);
        log.info(`image ${route[1]!.slice(0, 12)}${tag ? ` (${tag})` : ""} ${r.result}`);
        return reply(200, { ok: true, data: r });
      }
      return failR(404, "NOT_FOUND", "Not found");
    }

    if (route[0] === "stats" && route.length === 1) {
      if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
      return reply(200, { ok: true, data: await podman.containerStats() });
    }

    if (route[0] === "volumes" || route[0] === "networks") {
      const vol = route[0] === "volumes";
      if (route.length === 1) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: vol ? await podman.listVolumes() : await podman.listNetworks() });
      }
      if (route.length === 2) {
        if (method !== "DELETE") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "DELETE" });
        const r = vol ? await podman.removeVolume(route[1]!) : await podman.removeNetwork(route[1]!);
        log.info(`${vol ? "volume" : "network"} ${route[1]!.slice(0, 64)} removed`);
        return reply(200, { ok: true, data: r });
      }
      return failR(404, "NOT_FOUND", "Not found");
    }

    if (route[0] === "pods") {
      if (route.length === 1) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: await podman.listPods() });
      }
      const pid = route[1] ?? "";
      if (!isValidPodId(pid)) return failR(400, "INVALID_ID", "Invalid pod id");
      if (route.length === 2) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: await podman.pod(pid) });
      }
      const paction = route[2] ?? "";
      if (route.length === 3 && paction === "logs") {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        const raw = query.get("tail");
        const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
        if (tail < 1 || tail > MAX_TAIL) return failR(400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
        return reply(200, { ok: true, data: await podman.podLogs(pid, tail) });
      }
      if (route.length === 3 && ACTIONS.has(paction)) {
        if (method !== "POST") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
        const r = await podman.podAct(pid, paction as ContainerAction);
        log.info(`pod ${pid.slice(0, 12)} ${paction} changed=${r.changed}`);
        return reply(200, { ok: true, data: { action: paction, ...r } });
      }
      return failR(404, "NOT_FOUND", "Not found");
    }

    if (route[0] === "containers") {
      if (route.length === 1) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: await podman.list() });
      }
      const id = route[1] ?? "";
      if (!isValidContainerId(id)) return failR(400, "INVALID_ID", "Invalid container id");

      if (route.length === 2) {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return reply(200, { ok: true, data: await podman.inspect(id) });
      }
      const action = route[2] ?? "";
      if (route.length === 3 && action === "logs") {
        if (method !== "GET") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        const raw = query.get("tail");
        const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
        if (tail < 1 || tail > MAX_TAIL) return failR(400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
        return reply(200, { ok: true, data: { tail, lines: await podman.logs(id, tail) } });
      }
      if (route.length === 3 && ACTIONS.has(action)) {
        if (method !== "POST") return failR(405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
        const r = await podman.act(id, action as ContainerAction);
        log.info(`container ${id.slice(0, 12)} ${action} changed=${r.changed}`);
        return reply(200, { ok: true, data: { action, ...r } });
      }
    }
    return failR(404, "NOT_FOUND", "Not found");

    } catch (e) {
      // which request failed and why (path without query; Podman's own message, already shortened)
      const where = `${method || "?"} ${pathname.slice(0, 120)}`;
      if (e instanceof PodmanError) {
        const up = e.upstreamStatus ? ` (Podman HTTP ${e.upstreamStatus})` : "";
        log.error(`podman error ${e.code} on ${where}${up}: ${e.message}`.slice(0, 500));
        return failR(statusFor(e), e.code, e.message);
      }
      log.error(`internal error on ${where}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
      return failR(500, "INTERNAL", "Internal error");
    }
  };
}
