#!/usr/bin/env bash
#
# 设计追溯检查脚本 — 验证 UI 组件是否可追溯到设计文档
#
# 检查项：
#   1. 每个 .tsx 组件文件是否包含设计引用注释
#   2. 引用的设计文档文件是否真实存在
#   3. 引用的原型 screen frame 是否在 .pen 文件中存在
#   4. 输出追溯覆盖率报告
#
# 用法：
#   bash scripts/check_design_trace.sh          # 检查所有组件
#   bash scripts/check_design_trace.sh --json   # JSON 格式输出
#
# 设计依据：docs/design-v2/ui-design/README.md §5（追溯要求）
# 规则来源：AGENTS.md § UI 设计驱动（Design-Driven）

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

COMPONENT_DIR="frontend/src/components"
DESIGN_DIR="docs/design-v2/ui-design"
PEN_FILE="$DESIGN_DIR/novel-studio-v2.pen"
PASS=0
WARN=0
FAIL=0
JSON_OUT=false

if [[ "${1:-}" == "--json" ]]; then
  JSON_OUT=true
fi

# ---- 工具函数 ----

pass() {
  if [[ "$JSON_OUT" == false ]]; then
    echo -e "  ${GREEN}✓${NC} $1"
  fi
  PASS=$((PASS + 1))
}

warn() {
  if [[ "$JSON_OUT" == false ]]; then
    echo -e "  ${YELLOW}⚠${NC} $1"
  fi
  WARN=$((WARN + 1))
}

fail() {
  if [[ "$JSON_OUT" == false ]]; then
    echo -e "  ${RED}✗${NC} $1"
  fi
  FAIL=$((FAIL + 1))
}

# ---- 0. 前置条件 ----

if [[ ! -d "$COMPONENT_DIR" ]]; then
  fail "找不到 $COMPONENT_DIR"
  exit 1
fi

if [[ ! -f "$PEN_FILE" ]]; then
  warn "找不到 $PEN_FILE（原型文件），跳 frame 验证"
  PEN_AVAILABLE=false
else
  PEN_AVAILABLE=true
fi

if [[ "$JSON_OUT" == false ]]; then
  echo "=== 设计追溯检查 ==="
  echo ""
fi

# ---- 1. 扫描组件文件 ----

# 已知的不需要追溯的文件（入口、工具、demo）
SKIP_FILES=(
  "ChannelDemo.tsx"
)

TRACEABLE=0
MISSING_TRACE=()
WITH_TRACE=()
TRACE_DETAILS=()

while IFS= read -r -d '' file; do
  filename=$(basename "$file")
  skip=false
  for skipfile in "${SKIP_FILES[@]}"; do
    if [[ "$filename" == "$skipfile" ]]; then
      skip=true
      break
    fi
  done
  if [[ "$skip" == true ]]; then
    continue
  fi

  TRACEABLE=$((TRACEABLE + 1))

  # 检查是否有设计追溯注释
  HAS_DESIGN_TRACE=false
  HAS_PROTOTYPE_TRACE=false

  if head -30 "$file" | grep -q "Design:"; then
    HAS_DESIGN_TRACE=true
  fi
  if head -30 "$file" | grep -q "Prototype:"; then
    HAS_PROTOTYPE_TRACE=true
  fi

  if [[ "$HAS_DESIGN_TRACE" == false ]]; then
    MISSING_TRACE+=("$file")
    fail "$file: 缺少设计追溯注释"
  elif [[ "$HAS_PROTOTYPE_TRACE" == false ]]; then
    warn "$file: 有 Design 引用但缺少 Prototype 引用"
    WITH_TRACE+=("$file")
  else
    pass "$file: 设计 + 原型追溯完整"
    WITH_TRACE+=("$file")
  fi
done < <(find "$COMPONENT_DIR" -type f -name "*.tsx" -not -name "*.test.*" -print0 2>/dev/null)

# ---- 2. 验证引用有效性 ----

if [[ "$JSON_OUT" == false ]]; then
  echo ""
  echo "--- 引用有效性验证 ---"
fi

for file in "${WITH_TRACE[@]}"; do
  # 提取 Design 引用
  DESIGN_REF=$(head -30 "$file" | grep "Design:" | head -1 | sed 's/.*Design:\s*//' | sed 's/ \*//' | xargs 2>/dev/null || echo "")
  PROTOTYPE_REF=$(head -30 "$file" | grep "Prototype:" | head -1 | sed 's/.*Prototype:\s*//' | sed 's/ \*//' | xargs 2>/dev/null || echo "")

  # 验证设计文档引用
  if [[ -n "$DESIGN_REF" ]]; then
    # 提取文件路径（例如 docs/design-v2/ui-design/42-card-system.md）
    DOC_PATH=$(echo "$DESIGN_REF" | grep -oE 'docs/design-v2/[^ ]+\.md' || echo "")
    if [[ -n "$DOC_PATH" ]]; then
      if [[ -f "$DOC_PATH" ]]; then
        pass "$file: 引用 $DOC_PATH 有效"
      else
        warn "$file: 引用 $DOC_PATH 不存在"
      fi
    fi
  fi

  # 验证原型 frame 引用
  if [[ -n "$PROTOTYPE_REF" ]]; then
    FRAME_ID=$(echo "$PROTOTYPE_REF" | grep -oE '\([A-Za-z0-9]+\)' | tr -d '()' || echo "")
    if [[ -n "$FRAME_ID" ]] && [[ "$PEN_AVAILABLE" == true ]]; then
      if grep -q "\"id\": \"$FRAME_ID\"" "$PEN_FILE" 2>/dev/null; then
        pass "$file: 原型 frame $FRAME_ID 在 .pen 文件中存在"
      else
        warn "$file: 原型 frame $FRAME_ID 在 .pen 文件中未找到"
      fi
    fi
  fi
done

# ---- 3. 覆盖率统计 ----

if [[ "$JSON_OUT" == false ]]; then
  echo ""
  echo "--- 覆盖率 ---"
fi

if [[ $TRACEABLE -gt 0 ]]; then
  COVERAGE=$(( (TRACEABLE - ${#MISSING_TRACE[@]}) * 100 / TRACEABLE ))
  if [[ "$JSON_OUT" == false ]]; then
    echo "  总组件: $TRACEABLE"
    echo "  有追溯: $((TRACEABLE - ${#MISSING_TRACE[@]}))"
    echo "  缺追溯: ${#MISSING_TRACE[@]}"
    echo "  覆盖率: ${COVERAGE}%"
  fi
else
  COVERAGE=100
  if [[ "$JSON_OUT" == false ]]; then
    echo "  未发现需追溯的组件文件"
  fi
fi

# ---- 4. 缺失追溯的修复提示 ----

if [[ ${#MISSING_TRACE[@]} -gt 0 ]] && [[ "$JSON_OUT" == false ]]; then
  echo ""
  echo "--- 修复提示 ---"
  echo "  以下文件缺少设计追溯注释，请在文件头部添加："
  echo ""
  for file in "${MISSING_TRACE[@]}"; do
    echo "  文件: $file"
    echo "  添加格式:"
    echo "    // Design: docs/design-v2/ui-design/<文档>.md §<章节>"
    echo "    // Prototype: novel-studio-v2.pen → <screen-frame-name> (<NODE_ID>)"
    echo ""
  done
  echo "  参考：docs/design-v2/ui-design/traceability/screen-to-doc-map.md"
  echo "  参考：docs/design-v2/ui-design/README.md §5（追溯要求）"
fi

# ---- 汇总 ----

if [[ "$JSON_OUT" == false ]]; then
  echo ""
  echo "=== 检查结果 ==="
  echo -e "  ${GREEN}通过: $PASS${NC}"
  echo -e "  ${YELLOW}警告: $WARN${NC}"
  echo -e "  ${RED}失败: $FAIL${NC}"
fi

if [[ "$JSON_OUT" == true ]]; then
  # 输出 JSON 格式（方便 CI 集成）
  python3 -c "
import json
print(json.dumps({
  'total': $TRACEABLE,
  'with_trace': $((TRACEABLE - ${#MISSING_TRACE[@]})),
  'missing_trace': ${#MISSING_TRACE[@]},
  'coverage_pct': $COVERAGE,
  'pass': $PASS,
  'warn': $WARN,
  'fail': $FAIL,
  'missing_files': $(python3 -c "import json; print(json.dumps($(printf '%s\n' "${MISSING_TRACE[@]}" | python3 -c "import sys; print(json.dumps([l.strip() for l in sys.stdin.readlines() if l.strip()]))" 2>/dev/null || echo '[]')))" 2>/dev/null || echo "[]")
}, indent=2))
"
fi

if [[ $FAIL -gt 0 ]]; then
  exit 1
else
  exit 0
fi
