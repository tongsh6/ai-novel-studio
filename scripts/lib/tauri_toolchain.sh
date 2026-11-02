#!/usr/bin/env bash
#
# Tauri 构建工具链定位 helper（只读）。
#
# 用法（只 source，不单独执行）：
#   source scripts/lib/tauri_toolchain.sh
#   tauri_toolchain_resolve_dir "$ORIGINAL_HOME" "${CARGO_HOME:-}"
#   tauri_toolchain_ensure "$ORIGINAL_HOME" "${CARGO_HOME:-}"
#
# 语义：
# - PATH 中 cargo/rustc 同时可用时保持 PATH 不变，已有工具不被替换；
# - 否则按 CARGO_HOME/bin、调用方传入的原始用户 home/.cargo/bin 顺序，
#   取第一个同时含 cargo/rustc 的已安装目录，仅前置到当前进程 PATH，
#   供本次 Tauri 子进程使用；
# - 不读取 HOME（调用方显式传原始 home，避免把隔离测试 HOME 当 Rust 根），
#   不安装/切换工具链，不写 shell 配置，也不改动其他全局 env。

TAURI_TOOLCHAIN_EXISTING_PATH="existing-path"

tauri_toolchain_resolve_dir() {
  local original_home="${1:-}"
  local configured_cargo_home="${2:-}"
  local cargo_path=""
  local rustc_path=""
  local candidate=""
  local missing=""

  cargo_path="$(command -v cargo 2>/dev/null || true)"
  rustc_path="$(command -v rustc 2>/dev/null || true)"
  if [[ -n "$cargo_path" && -n "$rustc_path" ]]; then
    printf '%s\n' "$TAURI_TOOLCHAIN_EXISTING_PATH"
    return 0
  fi

  # 空参数经 ${var:+...} 变成空字符串，避免 bash 3.2 + set -u 的空数组展开错误。
  for candidate in \
    "${configured_cargo_home:+${configured_cargo_home}/bin}" \
    "${original_home:+${original_home}/.cargo/bin}"; do
    if [[ -n "$candidate" && -x "$candidate/cargo" && -x "$candidate/rustc" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [[ -z "$cargo_path" ]]; then
    missing="cargo"
  fi
  if [[ -z "$rustc_path" ]]; then
    missing="${missing:+$missing, }rustc"
  fi
  echo "[tauri-toolchain] 未找到可用的 Rust 工具链（缺少: ${missing}）；已检查现有 PATH、CARGO_HOME/bin、原始用户 home/.cargo/bin" >&2
  return 1
}

tauri_toolchain_ensure() {
  local original_home="${1:-}"
  local configured_cargo_home="${2:-}"
  local resolved=""

  resolved="$(tauri_toolchain_resolve_dir "$original_home" "$configured_cargo_home")" || return 1

  if [[ "$resolved" == "$TAURI_TOOLCHAIN_EXISTING_PATH" ]]; then
    echo "[tauri-toolchain] 使用现有 PATH 工具链: cargo=$(command -v cargo) rustc=$(command -v rustc)" >&2
    return 0
  fi

  case ":$PATH:" in
    *":$resolved:"*) ;;
    *) PATH="$resolved:$PATH" ;;
  esac
  export PATH
  echo "[tauri-toolchain] 使用已安装工具链目录: $resolved" >&2
  return 0
}
