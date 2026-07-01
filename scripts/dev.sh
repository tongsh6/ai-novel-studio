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
# 启用 job control：每个后台 `&` 作业自成进程组，cleanup 时可整组回收，
# 即使用户直接关闭 Tauri 窗口（包装进程先退）也不会留下孤儿 vite/app。
set -m

MODE="${1:-tauri}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"
source "$PROJECT_ROOT/scripts/lib/tauri_dev_config.sh"
PHX_PID=""
VITE_PID=""
TAURI_PID=""
TAURI_CONFIG_OVERRIDE=""
CLEANED_UP=false

terminate_pid() {
  local pid="$1"

  [[ -n "$pid" ]] || return 0
  # 不只杀包装进程，连同其进程树/进程组一并回收（孤儿 vite/app 也在内）。
  kill_process_tree "$pid"
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ "$CLEANED_UP" == "true" ]]; then
    return
  fi
  CLEANED_UP=true

  terminate_pid "$TAURI_PID"
  terminate_pid "$VITE_PID"
  terminate_pid "$PHX_PID"
  if [[ -n "$TAURI_CONFIG_OVERRIDE" ]]; then
    rm -f "$TAURI_CONFIG_OVERRIDE" 2>/dev/null || true
  fi
}

on_signal() {
  local exit_code="$1"
  cleanup
  trap - EXIT INT TERM
  exit "$exit_code"
}

trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

# ---- 加载端口配置（单一来源：frontend/.env） ----

REQUESTED_VITE_API_ENDPOINT="${VITE_API_ENDPOINT:-}"
REQUESTED_VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-}"
REQUESTED_VITE_WS_ENDPOINT="${VITE_WS_ENDPOINT:-}"
REQUESTED_AI_NOVEL_DESKTOP_PROFILE="${AI_NOVEL_DESKTOP_PROFILE:-}"
REQUESTED_VITE_API_ENDPOINT_SET="${VITE_API_ENDPOINT+x}"
REQUESTED_VITE_PROXY_TARGET_SET="${VITE_PROXY_TARGET+x}"
REQUESTED_VITE_WS_ENDPOINT_SET="${VITE_WS_ENDPOINT+x}"
REQUESTED_AI_NOVEL_DESKTOP_PROFILE_SET="${AI_NOVEL_DESKTOP_PROFILE+x}"

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"
export VITE_DEV_PORT="$VITE_PORT"

if [[ -n "$REQUESTED_AI_NOVEL_DESKTOP_PROFILE_SET" ]]; then
  export AI_NOVEL_DESKTOP_PROFILE="$REQUESTED_AI_NOVEL_DESKTOP_PROFILE"
else
  export AI_NOVEL_DESKTOP_PROFILE="${AI_NOVEL_DESKTOP_PROFILE:-dev}"
fi

# Dev/Tauri runs from the Vite origin. Keep HTTP API same-origin (/api) unless
# the caller explicitly asks for a direct backend endpoint; Vite proxies /api.
if [[ -n "$REQUESTED_VITE_API_ENDPOINT_SET" ]]; then
  export VITE_API_ENDPOINT="$REQUESTED_VITE_API_ENDPOINT"
else
  export VITE_API_ENDPOINT=""
fi

if [[ -n "$REQUESTED_VITE_PROXY_TARGET_SET" ]]; then
  export VITE_PROXY_TARGET="$REQUESTED_VITE_PROXY_TARGET"
else
  export VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-http://127.0.0.1:${PHOENIX_PORT}}"
fi

if [[ -n "$REQUESTED_VITE_WS_ENDPOINT_SET" ]]; then
  export VITE_WS_ENDPOINT="$REQUESTED_VITE_WS_ENDPOINT"
else
  export VITE_WS_ENDPOINT="${VITE_WS_ENDPOINT:-ws://127.0.0.1:${PHOENIX_PORT}/socket}"
fi

echo "=== AI Novel Studio ==="
echo "  Desktop profile: ${AI_NOVEL_DESKTOP_PROFILE:-<shared>}"

# ---- 浏览器模式 ----

if [[ "$MODE" == "--web" ]]; then
  echo "  浏览器模式 (Phoenix: ${PHOENIX_PORT}, Vite: ${VITE_PORT})"
  cd "$PROJECT_ROOT"
  PHOENIX_PORT="$PHOENIX_PORT" mix phx.server </dev/null &
  PHX_PID=$!
  sleep 3
  cd "$PROJECT_ROOT/frontend"
  pnpm dev </dev/null &
  VITE_PID=$!
  wait "$VITE_PID"
  exit $?
fi

# ---- 桌面端模式 ----

echo "  桌面端模式 (Phoenix: ${PHOENIX_PORT}, Vite: ${VITE_PORT})"

TAURI_CONFIG_OVERRIDE="$(mktemp -t ai-novel-tauri-dev-conf.XXXXXX.json)"
write_tauri_dev_config \
  "$TAURI_CONFIG_OVERRIDE" \
  "$VITE_PORT" \
  "$PHOENIX_PORT" \
  "bash $PROJECT_ROOT/scripts/before-tauri-dev.sh"

# 启动 Phoenix
PHX_URL="http://localhost:${PHOENIX_PORT}"

if curl -s "$PHX_URL/health" 2>/dev/null | grep -q "ok"; then
  echo "[dev] Phoenix already running ($PHX_URL)"
else
  echo "[dev] Starting Phoenix backend on port ${PHOENIX_PORT}..."
  cd "$PROJECT_ROOT"
  PHOENIX_PORT="$PHOENIX_PORT" mix phx.server </dev/null &
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
pnpm tauri dev --config "$TAURI_CONFIG_OVERRIDE" </dev/null &
TAURI_PID=$!
wait "$TAURI_PID"
