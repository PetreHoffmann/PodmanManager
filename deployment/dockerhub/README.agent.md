# PodmanManager Agent

Lightweight agent for [PodmanManager](https://github.com/PetreHoffmann/PodmanManager) (Apache-2.0). It talks **only** to the local **rootless Podman unix socket** of its own user and offers a small authenticated HTTP API (port 9126) to the Master: list and inspect containers, pods, images, networks and volumes, start, stop, restart, logs and metrics. On request of a Master administrator it also creates containers and pods (strictly validated: named volumes only, no privileged mode, no host paths), deletes stopped containers and pods that systemd does not manage, and, only if you switch it on with `EXEC_ENABLED=true`, runs single commands in a container. No shell session, no arbitrary Podman commands, no dependencies, never runs as root.

The agent runs as a **rootless container** (Quadlet for permanent operation, `podman run` to try it out). It needs the rootless socket mounted and must run as the Podman user's UID.

## Quick start (Podman)

The **Master creates the token and its hash**, nothing has to be generated on the host:

1. In the Master open **Hosts → Set up a new agent**, enter the agent address (`http://<host-ip>:9126`) and an agent ID. The Master stores the token and shows the hash as a ready Quadlet file (with the hash in the file, or as a Podman secret: tab **Quadlet + secret**), as a ready `podman run` command (tab **podman run**) or as an `AGENT_TOKEN_HASH=…` line.
2. Enable the socket (`systemctl --user enable --now podman.socket`) and run the agent as the Podman user:

```bash
podman run -d --name podmanmanager-agent --restart=always \
  --hostname "$(hostname)" --user "$(id -u)" --userns=keep-id \
  -p 9126:9126 \
  -v "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \
  -e AGENT_ID=host-1 -e AGENT_TOKEN_HASH=<hash from the Master> \
  docker.io/petrecalinoiu/podmanmanager-agent:latest
```

The host turns **online** in the Master by itself. For permanent operation use the Quadlet file the Master shows (save it as `~/.config/containers/systemd/podmanmanager-agent.container`, `chmod 600`, `systemctl --user daemon-reload`, `systemctl --user start podmanmanager-agent`). On SELinux hosts add `--security-opt label=disable`. Step by step: [deployment/README.md](https://github.com/PetreHoffmann/PodmanManager/blob/main/deployment/README.md).

## Configuration

| Variable | Default | |
|---|---|---|
| `AGENT_ID` | required | unique id (`A-Z a-z 0-9 . _ -`) |
| `AGENT_TOKEN_HASH` | required | SHA-256 of the agent token |
| `AGENT_PORT` / `AGENT_HOST` | `9126` / `0.0.0.0` | |
| `PODMAN_SOCKET` | `/run/podman/podman.sock` | path inside the container |
| `RATE_LIMIT_MAX` | `10` | failed auth attempts per IP and minute |

## Security

HTTP only (no TLS) by design. Open port 9126 **only for the Master's IP**. Anyone with the token can start/stop/restart the containers of this user (nothing more). See [docs/security.md](https://github.com/PetreHoffmann/PodmanManager/blob/main/docs/security.md) (German).

## Links

- Source, docs, issues: https://github.com/PetreHoffmann/PodmanManager
- Master image: https://hub.docker.com/r/petrecalinoiu/podmanmanager-master
