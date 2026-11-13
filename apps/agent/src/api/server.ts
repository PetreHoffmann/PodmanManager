import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ApiResponse } from "../../../../shared/types/index.js";
import type { AgentConfig } from "../config/config.js";
import { FailureLimiter, verifyToken } from "../auth/auth.js";
import { createAgentHandler, type Logger } from "./handler.js";
import type { LogBuffer } from "../logbuffer.js";
import type { PodmanService } from "../podman/service.js";
import type { PeerUpdater, SelfUpdater } from "../services/update.js";

export type { Logger };

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
  const handle = createAgentHandler({ agentId: cfg.agentId, podman, log, logs, updater, peer });

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
      const r = await handle(req.method ?? "", url.pathname, url.searchParams);
      return send(res, r.status, r.body, r.headers);
    } catch (e) {
      log.error(`internal error on ${req.method ?? "?"} ${(req.url ?? "").split("?")[0]?.slice(0, 120)}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
      return fail(res, 500, "INTERNAL", "Internal error");
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  return server;
}
