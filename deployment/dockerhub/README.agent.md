# PodmanManager Agent

Lightweight agent for [PodmanManager](https://github.com/PetreHoffmann/PodmanManager) (Apache-2.0). It talks **only** to the local **rootless Podman unix socket** of its own user and offers a small authenticated HTTP API (port 9126) to the Master: list containers, start, stop, restart. No shell, no arbitrary Podman commands, no dependencies, never runs as root.

The recommended deployment is the native systemd user service (`deployment/agent/install.sh` in the repository). The container variant needs the rootless socket mounted and must run as the Podman user's UID.

## Quick start (Podman)

```bash
# 1. Generate a token and its hash (enter the token in the Master, keep the hash for the agent)
podman run --rm petrecalinoiu/podmanmanager-agent:latest node dist/index.js --generate-token

# 2. Run the agent as the Podman user
podman run -d --name pm-agent --user $(id -u) --userns=keep-id -p 9126:9126 \
  -v $XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock \
  -e AGENT_ID=host-1 -e AGENT_TOKEN_HASH=<hash> \
  docker.io/petrecalinoiu/podmanmanager-agent:latest
```

Then add `http://<host-ip>:9126` and the token in the Master under **Hosts**. Enable the socket first: `systemctl --user enable --now podman.socket`.

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
