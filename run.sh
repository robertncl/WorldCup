#!/usr/bin/env bash
#
# Build the Bun frontend and start the Go server for the World Cup 2026
# simulator. Any extra arguments are forwarded to the Go server (e.g. -addr).
#
#   ./run.sh                 # serve on http://localhost:8080
#   PORT=9000 ./run.sh       # serve on a different port
#   ./run.sh -addr 127.0.0.1:8080
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export GOTELEMETRY=off

# Make a locally-installed Go toolchain discoverable if it isn't already.
command -v go >/dev/null 2>&1 || export PATH="$HOME/sdk/go/bin:$PATH"

command -v bun >/dev/null 2>&1 || { echo "error: Bun is not installed (https://bun.sh)" >&2; exit 1; }
command -v go  >/dev/null 2>&1 || { echo "error: Go is not installed (https://go.dev/dl)" >&2; exit 1; }

echo "==> Building frontend (Bun)…"
( cd "$ROOT/frontend" && bun run build )

echo "==> Starting server (Go) on port ${PORT:-8080}…"
cd "$ROOT/backend"
exec go run . -static "$ROOT/frontend/dist" "$@"
