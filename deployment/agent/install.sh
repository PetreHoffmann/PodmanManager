#!/usr/bin/env bash
# Installs the PodmanManager agent for the CURRENT (non-root) user. Run from a repo checkout.
# Usage: deployment/agent/install.sh [agent-id]      Env: SKIP_SYSTEMD=1 (files only)
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then echo "Refusing to run as root. Use a normal user." >&2; exit 1; fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_ID="${1:-$(hostname -s)}"
APP_DIR="$HOME/.local/share/podmanmanager-agent"
CONF_DIR="$HOME/.config/podmanmanager"
ENV_FILE="$CONF_DIR/agent.env"
UNIT_DIR="$HOME/.config/systemd/user"

command -v node >/dev/null || { echo "Node.js >= 22 required" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node.js >= 22 required" >&2; exit 1; }
command -v podman >/dev/null || { echo "podman not found (rootless Podman required)" >&2; exit 1; }
[[ "$AGENT_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid agent id" >&2; exit 1; }

echo "==> Building agent"
(cd "$REPO" && npm ci --no-audit --no-fund -w apps/agent >/dev/null && npm run build -w apps/agent >/dev/null)

echo "==> Installing to $APP_DIR"
rm -rf "$APP_DIR/dist"; mkdir -p "$APP_DIR" "$CONF_DIR" "$UNIT_DIR"
cp -r "$REPO/apps/agent/dist" "$APP_DIR/dist"
printf '{"type":"module"}\n' > "$APP_DIR/package.json"

if [ -f "$ENV_FILE" ]; then
  echo "==> Keeping existing $ENV_FILE (token unchanged)"
else
  OUT="$(node "$APP_DIR/dist/index.js" --generate-token)"
  TOKEN="$(printf '%s\n' "$OUT" | awk -F': ' '/^AGENT_TOKEN \(/{print $2}')"
  HASH="$(printf '%s\n' "$OUT" | awk -F': ' '/^AGENT_TOKEN_HASH/{print $2}')"
  umask 077
  { echo "AGENT_ID=$AGENT_ID"; echo "AGENT_HOST=0.0.0.0"; echo "AGENT_PORT=9126"; echo "AGENT_TOKEN_HASH=$HASH"; } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "==> Created $ENV_FILE"
  echo
  echo "    AGENT TOKEN (enter it in the Master; shown only once, not stored):"
  echo "    $TOKEN"
  echo
fi

sed "s#@NODE@#$(command -v node)#" "$REPO/deployment/agent/podmanmanager-agent.service" > "$UNIT_DIR/podmanmanager-agent.service"

if [ "${SKIP_SYSTEMD:-0}" = "1" ]; then echo "==> SKIP_SYSTEMD=1: not touching systemd"; exit 0; fi

echo "==> Enabling rootless Podman socket and agent service"
systemctl --user daemon-reload
systemctl --user enable --now podman.socket
SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
[ -S "$SOCK" ] && echo "    Podman socket OK: $SOCK" || echo "WARNING: Podman socket not found at $SOCK" >&2
systemctl --user enable --now podmanmanager-agent.service

echo "==> Done. Status: systemctl --user status podmanmanager-agent"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
  echo "NOTE: Lingering is off. To run without an active login session after reboot:"
  echo "      sudo loginctl enable-linger $USER"
fi
echo "NOTE: Open port 9126 only for the Master IP (see docs/security.md)."
