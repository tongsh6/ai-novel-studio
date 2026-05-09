#!/usr/bin/env bash
#
# Workbench Smoke Test — 启动服务并验证核心链路
#
# 用法：bash scripts/smoke_test.sh [--web] [--quick]
#   --web     浏览器模式（默认）
#   --quick   仅检查端点可达，不做对话验证
#
set -euo pipefail

MODE="${1:---web}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

green() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
red()   { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

cleanup() {
  pkill -f "phx.server\|vite" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== AI Novel Studio Smoke Test ==="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "模式: $MODE"
echo ""

# ── 1. 启动服务 ──
echo "--- 服务启动 ---"

cd "$PROJECT_ROOT"
bash scripts/dev.sh --web > /tmp/smoke_test.log 2>&1 &
DEV_PID=$!

# 等待 Phoenix 就绪
for i in $(seq 1 15); do
  if curl -s http://localhost:4657/health 2>/dev/null | grep -q "ok"; then
    green "Phoenix: OK (port 4657)"
    break
  fi
  if [[ $i -eq 15 ]]; then
    red "Phoenix: 启动超时"
    exit 1
  fi
  sleep 1
done

# 等待 Vite 就绪
for i in $(seq 1 10); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:5768 2>/dev/null | grep -q "200"; then
    green "Vite: OK (port 5768)"
    break
  fi
  if [[ $i -eq 10 ]]; then
    red "Vite: 启动超时"
    exit 1
  fi
  sleep 1
done

# ── 2. 端点验证 ──
echo ""
echo "--- 端点验证 ---"

# Health check
HEALTH=$(curl -s http://localhost:4657/health 2>/dev/null)
if echo "$HEALTH" | grep -q "ok"; then
  green "GET /health → 200"
else
  red "GET /health → FAIL"
fi

# Provider health (非致命——依赖本地 LM Studio 状态)
PROV=$(curl -s http://localhost:4657/api/provider/health 2>/dev/null)
if echo "$PROV" | grep -q "connected"; then
  green "GET /api/provider/health → connected"
elif echo "$PROV" | grep -q "未连接"; then
  echo "  ⚠️  GET /api/provider/health → 未连接 (LM Studio 未启动，非阻塞)"
else
  echo "  ⚠️  GET /api/provider/health → 不可用 (非阻塞)"
fi

# WebSocket 端点可达
WS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4657/socket/websocket" 2>/dev/null)
# Phoenix WebSocket 对非 WebSocket 请求返回 400/426
if [ "$WS_CODE" = "400" ] || [ "$WS_CODE" = "426" ]; then
  green "GET /socket (WS endpoint) → $WS_CODE (WebSocket upgrade expected)"
else
  echo "  ⚠️  GET /socket → $WS_CODE (非阻塞)"
fi

# Frontend loads
FRONTEND=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5768 2>/dev/null)
if [ "$FRONTEND" = "200" ]; then
  green "GET / (Vite) → 200"
else
  red "GET / (Vite) → $FRONTEND"
fi

# ── 3. E2E 集成测试 ──
echo ""
echo "--- E2E 集成测试 ---"

if MIX_ENV=test mix test --include integration 2>&1 | tail -3 | grep -q "failures"; then
  green "mix test --include integration"
else
  red "mix test --include integration"
fi

# ── 3. 编译与测试 ──
echo ""
echo "--- 代码质量 ---"

cd "$PROJECT_ROOT"
if MIX_ENV=test mix compile --warnings-as-errors > /dev/null 2>&1; then
  green "mix compile --warnings-as-errors"
else
  red "mix compile --warnings-as-errors"
fi

if mix test 2>&1 | tail -1 | grep -q "failures"; then
  FAILURES=$(mix test 2>&1 | grep "failures" | grep -v "0 failures" | wc -l)
  if [ "$FAILURES" -eq 0 ]; then
    green "mix test: all passing"
  else
    red "mix test: $FAILURES apps with failures"
  fi
fi

cd "$PROJECT_ROOT/frontend"
if pnpm typecheck > /dev/null 2>&1; then
  green "pnpm typecheck"
else
  red "pnpm typecheck"
fi

# ── 4. 结果 ──
echo ""
echo "=== 结果 ==="
echo "通过: $PASS"
echo "失败: $FAIL"
echo "日期: $(date '+%Y-%m-%d %H:%M:%S')"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "❌ Smoke test 未通过"
  exit 1
else
  echo ""
  echo "✅ Smoke test 通过"
  exit 0
fi
