import { createHash, randomBytes } from "node:crypto";
import { ConfigError, loadConfig } from "./config/config.js";
import { createAgentServer, type Logger } from "./api/server.js";
import { PodmanClient } from "./podman/client.js";
import { PodmanService } from "./podman/service.js";
import { AGENT_VERSION } from "./services/health.js";
import { LogBuffer } from "./logbuffer.js";
import { PeerUpdater, SelfUpdater } from "./services/update.js";

const logs = new LogBuffer(500);
const log: Logger = {
  info: (m) => {
    console.log(`${new Date().toISOString()} INFO ${m}`);
    logs.push("info", m);
  },
  error: (m) => {
    console.error(`${new Date().toISOString()} ERROR ${m}`);
    logs.push("error", m);
  },
};

if (process.argv.includes("--generate-token")) {
  const token = randomBytes(32).toString("base64url");
  console.log(`AGENT_TOKEN (enter in Master, shown once): ${token}`);
  console.log(`AGENT_TOKEN_HASH (put in agent.env): ${createHash("sha256").update(token).digest("hex")}`);
  process.exit(0);
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  log.error("Refusing to run as root. Run as a normal user with rootless Podman.");
  process.exit(1);
}

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  log.error(e instanceof ConfigError ? e.message : "Invalid configuration");
  process.exit(1);
}

const client = new PodmanClient(cfg.podmanSocket, cfg.podmanTimeoutMs);
const podman = new PodmanService(client, cfg.stopTimeoutSec);
const server = createAgentServer(cfg, podman, log, logs, new SelfUpdater(podman, { log }), cfg.updateUnit ? new PeerUpdater(podman, cfg.updateUnit, { log }) : undefined);

server.listen(cfg.port, cfg.host, () => {
  log.info(`agent ${cfg.agentId} v${AGENT_VERSION} listening on http://${cfg.host}:${cfg.port}`);
  log.info(`podman socket: ${cfg.podmanSocket}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
