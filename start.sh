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

start_evolution() {
  local evo_dir="$ROOT/.evolution"
  local log="$LOG_DIR/evolution.log"

  if http_ok "http://127.0.0.1:18080"; then
    echo "Evolution API is already running"
    return 0
  fi

  if ! pg_isready -q 2>/dev/null; then
    if have_cmd brew; then
      echo "Starting PostgreSQL..."
      brew services start postgresql@14 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
      for _ in $(seq 1 15); do pg_isready -q 2>/dev/null && break; sleep 1; done
    fi
  fi
  if ! pg_isready -q 2>/dev/null; then
    echo "PostgreSQL is not running — skipping Evolution. The inbox will start without a live WhatsApp line."
    return 0
  fi

  if [[ ! -f "$evo_dir/dist/main.js" ]]; then
    echo "Evolution API is not installed yet. Installing (one time, a few minutes)..."
    "$ROOT/infra/evolution/setup.sh"
  fi

  echo "Starting Evolution API..."
  (
    cd "$evo_dir"
    node dist/main >>"$log" 2>&1 &
    echo $! >"$LOG_DIR/evolution.pid"
  )
  wait_http "http://127.0.0.1:18080" "Evolution API" 60 || true
}

if have_cmd pg_isready; then
  start_evolution
else
  echo "PostgreSQL not found — skipping Evolution. The inbox will start without a live WhatsApp line."
  echo "Install it with: brew install postgresql@14 && brew services start postgresql@14"
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
