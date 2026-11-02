#!/usr/bin/env bash
# Builds and pushes both images to Docker Hub.
# Usage: DOCKERHUB_USER=me [DOCKERHUB_TOKEN=...] deployment/publish-images.sh [version]
# Create the two repositories as PRIVATE on hub.docker.com first (podmanmanager-master, podmanmanager-agent).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${DOCKERHUB_USER:?set DOCKERHUB_USER}"
VERSION="${1:-$(git describe --tags --always 2>/dev/null || echo dev)}"
CLI="${CONTAINER_CLI:-$(command -v docker >/dev/null && echo docker || echo podman)}"

if [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  printf '%s' "$DOCKERHUB_TOKEN" | "$CLI" login docker.io -u "$DOCKERHUB_USER" --password-stdin
fi

for app in master agent; do
  IMG="docker.io/$DOCKERHUB_USER/podmanmanager-$app"
  echo "==> $IMG:$VERSION"
  "$CLI" build -f "deployment/Dockerfile.$app" -t "$IMG:$VERSION" -t "$IMG:latest" .
  "$CLI" push "$IMG:$VERSION"
  "$CLI" push "$IMG:latest"
done
echo "Done. Verify on hub.docker.com that both repositories are marked Private."
