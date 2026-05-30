#!/usr/bin/env bash
#
# AI Novel Studio — Stage 预发布环境一键启动
#
# 用法：
#   bash scripts/stage.sh           # 桌面端（Tauri + Phoenix prod）— 默认
#   bash scripts/stage.sh --web     # 浏览器模式（Vite preview + Phoenix prod）
#   bash scripts/stage.sh --no-build # 跳过编译，直接启动
#
# Stage 模式特征：
#   - MIX_ENV=prod，无 debug 工具、无 hot reload（后端）
#   - 桌面端：Phoenix (prod) + Vite dev server + Tauri 原生窗口
#   - 浏览器：Phoenix (prod) + Vite preview（构建产物，无 HMR）
#   - 与 dev 端口不同，可同时运行
#   - 默认使用 Anthropic provider（可通过 NOVEL_PROVIDER_DEFAULT=lmstudio 切换）
#

set -euo pipefail
# 启用 job control：每个后台 `&` 作业自成进程组，cleanup 时可整组回收，
# 即使用户直接关闭 Tauri 窗口（包装进程先退）也不会留下孤儿 vite/app。
set -m

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"
MODE="tauri"
SKIP_BUILD=false
PHX_PID=""
VITE_PID=""
TAURI_PID=""
TAURI_CONF=""
TAURI_CONF_BACKUP=""
CLEANED_UP=false

terminate_pid() {
  local name="$1"
  local pid="$2"

  [[ -n "$pid" ]] || return 0
  echo "[stage] Stopping ${name} (pid ${pid})..."
  # 不只杀包装进程，连同其进程树/进程组一并回收（孤儿 vite/app 也在内）。
  kill_process_tree "$pid"
  wait "$pid" 2>/dev/null || true
}

restore_tauri_conf() {
  if [[ -n "$TAURI_CONF_BACKUP" && -f "$TAURI_CONF_BACKUP" && -n "$TAURI_CONF" ]]; then
    cp "$TAURI_CONF_BACKUP" "$TAURI_CONF" 2>/dev/null || true
    rm -f "$TAURI_CONF_BACKUP" 2>/dev/null || true
  fi
}

sync_tauri_conf() {
  local vite_port="$1"
  local phoenix_port="$2"

  TAURI_DEV_URL="http://127.0.0.1:${vite_port}" \
  TAURI_CONNECT_SRC="http://localhost:${phoenix_port} http://127.0.0.1:${phoenix_port} ws://localhost:${phoenix_port} ws://127.0.0.1:${phoenix_port}" \
    perl -0pi -e 's#"devUrl":\s*"http://(?:localhost|127\.0\.0\.1):[0-9]+"#"devUrl": "$ENV{TAURI_DEV_URL}"#g; s#connect-src '\''self'\''[^"]*"#connect-src '\''self'\'' $ENV{TAURI_CONNECT_SRC}"#g' "$TAURI_CONF"
}

cleanup() {
  if [[ "$CLEANED_UP" == "true" ]]; then
    return
  fi
  CLEANED_UP=true

  echo ""
  echo "[stage] Shutting down..."
  terminate_pid "Tauri" "$TAURI_PID"
  terminate_pid "Vite" "$VITE_PID"
  terminate_pid "Phoenix" "$PHX_PID"
  restore_tauri_conf
  echo "[stage] Stopped."
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

# ---- 解析参数 ----

for arg in "$@"; do
  case "$arg" in
    --web) MODE="web" ;;
    --no-build) SKIP_BUILD=true ;;
    --help|-h)
      echo "Usage: bash scripts/stage.sh [--web] [--no-build]"
      echo ""
      echo "  (none)     桌面端模式：Phoenix (prod) + Tauri 原生窗口（默认）"
      echo "  --web      浏览器模式：Phoenix (prod) + Vite preview"
      echo "  --no-build 跳过编译，直接启动"
      exit 0
      ;;
    *)
      echo "[stage] Unknown option: $arg"
      exit 1
      ;;
  esac
done

# ---- 加载端口配置 ----

REQUESTED_PHOENIX_PORT="${PHOENIX_PORT:-}"
REQUESTED_VITE_DEV_PORT="${VITE_DEV_PORT:-}"
REQUESTED_VITE_API_ENDPOINT="${VITE_API_ENDPOINT:-}"
REQUESTED_VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-}"
REQUESTED_VITE_WS_ENDPOINT="${VITE_WS_ENDPOINT:-}"
REQUESTED_NOVEL_PROVIDER_DEFAULT="${NOVEL_PROVIDER_DEFAULT:-}"

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

# Stage 环境固定参数
export MIX_ENV=prod
export PHOENIX_PORT="${REQUESTED_PHOENIX_PORT:-4658}"
export VITE_DEV_PORT="${REQUESTED_VITE_DEV_PORT:-5769}"
export VITE_API_ENDPOINT="${REQUESTED_VITE_API_ENDPOINT:-}"
export VITE_PROXY_TARGET="${REQUESTED_VITE_PROXY_TARGET:-http://127.0.0.1:${PHOENIX_PORT}}"
export VITE_WS_ENDPOINT="${REQUESTED_VITE_WS_ENDPOINT:-ws://127.0.0.1:${PHOENIX_PORT}/socket}"
export NOVEL_PROVIDER_DEFAULT="${REQUESTED_NOVEL_PROVIDER_DEFAULT:-lmstudio}"

PHX_URL="http://localhost:${PHOENIX_PORT}"

echo "=== AI Novel Studio [STAGE] ==="
echo "  Mode:      ${MODE}"
echo "  MIX_ENV:   ${MIX_ENV}"
echo "  Provider:  ${NOVEL_PROVIDER_DEFAULT}"
echo "  Phoenix:   ${PHX_URL}"
if [[ "$MODE" == "tauri" ]]; then
  echo "  Vite:      http://localhost:${VITE_DEV_PORT} (dev server → Tauri)"
else
  echo "  Vite:      http://localhost:${VITE_DEV_PORT} (preview)"
fi
echo ""

# ---- Provider 预检 ----

if [[ "$NOVEL_PROVIDER_DEFAULT" == "lmstudio" ]]; then
  if curl -s http://localhost:1234/v1/models > /dev/null 2>&1; then
    echo "[stage] LM Studio 已就绪"
  else
    echo "[stage] WARNING: LM Studio 未运行（http://localhost:1234）"
    echo "[stage] 启动 LM Studio 或设置 NOVEL_PROVIDER_DEFAULT=anthropic NOVEL_ANTHROPIC_API_KEY=..."
    echo ""
  fi
elif [[ "$NOVEL_PROVIDER_DEFAULT" == "anthropic" ]]; then
  if [[ -z "${NOVEL_ANTHROPIC_API_KEY:-}" ]]; then
    echo "[stage] WARNING: NOVEL_ANTHROPIC_API_KEY 未设置"
    echo "[stage] 设置环境变量或切换到 LM Studio：NOVEL_PROVIDER_DEFAULT=lmstudio"
    echo ""
  fi
fi

# ---- 编译 ----

if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "[stage] Compiling backend (MIX_ENV=prod)..."
  cd "$PROJECT_ROOT"
  mix compile --warnings-as-errors
  echo "[stage] Backend compiled."

  echo "[stage] Building frontend..."
  cd "$PROJECT_ROOT/frontend"
  pnpm build
  echo "[stage] Frontend built."
  echo ""
fi

# ---- 前置检查 ----

cd "$PROJECT_ROOT"

if ! mix compile --no-deps-check 2>/dev/null; then
  echo "[stage] ERROR: Backend not compiled. Remove --no-build or run mix compile first."
  exit 1
fi

# ---- 数据库迁移 ----

echo "[stage] Running migrations (MIX_ENV=prod)..."
mix ecto.migrate
echo "[stage] Migrations complete."
echo ""

cd "$PROJECT_ROOT/frontend"

if [[ ! -d dist ]] || [[ ! -f dist/index.html ]]; then
  echo "[stage] ERROR: Frontend not built (dist/ missing). Remove --no-build or run pnpm build first."
  exit 1
fi

cd "$PROJECT_ROOT"

# ---- 启动 Phoenix (prod) ----

echo "[stage] Starting Phoenix (prod) on port ${PHOENIX_PORT}..."
# </dev/null：job control 下后台进程探测 TTY 会触发 SIGTTIN 停摆，重定向 stdin 规避。
mix phx.server </dev/null &
PHX_PID=$!

for i in $(seq 1 20); do
  if curl -s "$PHX_URL/health" 2>/dev/null | grep -q "ok"; then
    echo "[stage] Phoenix ready (${PHX_URL})"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo "[stage] ERROR: Phoenix failed to start"
    exit 1
  fi
  sleep 1
done

# ---- Provider 健康检查 ----

PROVIDER_HEALTH=$(curl -s "$PHX_URL/api/provider/health" 2>/dev/null || echo "{}")
echo "[stage] Provider health: $(echo "$PROVIDER_HEALTH" | grep -o '"status":"[^"]*"' || echo 'unreachable')"
echo ""

# ---- 桌面端：Tauri ----

if [[ "$MODE" == "tauri" ]]; then
  echo "[stage] Starting Tauri desktop (Phoenix: ${PHOENIX_PORT}, Vite: ${VITE_DEV_PORT})..."

  TAURI_CONF="$PROJECT_ROOT/frontend/src-tauri/tauri.conf.json"
  TAURI_CONF_BACKUP="$(mktemp -t ai-novel-tauri-conf.XXXXXX)"
  cp "$TAURI_CONF" "$TAURI_CONF_BACKUP"

  sync_tauri_conf "$VITE_DEV_PORT" "$PHOENIX_PORT"

  # Tauri 的 beforeDevCommand 会自动启动 Vite dev server
  cd "$PROJECT_ROOT/frontend"
  pnpm tauri dev </dev/null &
  TAURI_PID=$!
  echo "[stage] Tauri PID: ${TAURI_PID}"

  if wait "$TAURI_PID"; then
    exit 0
  else
    TAURI_STATUS=$?
    exit "$TAURI_STATUS"
  fi
fi

# ---- 浏览器模式：Vite Preview ----

echo "[stage] Starting Vite preview on port ${VITE_DEV_PORT}..."
cd "$PROJECT_ROOT/frontend"
pnpm preview --port "$VITE_DEV_PORT" --strictPort </dev/null &
VITE_PID=$!

sleep 2
if ! kill -0 "$VITE_PID" 2>/dev/null; then
  echo "[stage] ERROR: Vite preview failed to start"
  exit 1
fi

VITE_PREVIEW_URL="http://localhost:${VITE_DEV_PORT}"
echo "[stage] Vite preview ready (${VITE_PREVIEW_URL})"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stage 环境已就绪"
echo "  Web 地址：${VITE_PREVIEW_URL}"
echo "  API 地址：${PHX_URL}"
echo ""
echo "  按 Ctrl+C 停止所有服务"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wait "$VITE_PID"
