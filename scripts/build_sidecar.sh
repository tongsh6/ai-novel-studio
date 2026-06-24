#!/usr/bin/env bash
#
# 构建 Phoenix sidecar 后端（Mix release），并暂存到 Tauri 资源目录，供
# `pnpm tauri build` 打进桌面应用。每个 OS 在各自原生环境上跑此脚本，产出
# 带本平台 ERTS 的自包含 release（不做交叉编译）。
#
# 用法： bash scripts/build_sidecar.sh
# 产出： frontend/src-tauri/resources/sidecar.tar.gz（已 gitignore）
#
# 打包成单个 tarball 而非原始目录：release 含 1700+ 文件且部分二进制是只读
# (0555)，直接作为 Tauri resource 目录会让构建工具拷贝/复写时报权限错、并拖慢
# 资源扫描。tarball 是单文件、保留权限与可执行位，由 Rust 在首启时解包。
#
# 详见 docs/design/tech-stack/05-desktop.md。

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

DEST_DIR="$PROJECT_ROOT/frontend/src-tauri/resources"
ARCHIVE="$DEST_DIR/sidecar.tar.gz"

echo "[sidecar] mix deps.get (MIX_ENV=prod)..."
MIX_ENV=prod mix deps.get --only prod

echo "[sidecar] mix release sidecar (MIX_ENV=prod)..."
MIX_ENV=prod mix release sidecar --overwrite

echo "[sidecar] packing release -> $ARCHIVE"
mkdir -p "$DEST_DIR"
rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" -C "$PROJECT_ROOT/_build/prod/rel/sidecar" .

echo "[sidecar] done: $(du -sh "$ARCHIVE" 2>/dev/null | cut -f1) at $ARCHIVE"
