#!/bin/bash
# 按 umbrella app 检查覆盖率，阈值 60%。
# 用法：MIX_ENV=test bash scripts/check_coverage.sh
set -euo pipefail

MIN_COVERAGE=${MIN_COVERAGE:-60}
FAILED=false

# 运行 umbrella 覆盖率
OUTPUT=$(MIX_ENV=test mix coveralls --umbrella 2>&1) || true

echo "$OUTPUT" | grep "TOTAL" | tail -1

# 按 app 分组统计
for app_dir in apps/*/; do
  app=$(basename "$app_dir")
  # 跳过空壳 app
  lib_count=$(find "$app_dir/lib" -name "*.ex" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$lib_count" -eq 0 ]; then
    echo "  $app: 无 lib 文件，跳过"
    continue
  fi

  # 计算该 app 的覆盖率
  app_prefix="apps/$app/"
  stats=$(echo "$OUTPUT" | grep "^[[:space:]]*[0-9]" | grep "$app_prefix" | awk '{
    split($2, a, "/"); relevant+=a[1]; covered+=a[2]
  } END {
    if (relevant > 0) printf "%.1f%% (%d/%d)", covered/relevant*100, covered, relevant
    else print "N/A"
  }')

  # 简单解析百分比
  pct=$(echo "$stats" | grep -o '[0-9.]\+' | head -1)
  if [ -z "$pct" ] || [ "$pct" = "0.0" ]; then
    echo "  $app: 0.0% — 无覆盖数据或只有类型定义"
    continue
  fi

  if (( $(echo "$pct < $MIN_COVERAGE" | bc -l) )); then
    echo "  ❌ $app: $pct (阈值 $MIN_COVERAGE%)"
    FAILED=true
  else
    echo "  ✅ $app: $pct (阈值 $MIN_COVERAGE%)"
  fi
done

echo "---"
echo "$OUTPUT" | grep "TOTAL" | tail -1

if [ "$FAILED" = true ]; then
  echo "❌ 覆盖率检查未通过"
  exit 1
else
  echo "✅ 覆盖率检查通过"
fi
