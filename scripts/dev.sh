#!/usr/bin/env bash
#
# AI Novel Studio 桌面应用 — 一键启动
#
# 用法：
#   bash scripts/dev.sh           # 桌面端（Tauri 原生窗口）
#   bash scripts/dev.sh --web     # 浏览器模式（仅 Vite + Phoenix）
#
# 端口统一从 frontend/.env 读取，修改端口只需改 .env。
#

set -euo pipefail

MODE="${1:-tauri}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHX_PID=""

cleanup() {
  if [[ -n "$PHX_PID" ]]; then
    kill $PHX_PID 2>/dev/null || true
    wait $PHX_PID 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- 加载端口配置（单一来源：frontend/.env） ----

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"

echo "=== AI Novel Studio ==="

# ---- 浏览器模式 ----

if [[ "$MODE" == "--web" ]]; then
  echo "  浏览器模式 (Phoenix: ${PHOENIX_PORT}, Vite: ${VITE_PORT})"
  cd "$PROJECT_ROOT"
  PHOENIX_PORT="$PHOENIX_PORT" mix phx.server &
  PHX_PID=$!
  sleep 3
  cd "$PROJECT_ROOT/frontend"
  exec pnpm dev
fi

# ---- 桌面端模式 ----

echo "  桌面端模式 (Phoenix: ${PHOENIX_PORT}, Vite: ${VITE_PORT})"

# 同步 tauri.conf.json（在 Tauri 读取配置之前完成）
TAURI_CONF="$PROJECT_ROOT/frontend/src-tauri/tauri.conf.json"
sed -i '' \
  -e "s|\"devUrl\": \"http://localhost:[0-9]*\"|\"devUrl\": \"http://localhost:${VITE_PORT}\"|" \
  -e "s|\(connect-src 'self' \)http://localhost:[0-9]*\( ws://localhost:\)[0-9]*|\1http://localhost:${PHOENIX_PORT}\2${PHOENIX_PORT}|" \
  "$TAURI_CONF"

# 启动 Phoenix
PHX_URL="http://localhost:${PHOENIX_PORT}"

if curl -s "$PHX_URL/health" 2>/dev/null | grep -q "ok"; then
  echo "[dev] Phoenix already running ($PHX_URL)"
else
  echo "[dev] Starting Phoenix backend on port ${PHOENIX_PORT}..."
  cd "$PROJECT_ROOT"
  PHOENIX_PORT="$PHOENIX_PORT" mix phx.server &
  PHX_PID=$!

  for i in $(seq 1 15); do
    if curl -s "$PHX_URL/health" 2>/dev/null | grep -q "ok"; then
      echo "[dev] Phoenix ready ($PHX_URL)"
      break
    fi
    if [[ $i -eq 15 ]]; then
      echo "[dev] ERROR: Phoenix failed to start"
      exit 1
    fi
    sleep 1
  done
fi

# 启动 Tauri（Vite 由 tauri 的 beforeDevCommand 负责）
cd "$PROJECT_ROOT/frontend"
exec pnpm tauri dev
