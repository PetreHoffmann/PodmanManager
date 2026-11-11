import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { LogBuffer } from "../src/logbuffer.js";
import { createAgentServer } from "../src/api/server.js";
import { hashToken } from "../src/auth/auth.js";
import type { AgentConfig } from "../src/config/config.js";
import { PodmanClient } from "../src/podman/client.js";
import { PodmanService } from "../src/podman/service.js";

export const TOKEN = "test-token-0123456789abcdef";
export const ID = "a".repeat(64);

export type FakeHandler = (req: IncomingMessage, res: ServerResponse) => void;

export const FAKE_LIBPOD_VERSION = "4.9.3";

/**
 * Mimics real Podman routing (verified against Podman 4.9.3): /libpod/_ping is unversioned and
 * announces Libpod-Api-Version; every other libpod route answers 404 without the /v<version> prefix.
 * The wrapped handler always sees the unversioned path.
 */
export function realisticPodman(handler: FakeHandler, version: string | null = FAKE_LIBPOD_VERSION): FakeHandler {
  return (req, res) => {
    const url = req.url ?? "";
    if (url === "/libpod/_ping" || url === "/_ping") {
      res.writeHead(200, { "Content-Type": "text/plain", ...(version ? { "Libpod-Api-Version": version } : {}) });
      return void res.end("OK");
    }
    const m = /^\/v(\d+\.\d+\.\d+)(\/libpod\/.*)$/.exec(url);
    if (m) {
      req.url = m[2]!;
      return handler(req, res);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 page not found");
  };
}

export interface Fake {
  server: Server;
  socketPath: string;
  calls: string[];
  close(): Promise<void>;
}

/** Test double standing in for the Podman unix socket (tests only). */
export async function startFakePodman(handler: FakeHandler): Promise<Fake> {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  const socketPath = join(dir, "podman.sock");
  const calls: string[] = [];
  const real = realisticPodman(handler);
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    real(req, res);
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  return {
    server,
    socketPath,
    calls,
    close: () =>
      new Promise((r) =>
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          r();
        }),
      ),
  };
}

export const silent = { info() {}, error() {} };

export interface Running {
  base: string;
  logs: LogBuffer;
  close(): Promise<void>;
}

export async function startAgent(socketPath: string, over: Partial<AgentConfig> = {}): Promise<Running> {
  const cfg: AgentConfig = {
    agentId: "test-agent",
    host: "127.0.0.1",
    port: 0,
    tokenHash: hashToken(TOKEN),
    podmanSocket: socketPath,
    podmanTimeoutMs: 2000,
    stopTimeoutSec: 10,
    rateLimitMax: 3,
    rateLimitWindowMs: 60000,
    ...over,
  };
  const svc = new PodmanService(new PodmanClient(socketPath, cfg.podmanTimeoutMs), cfg.stopTimeoutSec);
  const logs = new LogBuffer(5);
  const server = createAgentServer(cfg, svc, { info: (m) => logs.push("info", m), error: (m) => logs.push("error", m) }, logs);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, logs, close: () => new Promise((r) => server.close(() => r())) };
}

export const auth = { Authorization: `Bearer ${TOKEN}` };

export function jsonRes(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
