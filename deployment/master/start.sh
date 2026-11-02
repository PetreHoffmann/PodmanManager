#!/usr/bin/env bash
# Manual start of the Master. Usage: deployment/master/start.sh [env-file]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-${MASTER_ENV_FILE:-}}"
if [ -n "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
[ -n "${MASTER_SECRET_KEY:-}" ] || { echo "MASTER_SECRET_KEY is not set (openssl rand -base64 32)" >&2; exit 1; }
[ -d "$ROOT/apps/master/.next" ] || { echo "Not built. Run: npm ci && npm run build -w apps/master" >&2; exit 1; }
cd "$ROOT/apps/master"
exec "$ROOT/node_modules/.bin/next" start -H "${MASTER_HOST:-0.0.0.0}" -p "${MASTER_PORT:-8080}"
