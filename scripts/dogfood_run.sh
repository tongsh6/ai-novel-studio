#!/usr/bin/env bash
#
# P1-100k-dogfood-run 长跑入口（docs/product/novel-output-milestones.md §7 #6）。
#
# 启动真实 Phoenix + Tauri 工作台，由外部 Playwright runner 像作者一样逐章推进
# （首稿/续写 → 采纳 → 循环 → 导出），产物落 artifacts/novel-output/p1-100k-dogfood/。
# 产品代码无任何狗粮感知逻辑。
#
# 用法：
#   bash scripts/dogfood_run.sh [--chapters N] [--min-words W] [--provider lmstudio|slice_verify] [--resume]
#
#   --chapters N      本次最多推进 N 个不同的章（0 = 跑到全部达标；默认 0）
#   --min-words W     每章有效字数下限（默认 1000）
#   --target-words T  全书目标有效字数（0 = 不扩章；>0 时全部章达标而总字数未达
#                     则自动增量规划扩章后继续，直到达标）
#   --provider      默认 lmstudio（狗粮要真实产出）；slice_verify 仅用于调试 runner
#   --resume        断点续跑：不重置数据库、不重新 seed，从当前作品事实继续
#                   （这也是 P1 Done「重启后能继续生成下一章」的真实演练）

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"

# 狗粮独立测试分区库（M0 实锤：与伞级 mix test 共享 ai_novel_studio_test.sqlite3
# 互踩——狗粮 seed 残留污染绝对计数断言、并行跑互相重置）。分区后互不可见。
export MIX_TEST_PARTITION="_dogfood"

# 狗粮独立构建目录（M0 实锤四跑：长跑期间外部 mix compile 重写共享 _build/test
# 的 .beam，运行中节点惰性加载撞上半新码——socket 掉线重连风暴 + 在飞 run 无声
# 崩死、第03章 turn 蒸发）。隔离后长跑期间可自由编译/跑测试。
export MIX_BUILD_PATH="$PROJECT_ROOT/_build/test_dogfood"

# 狗粮断点库不进 $TMPDIR（2026-07-21 实锤：macOS 重启清 /var/folders，M2 的
# --resume 断点 16.8k 字随之蒸发）；落项目本地 gitignored 目录，跨重启存活。
export NOVEL_TEST_DB_DIR="$PROJECT_ROOT/tmp/dogfood-db"
mkdir -p "$NOVEL_TEST_DB_DIR"

# 真实超时兜底（缺陷九跟进，2026-07-20）：test.exs 的 LMStudio timeout 默认
# 5s（给纯单测 stub 用），狗粮跑在 MIX_ENV=test 下但打真实模型——这个值现在
# 兼作挂钟止血阀判定基准，不覆盖会把正常生成误判成超时，整个长跑立刻断线。
export NOVEL_LMSTUDIO_TIMEOUT_MS="${NOVEL_LMSTUDIO_TIMEOUT_MS:-300000}"

PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5769}"
API_URL="http://127.0.0.1:${PHOENIX_PORT}"
VITE_WS_URL="ws://localhost:${VITE_PORT}/socket"

CHAPTERS=0
MIN_WORDS=1000
TARGET_WORDS=0
PROVIDER="lmstudio"
RESUME=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chapters)
      CHAPTERS="$2"; shift 2 ;;
    --min-words)
      MIN_WORDS="$2"; shift 2 ;;
    --target-words)
      TARGET_WORDS="$2"; shift 2 ;;
    --provider)
      PROVIDER="$2"; shift 2 ;;
    --resume)
      RESUME=1; shift ;;
    *)
      echo "Unexpected argument: $1" >&2; exit 1 ;;
  esac
done

if [[ "$PROVIDER" != "slice_verify" && "$PROVIDER" != "lmstudio" ]]; then
  echo "Unsupported provider: $PROVIDER" >&2
  exit 1
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/novel-output/p1-100k-dogfood"
APP_LOG_DIR="$ARTIFACT_DIR/app-log"
LLM_LOG_DIR="$ARTIFACT_DIR/llm-calls"
mkdir -p "$APP_LOG_DIR" "$LLM_LOG_DIR"

PHX_PID=""
TAURI_PID=""

reset_test_db() {
  cd "$PROJECT_ROOT"
  MIX_ENV=test mix ecto.drop --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
  MIX_ENV=test mix ecto.migrate --quiet >/dev/null
}

cleanup() {
  # 不重置数据库：作品事实保留，供 --resume 断点续跑。
  kill_process_tree "$TAURI_PID"
  wait "$TAURI_PID" 2>/dev/null || true
  kill_process_tree "$PHX_PID"
  wait "$PHX_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local max="${3:-30}"

  for _ in $(seq 1 "$max"); do
    if curl -s "$url" >/dev/null 2>&1; then
      echo "[dogfood] $label ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "[dogfood] $label did not become ready: $url" >&2
  return 1
}

wait_for_tauri_dev_app() {
  local log_file="$1"
  local max="${2:-120}"

  for _ in $(seq 1 "$max"); do
    if grep -q 'Running.*target/debug/app' "$log_file" 2>/dev/null; then
      echo "[dogfood] Tauri native app launched"
      return 0
    fi
    sleep 1
  done

  echo "[dogfood] Tauri native app did not launch" >&2
  tail -80 "$log_file" >&2 || true
  return 1
}

cd "$PROJECT_ROOT"

if [[ "$RESUME" -eq 0 ]]; then
  echo "[dogfood] fresh run: resetting test db and seeding work + adopted chapter plan"
  reset_test_db
  MIX_ENV=test mix run scripts/seed_p1_chapter_draft_generation.exs >"$ARTIFACT_DIR/seed.log" 2>&1
else
  echo "[dogfood] resume run: keeping existing work facts"
fi

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$APP_LOG_DIR" \
  SLICE_VERIFY_LLM_LOG_DIR="$LLM_LOG_DIR" \
  SLICE_VERIFY_PROVIDER="$PROVIDER" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
  VITE_WS_ENDPOINT="$VITE_WS_URL" \
  VITE_DEV_PORT="$VITE_PORT" \
  pnpm tauri dev >"$ARTIFACT_DIR/tauri.log" 2>&1 &
TAURI_PID=$!

wait_for_tauri_dev_app "$ARTIFACT_DIR/tauri.log" 120
wait_for_url "http://127.0.0.1:${VITE_PORT}" "Vite"

echo "[dogfood] runner driving real workbench (provider=$PROVIDER chapters=$CHAPTERS min-words=$MIN_WORDS target-words=$TARGET_WORDS resume=$RESUME)"

SLICE_VERIFY_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
  DOGFOOD_ARTIFACT_DIR="$ARTIFACT_DIR" \
  DOGFOOD_MAX_CHAPTERS="$CHAPTERS" \
  DOGFOOD_MIN_WORDS="$MIN_WORDS" \
  DOGFOOD_TARGET_WORDS="$TARGET_WORDS" \
  DOGFOOD_PROVIDER="$PROVIDER" \
  node slice-verify/dogfood-runner.mjs

echo "[dogfood] done. artifacts: $ARTIFACT_DIR"
