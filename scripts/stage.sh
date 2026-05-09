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

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="tauri"
SKIP_BUILD=false
PHX_PID=""
VITE_PID=""

cleanup() {
  echo ""
  echo "[stage] Shutting down..."
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  if [[ -n "$PHX_PID" ]]; then
    kill "$PHX_PID" 2>/dev/null || true
    wait "$PHX_PID" 2>/dev/null || true
  fi
  echo "[stage] Stopped."
}
trap cleanup EXIT INT TERM

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

set -a
source "$PROJECT_ROOT/frontend/.env" 2>/dev/null || true
set +a

# Stage 环境固定参数
export MIX_ENV=prod
export PHOENIX_PORT="${PHOENIX_PORT:-4658}"
export VITE_DEV_PORT="${VITE_DEV_PORT:-5769}"
export NOVEL_PROVIDER_DEFAULT="${NOVEL_PROVIDER_DEFAULT:-lmstudio}"

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
mix phx.server &
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
  cp "$TAURI_CONF" "$TAURI_CONF.stage.bak"
  trap 'mv "$TAURI_CONF.stage.bak" "$TAURI_CONF" 2>/dev/null; cleanup' EXIT INT TERM

  sed -i '' \
    -e "s|\"devUrl\": \"http://localhost:[0-9]*\"|\"devUrl\": \"http://localhost:${VITE_DEV_PORT}\"|" \
    -e "s|\(connect-src 'self' \)http://localhost:[0-9]*\( ws://localhost:\)[0-9]*|\1http://localhost:${PHOENIX_PORT}\2${PHOENIX_PORT}|" \
    "$TAURI_CONF"

  # Tauri 的 beforeDevCommand 会自动启动 Vite dev server
  cd "$PROJECT_ROOT/frontend"
  exec pnpm tauri dev
fi

# ---- 浏览器模式：Vite Preview ----

echo "[stage] Starting Vite preview on port ${VITE_DEV_PORT}..."
cd "$PROJECT_ROOT/frontend"
pnpm preview --port "$VITE_DEV_PORT" --strictPort &
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

wait
