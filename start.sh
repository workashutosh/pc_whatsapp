#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

http_ok() {
  curl -sf --max-time 2 "$1" >/dev/null 2>&1
}

wait_http() {
  local url=$1
  local name=$2
  local tries=${3:-40}
  local i
  for ((i = 1; i <= tries; i++)); do
    if http_ok "$url"; then
      echo "$name is ready"
      return 0
    fi
    sleep 1
  done
  echo "warning: $name did not become ready at $url" >&2
  return 1
}

start_npm() {
  local name=$1
  local dir=$2
  local ready_url=$3
  local log="$LOG_DIR/$name.log"
  local pidfile="$LOG_DIR/$name.pid"

  if http_ok "$ready_url"; then
    echo "$name is already running"
    return 0
  fi

  if [[ ! -d "$dir/node_modules" ]]; then
    echo "Installing $name dependencies..."
    (cd "$dir" && npm install)
  fi

  echo "Starting $name..."
  (
    cd "$dir"
    npm run dev >>"$log" 2>&1 &
    echo $! >"$pidfile"
  )
}

if ! have_cmd npm || ! have_cmd curl; then
  echo "npm and curl are required" >&2
  exit 1
fi

if have_cmd docker; then
  echo "Starting Evolution (postgres, redis, evolution-api)..."
  docker compose up -d postgres redis evolution-api
  wait_http "http://127.0.0.1:18080" "Evolution API" 60 || true
else
  echo "Docker not found — skipping Evolution. The inbox will start without a live WhatsApp line."
fi

start_npm backend "$ROOT/backend" "http://127.0.0.1:3001/health"
start_npm frontend "$ROOT/frontend" "http://127.0.0.1:5173"

wait_http "http://127.0.0.1:3001/health" "Backend" 30 || true
wait_http "http://127.0.0.1:5173" "Frontend" 30 || true

cat <<EOF

Inbox:     http://localhost:5173
API:       http://127.0.0.1:3001/health
Evolution: http://127.0.0.1:18080

alice@acme.test / AcmeAdmin!1
bob@acme.test   / AcmeManager!1
riya@acme.test  / AcmeAgent!1

Logs: $LOG_DIR
EOF
