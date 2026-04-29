#!/usr/bin/env bash
#
# Tauri beforeDevCommand — 清理 Vite 残留进程后启动 Vite
# Phoenix 由 scripts/dev.sh 管理，此脚本只负责前端。
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- 加载端口配置 ----

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

VITE_PORT="${VITE_DEV_PORT:-5768}"

# ---- 清理残留 ----

if lsof -ti ":${VITE_PORT}" > /dev/null 2>&1; then
  echo "[tauri] Cleaning up stale process on port ${VITE_PORT}..."
  lsof -ti ":${VITE_PORT}" | xargs kill 2>/dev/null || true
  sleep 1
fi

# ---- 启动 Vite ----

cd "$PROJECT_ROOT/frontend"
exec pnpm dev
