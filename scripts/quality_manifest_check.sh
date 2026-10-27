#!/usr/bin/env bash
set -euo pipefail

# B41 CP1：质量验收 manifest 门禁。
# YAML 语法/重复键由标准解析器（PyYAML）负责，语义校验在
# scripts/lib/quality/manifest.mjs 单点实现；本脚本只是环境预检 + 入口。
# 不得回退为正则解析；PyYAML 缺失即硬失败。

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[quality-manifest-check] 缺少 python3：本门禁使用标准 YAML 解析器（PyYAML），不允许正则替代。" >&2
  echo "[quality-manifest-check] 安装 Python 3 后执行：python3 -m pip install 'pyyaml==6.0.3'" >&2
  exit 1
fi

if ! python3 -c "import yaml" >/dev/null 2>&1; then
  echo "[quality-manifest-check] 缺少 PyYAML：本门禁使用标准 YAML 解析器（PyYAML 6.0.3），不允许正则替代。" >&2
  echo "[quality-manifest-check] 安装：python3 -m pip install 'pyyaml==6.0.3'" >&2
  exit 1
fi

exec node "$PROJECT_ROOT/scripts/lib/quality/manifest_cli.mjs" validate --root "$PROJECT_ROOT"
