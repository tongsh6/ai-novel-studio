#!/usr/bin/env bash
#
# Tauri beforeDevCommand — 清理 Vite 残留进程后启动 Vite
# Phoenix 由 scripts/dev.sh 管理，此脚本只负责前端。
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- 加载端口配置 ----

REQUESTED_VITE_DEV_PORT="${VITE_DEV_PORT:-}"
REQUESTED_VITE_API_ENDPOINT="${VITE_API_ENDPOINT:-}"
REQUESTED_VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-}"
REQUESTED_VITE_WS_ENDPOINT="${VITE_WS_ENDPOINT:-}"
REQUESTED_VITE_DEV_PORT_SET="${VITE_DEV_PORT+x}"
REQUESTED_VITE_API_ENDPOINT_SET="${VITE_API_ENDPOINT+x}"
REQUESTED_VITE_PROXY_TARGET_SET="${VITE_PROXY_TARGET+x}"
REQUESTED_VITE_WS_ENDPOINT_SET="${VITE_WS_ENDPOINT+x}"

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

if [[ -n "$REQUESTED_VITE_DEV_PORT_SET" ]]; then
  export VITE_DEV_PORT="$REQUESTED_VITE_DEV_PORT"
else
  export VITE_DEV_PORT="${VITE_DEV_PORT:-5769}"
fi

if [[ -n "$REQUESTED_VITE_API_ENDPOINT_SET" ]]; then
  export VITE_API_ENDPOINT="$REQUESTED_VITE_API_ENDPOINT"
else
  # Tauri dev is served from Vite. Keep HTTP API same-origin (/api) and proxy
  # through Vite unless the caller explicitly configured a direct endpoint.
  export VITE_API_ENDPOINT=""
fi

if [[ -n "$REQUESTED_VITE_PROXY_TARGET_SET" ]]; then
  export VITE_PROXY_TARGET="$REQUESTED_VITE_PROXY_TARGET"
else
  export VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-http://127.0.0.1:${PHOENIX_PORT:-4657}}"
fi

if [[ -n "$REQUESTED_VITE_WS_ENDPOINT_SET" ]]; then
  export VITE_WS_ENDPOINT="$REQUESTED_VITE_WS_ENDPOINT"
else
  export VITE_WS_ENDPOINT="${VITE_WS_ENDPOINT:-}"
fi

VITE_PORT="${VITE_DEV_PORT:-5768}"

# ---- 清理残留 ----

if lsof -ti ":${VITE_PORT}" > /dev/null 2>&1; then
  echo "[tauri] Cleaning up stale process on port ${VITE_PORT}..."
  lsof -ti ":${VITE_PORT}" | xargs kill 2>/dev/null || true
fi

for _ in $(seq 1 30); do
  if ! lsof -ti ":${VITE_PORT}" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if lsof -ti ":${VITE_PORT}" > /dev/null 2>&1; then
  echo "[tauri] Port ${VITE_PORT} is still busy after cleanup." >&2
  exit 1
fi

# ---- 启动 Vite ----

cd "$PROJECT_ROOT/frontend"
exec pnpm dev
