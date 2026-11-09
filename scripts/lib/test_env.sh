#!/usr/bin/env bash
#
# 测试/验收入口共用的运行时前置 helper（只 source，不单独执行）。
#
# 目的：横向（ai_static_scan / mix 类不变量 / CI）与纵向（slice_verify /
# tauri_slice_verify / native_*_batch / dogfood）入口共享同一套前置语义，
# 不再各自实现「建库并迁移 / 等端口就绪 / 检查端口占用」：
#   - 测试数据库目录与迁移：novel_test_db_dir / novel_test_db_prepare；
#   - HTTP 就绪等待：novel_wait_for_http；
#   - 端口占用预检：novel_ports_precheck。
#
# 约定：
# - 只 source，不单独执行；不改变调用方的 `set -euo pipefail` 状态。
# - 失败一律 fail-closed：返回非 0，由调用方决定是否退出（不打印 PASS 假象）。
# - 日志统一走 stderr 前缀 `[test-env]`；stdout 只用于「目录」等返回值。
# - bash 3.2 兼容（macOS 自带 bash），不使用关联数组 / mapfile / local -n。
# - 不写产品代码、不启动 GUI、不加载模型；只做本地测试环境前置。

TEST_ENV_LOG_PREFIX="${TEST_ENV_LOG_PREFIX:-[test-env]}"

test_env_log() {
  printf '%s %s\n' "$TEST_ENV_LOG_PREFIX" "$*" >&2
}

# 项目根目录（本 helper 位于 <root>/scripts/lib/ 下）。
novel_project_root() {
  local helper_dir
  helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || return 1
  (cd "$helper_dir/../.." && pwd)
}

# 解析并创建测试数据库目录，导出 NOVEL_TEST_DB_DIR。
# 用法：novel_test_db_dir [--dir DIR]
# - 显式 --dir 优先；否则沿用调用方已导出的 NOVEL_TEST_DB_DIR；
# - 都未提供时创建一次性 mktemp 目录（默认入口可直接复跑）；
# - stdout 输出最终目录（绝对路径），日志走 stderr。
novel_test_db_dir() {
  local dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir)
        dir="${2:-}"
        shift 2
        ;;
      *)
        test_env_log "novel_test_db_dir 未知参数: $1"
        return 64
        ;;
    esac
  done

  if [[ -z "$dir" ]]; then
    dir="${NOVEL_TEST_DB_DIR:-}"
  fi
  if [[ -z "$dir" ]]; then
    dir="$(mktemp -d "${TMPDIR:-/tmp}/ai-novel-test-db.XXXXXX")" || {
      test_env_log "无法创建临时测试数据库目录"
      return 1
    }
  fi

  if ! mkdir -p "$dir"; then
    test_env_log "无法创建测试数据库目录: $dir"
    return 1
  fi
  dir="$(cd "$dir" && pwd)" || {
    test_env_log "无法解析测试数据库目录: $dir"
    return 1
  }

  export NOVEL_TEST_DB_DIR="$dir"
  printf '%s\n' "$dir"
}

# 统一测试库前置：目录 + 可选重置 + create + migrate。
# 用法：novel_test_db_prepare [--dir DIR] [--reset] [--root ROOT] [--quiet]
# - create 失败不视为致命（库已存在是常态），migrate 失败才是失败；
# - --reset 先 drop 再 create（dogfood/tauri 原生批次需要干净库）；
# - 成功后导出 NOVEL_TEST_DB_DIR 并返回 0。
novel_test_db_prepare() {
  local dir=""
  local reset=0
  local quiet=0
  local root=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir)
        dir="${2:-}"
        shift 2
        ;;
      --root)
        root="${2:-}"
        shift 2
        ;;
      --reset)
        reset=1
        shift
        ;;
      --quiet)
        quiet=1
        shift
        ;;
      *)
        test_env_log "novel_test_db_prepare 未知参数: $1"
        return 64
        ;;
    esac
  done

  if [[ -z "$root" ]]; then
    root="$(novel_project_root)" || return 1
  fi

  # 注意：不要放进 `$(...)`——命令替换是子 shell，export 不会回到调用方。
  # 直接调用让 NOVEL_TEST_DB_DIR 在当前 shell 生效；目录本身由 stdout 丢弃。
  if [[ -n "$dir" ]]; then
    novel_test_db_dir --dir "$dir" >/dev/null || return 1
  else
    novel_test_db_dir >/dev/null || return 1
  fi
  local db_dir="${NOVEL_TEST_DB_DIR:-}"
  if [[ -z "$db_dir" ]]; then
    test_env_log "测试库目录未导出"
    return 1
  fi

  if (
    cd "$root" || exit 1
    if [[ "$reset" == "1" ]]; then
      MIX_ENV=test mix ecto.drop --quiet >/dev/null 2>&1 || true
    fi
    MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
    MIX_ENV=test mix ecto.migrate --quiet >/dev/null 2>&1
  ); then
    if [[ "$quiet" != "1" ]]; then
      test_env_log "测试库已就绪: $db_dir"
    fi
    return 0
  fi

  test_env_log "测试库迁移失败: ${db_dir}（root=${root}）"
  return 1
}

# 等待 HTTP 端点就绪。
# 用法：novel_wait_for_http URL LABEL [MAX_SECONDS]
# 成功返回 0；超时返回 1 并打印最后探测地址（不重试、不伪造 ready）。
novel_wait_for_http() {
  local url="$1"
  local label="${2:-HTTP}"
  local max="${3:-30}"
  local i=0

  while [[ "$i" -lt "$max" ]]; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      test_env_log "$label 就绪: $url"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done

  test_env_log "$label 未就绪（${max}s）: $url"
  return 1
}

# 列出监听指定 TCP 端口的进程 PID（每行一个，去重）。
novel_port_listener_pids() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

# 端口占用预检：任一端口被占用即返回非 0，并打印占用进程。
# 用法：novel_ports_precheck PORT [PORT...]
novel_ports_precheck() {
  if [[ $# -eq 0 ]]; then
    test_env_log "novel_ports_precheck 需要至少一个端口"
    return 64
  fi

  local port=""
  local pids=""
  local pid=""
  local occupied=0
  for port in "$@"; do
    pids="$(novel_port_listener_pids "$port")"
    if [[ -z "$pids" ]]; then
      continue
    fi
    occupied=1
    test_env_log "端口 $port 已被占用:"
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      ps -o pid=,ppid=,command= -p "$pid" 2>/dev/null | sed "s/^/${TEST_ENV_LOG_PREFIX}   /" >&2 || true
    done <<< "$pids"
  done

  if [[ "$occupied" == "1" ]]; then
    return 1
  fi
  return 0
}
