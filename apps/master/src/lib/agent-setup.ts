import { createHash, randomBytes } from "node:crypto";

export const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Same procedure as `agent --generate-token`: 32 random bytes, hash = SHA-256 (hex) of the token text. */
export function newAgentToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAgentToken(token) };
}

export const hashAgentToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export interface AgentSetup {
  agentId: string;
  hash: string;
  /** complete podmanmanager-agent.container */
  quadlet: string;
  /** only the hash, for own Quadlet files or podman run commands */
  hashLine: string;
  /** ready podman run command (to try it out; Quadlet is better for permanent operation) */
  podmanRun: string;
  /** Quadlet file that reads the hash from the Podman secret `podmanmanager-agent-hash` (the file itself holds no hash) */
  quadletSecret: string;
  /** shell command that creates that secret from the hash */
  secretCommand: string;
}

export const HASH_SECRET_NAME = "podmanmanager-agent-hash";

/** Quadlet file with the values of this host filled in; the hash is an Environment= value (file: chmod 600). */
export function agentSetup(agentId: string, address: string, hash: string): AgentSetup {
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
  const quadletFor = (comment: string, hashLine: string) => `# PodmanManager Agent als Quadlet (rootless), erzeugt vom Master.
${comment}
[Unit]
Description=PodmanManager Agent
Wants=podman.socket
After=podman.socket network-online.target

[Container]
Image=docker.io/petrecalinoiu/podmanmanager-agent:latest
ContainerName=podmanmanager-agent
HostName=%H
PublishPort=${ipv4 ? `${address}:` : ""}9126:9126
Volume=%t/podman/podman.sock:/run/podman/podman.sock
UserNS=keep-id
User=%U
SecurityLabelDisable=true

Environment=AGENT_ID=${agentId}
Environment=PODMAN_SOCKET=/run/podman/podman.sock
${hashLine}

NoNewPrivileges=true
DropCapability=ALL

[Service]
Restart=always
TimeoutStartSec=120

[Install]
WantedBy=default.target
`;
  const quadlet = quadletFor(
    "# Save as ~/.config/containers/systemd/podmanmanager-agent.container and run chmod 600 on it (it contains the hash).",
    `Environment=AGENT_TOKEN_HASH=${hash}`,
  );
  const quadletSecret = quadletFor(
    `# Save as ~/.config/containers/systemd/podmanmanager-agent.container. The hash is not in this file: create the Podman secret first (see the command of the Master).`,
    `Secret=${HASH_SECRET_NAME},type=env,target=AGENT_TOKEN_HASH`,
  );
  const podmanRun = `podman run -d --name podmanmanager-agent --restart=always \\
  --hostname "$(hostname)" \\
  --user "$(id -u)" --userns=keep-id \\
  -p ${ipv4 ? `${address}:` : ""}9126:9126 \\
  -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \\
  --security-opt label=disable \\
  -e AGENT_ID=${agentId} \\
  -e AGENT_TOKEN_HASH=${hash} \\
  docker.io/petrecalinoiu/podmanmanager-agent:latest
`;
  const secretCommand = `printf '%s' ${hash} | podman secret create ${HASH_SECRET_NAME} -\n`;
  return { agentId, hash, quadlet, hashLine: `AGENT_TOKEN_HASH=${hash}`, podmanRun, quadletSecret, secretCommand };
}
