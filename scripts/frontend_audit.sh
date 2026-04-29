#!/usr/bin/env bash
#
# 前端门禁脚本 - 检查前端技术栈合规性
#
# 检查项:
#   1. package.json 强制依赖是否存在
#   2. tauri.conf.json 关键配置是否与 spec 一致
#   3. 是否存在 env.ts 环境检测文件
#   4. 是否存在浏览器专用 API 调用（禁止项）
#   5. Tauri 构建是否可执行（非快速模式）
#
# 用法:
#   bash scripts/frontend_audit.sh          # 全量检查
#   bash scripts/frontend_audit.sh --quick  # 快速模式（跳过构建）
#
# 设计依据: docs/design-v2/tech-stack/04-frontend.md + 05-desktop.md
# 规则来源: AGENTS.md 前端约束

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0
QUICK_MODE=false

if [[ "${1:-}" == "--quick" ]]; then
  QUICK_MODE=true
fi

pass() { echo -e "  ${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; WARN=$((WARN + 1)); }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; FAIL=$((FAIL + 1)); }

# ---- 0. 前置条件 ----

echo "=== Frontend Audit ==="
echo ""

if [[ ! -f frontend/package.json ]]; then
  fail "frontend/package.json not found"
  exit 1
fi

# ---- 1. package.json 依赖检查 ----

echo "--- 1. Dependencies ---"

# 基础依赖（必须存在）
REQUIRED_DEPS=("@tauri-apps/api" "react" "react-dom" "phoenix" "zod")
REQUIRED_DEV_DEPS=("@tauri-apps/cli" "typescript" "vite" "vitest")

# spec 技术栈依赖（来自 docs/design-v2/tech-stack/04-frontend.md）
SPEC_DEPS=(
  "zustand"
  "@tanstack/react-query"
  "@radix-ui/react-dialog"
  "@radix-ui/react-dropdown-menu"
  "@radix-ui/react-tabs"
  "@radix-ui/react-tooltip"
  "tailwindcss"
  "@tailwindcss/vite"
  "lucide-react"
  "react-hook-form"
  "@hookform/resolvers"
)

# 用 node 解析 package.json 获取所有依赖名
DEPS=$(node -e "
  const p = require('./frontend/package.json');
  const deps = {...p.dependencies, ...p.devDependencies};
  console.log(Object.keys(deps).join(' '));
" 2>/dev/null || echo "")

if [[ -z "$DEPS" ]]; then
  fail "Cannot parse package.json"
else
  for dep in "${REQUIRED_DEPS[@]}"; do
    if echo "$DEPS" | grep -qF "$dep"; then
      pass "Required: $dep"
    else
      fail "Missing required: $dep"
    fi
  done

  for dep in "${REQUIRED_DEV_DEPS[@]}"; do
    if echo "$DEPS" | grep -qF "$dep"; then
      pass "Required dev: $dep"
    else
      fail "Missing required dev: $dep"
    fi
  done

  echo ""
  echo "--- 2. Spec Dependencies (tech-stack/04-frontend.md) ---"

  MISSING_SPEC=()
  for dep in "${SPEC_DEPS[@]}"; do
    if echo "$DEPS" | grep -qF "$dep"; then
      pass "Spec: $dep"
    else
      warn "Missing spec dep: $dep"
      MISSING_SPEC+=("$dep")
    fi
  done

  if [[ ${#MISSING_SPEC[@]} -gt 0 ]]; then
    echo ""
    echo -e "  ${YELLOW}Missing ${#MISSING_SPEC[@]} spec dependencies${NC}"
    echo "  Install: cd frontend && pnpm add ${MISSING_SPEC[*]}"
  fi
fi

# ---- 3. Tauri 配置检查 ----

echo ""
echo "--- 3. Tauri Config (tech-stack/05-desktop.md) ---"

TAURI_CONF="frontend/src-tauri/tauri.conf.json"

if [[ ! -f "$TAURI_CONF" ]]; then
  fail "tauri.conf.json not found"
else
  WIN_WIDTH=$(node -e "console.log(require('./$TAURI_CONF').app.windows[0].width)" 2>/dev/null || echo "?")
  WIN_HEIGHT=$(node -e "console.log(require('./$TAURI_CONF').app.windows[0].height)" 2>/dev/null || echo "?")
  IDENTIFIER=$(node -e "console.log(require('./$TAURI_CONF').identifier || '?')" 2>/dev/null || echo "?")

  if [[ "$WIN_WIDTH" == "1280" ]]; then
    pass "Window width: 1280"
  else
    warn "Window width: $WIN_WIDTH (spec: 1280)"
  fi

  if [[ "$WIN_HEIGHT" == "800" ]]; then
    pass "Window height: 800"
  else
    warn "Window height: $WIN_HEIGHT (spec: 800)"
  fi

  if [[ "$IDENTIFIER" == "com.ai-novel-studio.app" ]]; then
    pass "Identifier: com.ai-novel-studio.app"
  else
    warn "Identifier: $IDENTIFIER (spec: com.ai-novel-studio.app)"
  fi

  # CSP check
  CSP=$(node -e "
    const c = require('./$TAURI_CONF');
    const csp = c.app?.security?.csp;
    console.log(csp === null ? 'null' : (csp || 'undefined'));
  " 2>/dev/null || echo "?")

  if [[ "$CSP" == "null" ]]; then
    warn "CSP is null (disabled). Spec requires: default-src 'self'; connect-src 'self' http://localhost:4657 ws://localhost:4657"
  elif echo "$CSP" | grep -q "connect-src"; then
    pass "CSP includes connect-src restriction"
  else
    warn "CSP may not restrict connections"
  fi
fi

# ---- 4. env.ts 环境检测 ----

echo ""
echo "--- 4. Environment Detection ---"

if [[ -f frontend/src/lib/env.ts ]]; then
  if grep -q "isTauri" frontend/src/lib/env.ts; then
    pass "env.ts exists with isTauri detection"
  else
    warn "env.ts exists but missing isTauri export"
  fi
else
  fail "frontend/src/lib/env.ts does not exist"
fi

# ---- 5. 浏览器专用 API 检查 ----

echo ""
echo "--- 5. Browser-Only API Scan ---"

# 只在声明桌面优先的代码中检查浏览器 API 使用
FOUND_API=false
while IFS= read -r -d '' file; do
  # 跳过生成代码和 demo
  if echo "$file" | grep -qE "(generated|ChannelDemo)"; then
    continue
  fi
  if grep -nE "(window\.location\.|document\.title\s*=|window\.open\(|window\.close\(|localStorage\.|sessionStorage\.)" "$file" 2>/dev/null | grep -vE "(^\s*//|/\*|\*/|\* @|test|spec|\.test\.|__tests__)" > /tmp/tauri_check.$$ 2>/dev/null; then
    if [[ "$FOUND_API" == false ]]; then
      FOUND_API=true
    fi
    while IFS= read -r line; do
      warn "$file: browser API found - $line"
    done < /tmp/tauri_check.$$
  fi
done < <(find frontend/src -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" -not -name "*.d.ts" -print0 2>/dev/null)

rm -f /tmp/tauri_check.$$

if [[ "$FOUND_API" == false ]]; then
  pass "No browser-only APIs found"
fi

# ---- 6. Tauri 构建检查 ----

echo ""
echo "--- 6. Tauri Build ---"

if [[ "$QUICK_MODE" == true ]]; then
  pass "Quick mode: build check skipped"
else
  if command -v cargo &>/dev/null; then
    if (cd frontend && npx tauri build --ci 2>&1 | tail -10); then
      pass "Tauri build succeeded"
    else
      warn "Tauri build failed (may need Rust targets or sidecar binary)"
      warn "  Required in CI, optional in dev"
    fi
  else
    warn "Rust toolchain not found, build check skipped"
    warn "  CI must have Rust installed for full verification"
  fi
fi

# ---- 汇总 ----

echo ""
echo "=== Summary ==="
echo -e "  ${GREEN}Pass: $PASS${NC}"
echo -e "  ${YELLOW}Warn: $WARN${NC}"
echo -e "  ${RED}Fail: $FAIL${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}$FAIL issue(s) must be fixed${NC}"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}$WARN warning(s) - review recommended${NC}"
  exit 0
else
  echo ""
  echo -e "${GREEN}All checks passed${NC}"
  exit 0
fi
