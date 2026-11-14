#!/usr/bin/env bash
# 统一 Node 测试入口：为各测试族建立 owned run scope，避免裸跑造成的资源无归属。
#
# 只做两件事：为普通测试族委托 `novel_node_test_scope`（同一次 run 的 TMPDIR/scratch
# 贯穿所有文件）；作用域自身测试用 `--self` 直接自持 scope，验证 owned/借用/清理语义。
# 不新建测试框架、发现器或结果台账。
#
# 用法：
#   bash scripts/node_test.sh <files...>
#   bash scripts/node_test.sh --self <files...>
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/test_env.sh"

if [[ "${1:-}" == "--self" ]]; then
  shift
  if [[ $# -eq 0 ]]; then
    echo "用法: node_test.sh --self <files...>" >&2
    exit 64
  fi
  exec node --test "$@"
fi

if [[ $# -eq 0 ]]; then
  echo "用法: node_test.sh <files...>" >&2
  exit 64
fi

novel_node_test_scope -- node --test "$@"
