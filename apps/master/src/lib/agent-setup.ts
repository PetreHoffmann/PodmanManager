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
  /** only the hash, for agent.env / Puppet Hiera / own Quadlet files */
  hashLine: string;
}

/** Quadlet file with the values of this host filled in; the hash is an Environment= value (file: chmod 600). */
export function agentSetup(agentId: string, address: string, hash: string): AgentSetup {
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
  const quadlet = `# PodmanManager Agent als Quadlet (rootless), erzeugt vom Master.
# Save as ~/.config/containers/systemd/podmanmanager-agent.container and run chmod 600 on it (it contains the hash).
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
Environment=AGENT_TOKEN_HASH=${hash}

NoNewPrivileges=true
DropCapability=ALL

[Service]
Restart=always
TimeoutStartSec=120

[Install]
WantedBy=default.target
`;
  return { agentId, hash, quadlet, hashLine: `AGENT_TOKEN_HASH=${hash}` };
}
