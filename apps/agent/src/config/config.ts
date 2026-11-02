import { join } from "node:path";

export interface AgentConfig {
  agentId: string;
  host: string;
  port: number;
  tokenHash: string;
  podmanSocket: string;
  podmanTimeoutMs: number;
  stopTimeoutSec: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export class ConfigError extends Error {}

function int(
  env: NodeJS.ProcessEnv,
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return def;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be an integer`);
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(`${key} must be ${min}-${max}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const agentId = env.AGENT_ID ?? "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) {
    throw new ConfigError("AGENT_ID missing or invalid (A-Z a-z 0-9 . _ -, max 64)");
  }
  const tokenHash = (env.AGENT_TOKEN_HASH ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new ConfigError("AGENT_TOKEN_HASH missing or not a SHA-256 hex digest");
  }
  let podmanSocket = env.PODMAN_SOCKET ?? "";
  if (podmanSocket === "") {
    const runtime = env.XDG_RUNTIME_DIR;
    if (!runtime) {
      throw new ConfigError("PODMAN_SOCKET not set and XDG_RUNTIME_DIR unavailable");
    }
    podmanSocket = join(runtime, "podman", "podman.sock");
  }
  if (!podmanSocket.startsWith("/")) {
    throw new ConfigError("PODMAN_SOCKET must be an absolute path");
  }
  return {
    agentId,
    host: env.AGENT_HOST || "0.0.0.0",
    port: int(env, "AGENT_PORT", 9126, 1, 65535),
    tokenHash,
    podmanSocket,
    podmanTimeoutMs: int(env, "PODMAN_TIMEOUT_MS", 30000, 1000, 120000),
    stopTimeoutSec: 10,
    rateLimitMax: int(env, "RATE_LIMIT_MAX", 10, 1, 1000),
    rateLimitWindowMs: int(env, "RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000),
  };
}
