#!/usr/bin/env bash
#
# 共享进程树清理工具（被各启动/验证脚本 source）。
#
# 背景：pnpm / mix / pnpm tauri dev 等命令会再 fork 出真正的工作进程
# （vite 的 node、beam.smp、cargo、target/debug/app）。旧的清理逻辑只
# `kill` 直接子进程（pnpm/mix 包装进程），包装进程一死，真实实例被
# reparent 到 init（PPID=1）后常驻不退，导致端口和窗口越积越多。
#
# 这里提供按“进程树 + 进程组”双重回收的函数：
#   1. 递归收集子孙并逐个 TERM/KILL（清理脚本主动调用、进程树完整时有效）；
#   2. 若目标作业自成进程组（启动脚本启用 `set -m` 后每个 `&` 作业即独立组），
#      连同进程组一起 TERM/KILL，可回收“包装进程先死、实例被 reparent 但仍
#      保留 PGID”的孤儿（用户关闭 Tauri 窗口的场景）。
#
# 进程组回收带安全护栏：只动与当前 shell 进程组不同的组，绝不自杀。

# 递归收集 pid 的所有子孙（含自身），叶子在前、根在后。
_proc_tree_descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _proc_tree_descendants "$child"
  done
  printf '%s\n' "$pid"
}

# 终止 pid 及其全部子孙（含同进程组的孤儿）。
# 先 SIGTERM，宽限 grace 秒后对仍存活者 SIGKILL。
#
# 用法：kill_process_tree <pid> [grace_seconds]
kill_process_tree() {
  local root="$1"
  local grace="${2:-3}"
  [[ -n "$root" ]] || return 0

  # 先收集子孙（此刻进程树通常仍完整）。即使 root 已退出也无妨。
  local pids
  pids="$(_proc_tree_descendants "$root" 2>/dev/null)"

  # 目标进程组：候选取“ps 查到的 PGID”与“root 自身”（启用 set -m 后作业
  # 自成组、PGID==PID，故 root 即组 id；即使 root 已退出仍可凭此回收同组孤儿）。
  # 安全护栏：只对与当前 shell 进程组不同且 > 1 的组下手，绝不自杀；当 root 并非
  # 组长时，对 -root 的信号会落空（ESRCH），无副作用。
  local shell_pgid queried_pgid
  shell_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  queried_pgid="$(ps -o pgid= -p "$root" 2>/dev/null | tr -d ' ')"

  local group_targets=""
  local cand
  for cand in "$queried_pgid" "$root"; do
    if [[ -n "$cand" && "$cand" -gt 1 && "$cand" != "$shell_pgid" && " $group_targets " != *" $cand "* ]]; then
      group_targets="$group_targets $cand"
    fi
  done

  _proc_tree_signal() {
    local sig="$1" p g
    for p in $pids; do
      kill "-$sig" "$p" 2>/dev/null || true
    done
    for g in $group_targets; do
      kill "-$sig" "-$g" 2>/dev/null || true
    done
  }

  _proc_tree_alive() {
    local p g
    for p in $pids; do
      kill -0 "$p" 2>/dev/null && return 0
    done
    for g in $group_targets; do
      kill -0 "-$g" 2>/dev/null && return 0
    done
    return 1
  }

  _proc_tree_signal TERM

  local waited=0
  while (( waited < grace )); do
    _proc_tree_alive || return 0
    sleep 1
    (( waited += 1 ))
  done

  _proc_tree_signal KILL
  return 0
}
