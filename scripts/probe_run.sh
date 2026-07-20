#!/usr/bin/env bash
# 模型契约探针统一入口 —— 把踩过的坑机械化，禁止再裸敲长管道跑探针。
#
# 每条 export/规则对应一次真实事故（2026-07 M0-M2 期间）：
#   1) PHX_SERVER=false      探针 BEAM 占 4657 端口，连坏两轮场景验收（纪律提醒两次均失效）
#   2) MIX_BUILD_PATH 隔离   与并行 mix test 共用 _build/test 时 beam 文件互踩
#   3) 原始输出全量 tee      过滤管道（grep）块缓冲 → "零输出"被误诊为挂死，误杀健康探针两次；
#                            观察一律 tail -f 日志文件，禁止在探针管道上接过滤器
#   4) 并发探针预警          两个探针同时打 LM Studio 会排队互相拖慢，时延数据全部失真
#
# 用法: bash scripts/probe_run.sh <scripts/model_contracts/xxx.exs> [provider] [runs]
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PROBE_SCRIPT="${1:?用法: probe_run.sh <scripts/model_contracts/xxx.exs> [provider] [runs]}"
PROVIDER="${2:-lmstudio}"
RUNS="${3:-3}"

if pgrep -f "mix run scripts/model_contracts" >/dev/null 2>&1; then
  echo "[probe_run] 已有探针在跑（pgrep model_contracts 命中）——并发探针会让时延数据失真，先等它结束或杀掉再来。" >&2
  exit 1
fi

export PHX_SERVER=false
export MIX_BUILD_PATH="$PROJECT_ROOT/_build/test_probe"

STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$PROJECT_ROOT/artifacts/model-contracts/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(basename "$PROBE_SCRIPT" .exs)-${PROVIDER}-${STAMP}.log"

echo "[probe_run] script=$PROBE_SCRIPT provider=$PROVIDER runs=$RUNS"
echo "[probe_run] 原始日志: $LOG   （观察用 tail -f，别在本管道上加过滤）"

MODEL_CONTRACT_RUNS="$RUNS" MIX_ENV=test mix run "$PROBE_SCRIPT" "$PROVIDER" 2>&1 | tee "$LOG"
