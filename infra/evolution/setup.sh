#!/usr/bin/env bash
# Install Evolution API natively (no Docker) into .evolution/.
# Needs: git, Node 22, and a local PostgreSQL (e.g. `brew install postgresql@14 && brew services start postgresql@14`).
# Redis is not needed: Evolution caches in memory.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVO_DIR="$ROOT/.evolution"
EVO_VERSION="2.2.3"   # infra/patch-evolution-lid.js targets this exact release
EVO_PORT="${EVOLUTION_PORT:-18080}"
PG_URL="${EVOLUTION_DATABASE_URL:-postgresql://$(whoami)@localhost:5432/evolution?schema=public}"

env_value() {
  grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

API_KEY="$(env_value EVOLUTION_API_KEY)"
if [[ -z "$API_KEY" ]]; then
  echo "EVOLUTION_API_KEY is missing from backend/.env. Copy backend/.env.example first." >&2
  exit 1
fi

if ! pg_isready -q 2>/dev/null; then
  echo "PostgreSQL is not running. Start it with: brew services start postgresql@14" >&2
  exit 1
fi

if [[ ! -d "$EVO_DIR/.git" ]]; then
  echo "Downloading Evolution API $EVO_VERSION..."
  git clone --depth 1 --branch "$EVO_VERSION" -q https://github.com/EvolutionAPI/evolution-api.git "$EVO_DIR"
fi

if ! psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'evolution'" | grep -q 1; then
  echo "Creating PostgreSQL database 'evolution'..."
  createdb evolution
fi

cat >"$EVO_DIR/.env" <<EOF
SERVER_TYPE=http
SERVER_PORT=$EVO_PORT
SERVER_URL=http://localhost:$EVO_PORT
AUTHENTICATION_API_KEY=$API_KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
DEL_INSTANCE=false
LANGUAGE=en
LOG_LEVEL=ERROR,WARN,INFO
LOG_BAILEYS=error

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=$PG_URL
DATABASE_CONNECTION_CLIENT_NAME=evolution
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true

CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

QRCODE_LIMIT=10
CONFIG_SESSION_PHONE_CLIENT=Chrome
CONFIG_SESSION_PHONE_NAME=Chrome
CONFIG_SESSION_PHONE_VERSION=2.3000.1047094411
WEBHOOK_GLOBAL_ENABLED=false
EOF

cd "$EVO_DIR"

# Evolution's Baileys build pulls in sharp 0.32, whose own libvips downloader aborts on some machines.
# Pre-seed sharp's download cache with curl so it never needs to download anything itself.
LIBVIPS_VERSION="8.14.5"
case "$(uname -s)-$(uname -m)" in
  Darwin-x86_64) LIBVIPS_PLATFORM="darwin-x64" ;;
  Darwin-arm64) LIBVIPS_PLATFORM="darwin-arm64v8" ;;
  Linux-x86_64) LIBVIPS_PLATFORM="linux-x64" ;;
  Linux-aarch64) LIBVIPS_PLATFORM="linux-arm64v8" ;;
  *) LIBVIPS_PLATFORM="" ;;
esac
if [[ -n "$LIBVIPS_PLATFORM" ]]; then
  LIBVIPS_CACHE="$(npm config get cache)/_libvips"
  LIBVIPS_TAR="libvips-$LIBVIPS_VERSION-$LIBVIPS_PLATFORM.tar.br"
  mkdir -p "$LIBVIPS_CACHE"
  if [[ ! -s "$LIBVIPS_CACHE/$LIBVIPS_TAR" ]]; then
    curl -fsSL --retry 3 -o "$LIBVIPS_CACHE/$LIBVIPS_TAR" \
      "https://github.com/lovell/sharp-libvips/releases/download/v$LIBVIPS_VERSION/$LIBVIPS_TAR"
  fi
fi

echo "Installing Evolution packages (first run takes a few minutes)..."
npm install --no-audit --no-fund --loglevel=error
echo "Preparing Evolution database..."
npm run db:deploy --silent
npm run db:generate --silent
echo "Building Evolution..."
npx tsup >/dev/null
node "$ROOT/infra/patch-evolution-lid.js"
echo "Evolution API is installed. It runs on http://localhost:$EVO_PORT"
