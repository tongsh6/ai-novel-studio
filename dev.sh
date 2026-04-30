#!/usr/bin/env bash
set -e

# === AI Novel Studio 开发环境一键启停 ===
# 用法：./dev.sh           # 桌面模式（默认）
#       ./dev.sh --browser # 浏览器模式

ROOT="$(cd "$(dirname "$0")" && pwd)"
PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"

cleanup() {
  echo ""
  echo "正在关闭所有服务..."

  # 杀 Phoenix (beam)
  if [ -n "$BEAM_PID" ]; then
    kill "$BEAM_PID" 2>/dev/null && echo "  ✓ Phoenix 已关闭"
  fi

  # 杀 Vite (node)
  if [ -n "$VITE_PID" ]; then
    kill "$VITE_PID" 2>/dev/null && echo "  ✓ Vite 已关闭"
  fi

  # 杀 Tauri (cargo) 子进程
  if [ -n "$TAURI_PID" ]; then
    kill "$TAURI_PID" 2>/dev/null && echo "  ✓ Tauri 已关闭"
  fi

  # 兜底：杀掉还在占端口的进程
  local leftover
  leftover=$(lsof -ti :"$PHOENIX_PORT" 2>/dev/null)
  [ -n "$leftover" ] && kill "$leftover" 2>/dev/null

  leftover=$(lsof -ti :"$VITE_PORT" 2>/dev/null)
  [ -n "$leftover" ] && kill "$leftover" 2>/dev/null

  echo "所有服务已关闭。"
  exit 0
}

# 确保退出时清理
trap cleanup INT TERM

# Step 0: 检查端口占用，杀掉旧进程
echo "检查端口占用..."
for port in "$PHOENIX_PORT" "$VITE_PORT"; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  端口 $port 被 PID $pid 占用，正在释放..."
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# Step 1: 启动 Phoenix 后端
echo "启动 Phoenix (端口 $PHOENIX_PORT)..."
cd "$ROOT"
mix phx.server &
BEAM_PID=$!
echo "  PID: $BEAM_PID"

# Step 2: 启动 Vite 前端 (带 Tauri 可选)
cd "$ROOT/frontend"

if [ "$1" = "--browser" ]; then
  echo "启动 Vite 开发服务器 (端口 $VITE_PORT)..."
  pnpm dev &
  VITE_PID=$!
else
  echo "启动 Tauri 桌面窗口..."
  pnpm tauri dev &
  VITE_PID=$!
  TAURI_PID=$!
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AI Novel Studio 开发环境已启动"
echo "  Phoenix : http://localhost:$PHOENIX_PORT"
echo "  Vite    : http://localhost:$VITE_PORT"

if [ "$1" != "--browser" ]; then
  echo "  Tauri   : 桌面窗口"
fi

echo ""
echo "  Ctrl+C 一键关闭所有服务"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 等待任意子进程退出
wait
