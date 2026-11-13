import type { HealthInfo } from "../../../../shared/types/index.js";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { PodmanError } from "../podman/client.js";
import type { PodmanService } from "../podman/service.js";

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** APP_VERSION (set from the git tag in Docker images) wins, then dist/version.json (written by the build), else "dev". */
export function resolveVersion(env: Record<string, string | undefined>, fileVersion: string | null): string {
  const e = (env.APP_VERSION ?? "").trim().replace(/^v/, "");
  if (SEMVER.test(e)) return e;
  return fileVersion && SEMVER.test(fileVersion) ? fileVersion : "dev";
}

function readBuildVersion(): string | null {
  try {
    // via a variable: bundlers (the master compiles this file too) must not treat it as an asset reference
    const here = import.meta.url;
    const v = (JSON.parse(readFileSync(new URL("../version.json", here), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export const AGENT_VERSION = resolveVersion(process.env, readBuildVersion());

export async function collectHealth(agentId: string, podman: PodmanService, hostName?: string): Promise<HealthInfo> {
  const info: HealthInfo = {
    agentId,
    agentVersion: AGENT_VERSION,
    hostname: hostName || hostname(),
    podmanVersion: null,
    podmanApiVersion: null,
    socketStatus: "ok",
    apiStatus: "unknown",
    agentStatus: "ok",
  };
  try {
    await podman.ping();
    info.apiStatus = "ok";
    const v = await podman.version();
    info.podmanVersion = v.version;
    info.podmanApiVersion = v.apiVersion;
  } catch (e) {
    info.agentStatus = "degraded";
    if (e instanceof PodmanError) {
      if (e.code === "SOCKET_MISSING") info.socketStatus = "missing";
      else if (e.code === "SOCKET_UNREACHABLE") info.socketStatus = "unreachable";
      else info.apiStatus = "error";
      info.error = { code: e.code, message: e.message };
    } else {
      info.apiStatus = "error";
      info.error = { code: "INTERNAL", message: "Unexpected error" };
    }
  }
  return info;
}
