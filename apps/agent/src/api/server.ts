import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ApiResponse, ContainerAction } from "../../../../shared/types/index.js";
import type { AgentConfig } from "../config/config.js";
import { FailureLimiter, verifyToken } from "../auth/auth.js";
import { PodmanError } from "../podman/client.js";
import { isValidContainerId, isValidPodId, type PodmanService } from "../podman/service.js";
import { collectHealth } from "../services/health.js";
import type { LogBuffer } from "../logbuffer.js";
import type { PeerUpdater, SelfUpdater } from "../services/update.js";

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const ACTIONS: ReadonlySet<string> = new Set(["start", "stop", "restart"]);
const MAX_BODY_BYTES = 1024;
const DEFAULT_TAIL = 150;
const MAX_TAIL = 500;

function send(res: ServerResponse, status: number, body: ApiResponse<unknown>, extra?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(payload);
}

const fail = (res: ServerResponse, status: number, code: string, message: string, extra?: Record<string, string>) =>
  send(res, status, { ok: false, error: { code, message } }, extra);

function statusFor(e: PodmanError): number {
  switch (e.code) {
    case "CONTAINER_NOT_FOUND":
    case "POD_NOT_FOUND":
      return 404;
    case "SOCKET_MISSING":
    case "SOCKET_UNREACHABLE":
      return 503;
    case "PODMAN_TIMEOUT":
      return 504;
    default:
      return e.upstreamStatus === 409 ? 409 : 502;
  }
}

/** Drains the request and enforces a tiny body limit; bodies are never used. */
function drain(req: IncomingMessage): Promise<boolean> {
  return new Promise((resolve) => {
    let size = 0;
    let ok = true;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) ok = false;
    });
    req.on("end", () => resolve(ok));
    req.on("error", () => resolve(false));
  });
}

export function createAgentServer(cfg: AgentConfig, podman: PodmanService, log: Logger, logs?: LogBuffer, updater?: SelfUpdater, peer?: PeerUpdater): Server {
  const limiter = new FailureLimiter(cfg.rateLimitMax, cfg.rateLimitWindowMs);

  const server = createServer(async (req, res) => {
    try {
      const ip = req.socket.remoteAddress ?? "unknown";
      if (limiter.isBlocked(ip)) {
        return fail(res, 429, "RATE_LIMITED", "Too many failed attempts", {
          "Retry-After": String(Math.ceil(cfg.rateLimitWindowMs / 1000)),
        });
      }
      if (!verifyToken(req.headers.authorization, cfg.tokenHash)) {
        limiter.recordFailure(ip);
        return fail(res, 401, "UNAUTHORIZED", "Missing or invalid token", {
          "WWW-Authenticate": "Bearer",
        });
      }

      if (!(await drain(req))) return fail(res, 413, "BODY_TOO_LARGE", "Request body too large");

      const url = new URL(req.url ?? "/", "http://agent");
      const segs = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "";

      if (segs[0] !== "api" || segs[1] !== "v1") return fail(res, 404, "NOT_FOUND", "Not found");
      const route = segs.slice(2);

      if (route.length === 1 && route[0] === "health") {
        if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return send(res, 200, { ok: true, data: await collectHealth(cfg.agentId, podman) });
      }

      if (route.length === 2 && route[0] === "agent" && route[1] === "logs") {
        if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        const raw = url.searchParams.get("tail");
        const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
        if (tail < 1 || tail > MAX_TAIL) return fail(res, 400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
        return send(res, 200, { ok: true, data: { lines: logs ? logs.tail(tail) : [] } });
      }

      if (route.length === 2 && route[0] === "system" && route[1] === "storage") {
        if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
        return send(res, 200, { ok: true, data: await podman.storage() });
      }

      if (route.length === 2 && route[0] === "system" && route[1] === "update") {
        if (method !== "GET" && method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET, POST" });
        if (!updater) return fail(res, 404, "NOT_FOUND", "Not found");
        if (method === "GET") return send(res, 200, { ok: true, data: await updater.info() });
        const info = await updater.start();
        if (!info.possible) return fail(res, 409, "UPDATE_NOT_POSSIBLE", info.reason ?? "not_possible");
        log.info(`update requested (state ${info.state})`);
        return send(res, 202, { ok: true, data: info });
      }

      if (route.length === 2 && route[0] === "system" && route[1] === "update-peer") {
        if (method !== "GET" && method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET, POST" });
        if (!peer) return fail(res, 404, "NOT_FOUND", "Not found");
        if (method === "GET") return send(res, 200, { ok: true, data: await peer.info() });
        const info = await peer.start();
        if (!info.possible) return fail(res, 409, "UPDATE_NOT_POSSIBLE", info.reason ?? "not_possible");
        log.info(`peer update requested (state ${info.state})`);
        return send(res, 202, { ok: true, data: info });
      }

      if (route[0] === "pods") {
        if (route.length === 1) {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          return send(res, 200, { ok: true, data: await podman.listPods() });
        }
        const pid = route[1] ?? "";
        if (!isValidPodId(pid)) return fail(res, 400, "INVALID_ID", "Invalid pod id");
        if (route.length === 2) {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          return send(res, 200, { ok: true, data: await podman.pod(pid) });
        }
        const paction = route[2] ?? "";
        if (route.length === 3 && paction === "logs") {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          const raw = url.searchParams.get("tail");
          const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
          if (tail < 1 || tail > MAX_TAIL) return fail(res, 400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
          return send(res, 200, { ok: true, data: await podman.podLogs(pid, tail) });
        }
        if (route.length === 3 && ACTIONS.has(paction)) {
          if (method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
          const r = await podman.podAct(pid, paction as ContainerAction);
          log.info(`pod ${pid.slice(0, 12)} ${paction} changed=${r.changed}`);
          return send(res, 200, { ok: true, data: { action: paction, ...r } });
        }
        return fail(res, 404, "NOT_FOUND", "Not found");
      }

      if (route[0] === "containers") {
        if (route.length === 1) {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          return send(res, 200, { ok: true, data: await podman.list() });
        }
        const id = route[1] ?? "";
        if (!isValidContainerId(id)) return fail(res, 400, "INVALID_ID", "Invalid container id");

        if (route.length === 2) {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          return send(res, 200, { ok: true, data: await podman.inspect(id) });
        }
        const action = route[2] ?? "";
        if (route.length === 3 && action === "logs") {
          if (method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "GET" });
          const raw = url.searchParams.get("tail");
          const tail = raw === null ? DEFAULT_TAIL : /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
          if (tail < 1 || tail > MAX_TAIL) return fail(res, 400, "INVALID_PARAM", `tail must be 1-${MAX_TAIL}`);
          return send(res, 200, { ok: true, data: { tail, lines: await podman.logs(id, tail) } });
        }
        if (route.length === 3 && ACTIONS.has(action)) {
          if (method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
          const r = await podman.act(id, action as ContainerAction);
          log.info(`container ${id.slice(0, 12)} ${action} changed=${r.changed}`);
          return send(res, 200, { ok: true, data: { action, ...r } });
        }
      }
      return fail(res, 404, "NOT_FOUND", "Not found");
    } catch (e) {
      // which request failed and why (path without query; Podman's own message, already shortened)
      const where = `${req.method ?? "?"} ${(req.url ?? "").split("?")[0]?.slice(0, 120)}`;
      if (e instanceof PodmanError) {
        const up = e.upstreamStatus ? ` (Podman HTTP ${e.upstreamStatus})` : "";
        log.error(`podman error ${e.code} on ${where}${up}: ${e.message}`.slice(0, 500));
        return fail(res, statusFor(e), e.code, e.message);
      }
      log.error(`internal error on ${where}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
      return fail(res, 500, "INTERNAL", "Internal error");
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  return server;
}
