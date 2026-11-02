import type { HealthInfo } from "../../../../shared/types/index.js";
import { hostname } from "node:os";
import { PodmanError } from "../podman/client.js";
import type { PodmanService } from "../podman/service.js";

export const AGENT_VERSION = "0.1.0";

export async function collectHealth(agentId: string, podman: PodmanService): Promise<HealthInfo> {
  const info: HealthInfo = {
    agentId,
    agentVersion: AGENT_VERSION,
    hostname: hostname(),
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
