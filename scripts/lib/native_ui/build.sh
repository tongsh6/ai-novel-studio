#!/usr/bin/env bash
# 构建外部 macOS 系统 UI 驱动（AX + CGEvent）。产物在 artifacts/tools/（gitignore），
# 供原生 Tauri 验收的外部驱动使用；产品代码不感知本工具。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT_DIR="$ROOT/artifacts/tools"
mkdir -p "$OUT_DIR"
CACHE_DIR="${CLANG_MODULE_CACHE_PATH:-$OUT_DIR/clang-module-cache}"
if [[ ! -x "$OUT_DIR/ax_cua" || "$ROOT/scripts/lib/native_ui/ax_cua.swift" -nt "$OUT_DIR/ax_cua" ]]; then
  CLANG_MODULE_CACHE_PATH="$CACHE_DIR" swiftc -O "$ROOT/scripts/lib/native_ui/ax_cua.swift" -o "$OUT_DIR/ax_cua"
fi
echo "$OUT_DIR/ax_cua"
