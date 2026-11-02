import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ApiResponse, ContainerAction } from "../../../../shared/types/index.js";
import type { AgentConfig } from "../config/config.js";
import { FailureLimiter, verifyToken } from "../auth/auth.js";
import { PodmanError } from "../podman/client.js";
import { isValidContainerId, type PodmanService } from "../podman/service.js";
import { collectHealth } from "../services/health.js";

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const ACTIONS: ReadonlySet<string> = new Set(["start", "stop", "restart"]);
const MAX_BODY_BYTES = 1024;

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

export function createAgentServer(cfg: AgentConfig, podman: PodmanService, log: Logger): Server {
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
        if (route.length === 3 && ACTIONS.has(action)) {
          if (method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed", { Allow: "POST" });
          const r = await podman.act(id, action as ContainerAction);
          log.info(`container ${id.slice(0, 12)} ${action} changed=${r.changed}`);
          return send(res, 200, { ok: true, data: { action, ...r } });
        }
      }
      return fail(res, 404, "NOT_FOUND", "Not found");
    } catch (e) {
      if (e instanceof PodmanError) {
        log.error(`podman error ${e.code}`);
        return fail(res, statusFor(e), e.code, e.message);
      }
      log.error("internal error");
      return fail(res, 500, "INTERNAL", "Internal error");
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  return server;
}
