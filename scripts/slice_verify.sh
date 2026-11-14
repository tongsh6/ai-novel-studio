#!/usr/bin/env bash
#
# Slice verification entrypoint.
#
# Usage:
#   bash scripts/slice_verify.sh --list
#
# The script starts a deterministic test backend and Vite frontend, runs the
# selected Playwright scenario from the real workbench, and writes artifacts to
# artifacts/slice-verify/<slice-id>/.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"
source "$PROJECT_ROOT/scripts/lib/test_env.sh"
source "$PROJECT_ROOT/scripts/lib/artifact_history.sh"
SLICE_ID="${1:-}"
PHOENIX_PORT="${PHOENIX_PORT:-4657}"
VITE_PORT="${VITE_DEV_PORT:-5768}"
BASE_URL="http://127.0.0.1:${VITE_PORT}"
API_URL="http://127.0.0.1:${PHOENIX_PORT}"
WS_URL="ws://127.0.0.1:${PHOENIX_PORT}/socket"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/slice_verify.sh --list
  bash scripts/slice_verify.sh <slice-id>

Available slice ids:
  au02-candidate-continuation
  au10-workbench-render-stability
  vs10-observability-spine
EOF
}

if [[ -z "$SLICE_ID" || "$SLICE_ID" == "-h" || "$SLICE_ID" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$SLICE_ID" == "--list" ]]; then
  usage
  exit 0
fi

SPEC_PATH="$PROJECT_ROOT/frontend/slice-verify/${SLICE_ID}.mjs"
# B70/B73：各作者行为场景共享同一外部 driver（同一真实页面入口），仅由 env 切换计划。
if [[ "$SLICE_ID" == "author-behavior-explore" || "$SLICE_ID" == "author-behavior-negative" || "$SLICE_ID" == "author-behavior-actions" || "$SLICE_ID" == "author-behavior-read-failure" ]]; then
  SPEC_PATH="$PROJECT_ROOT/frontend/slice-verify/author-behavior-corpus.mjs"
fi
if [[ ! -f "$SPEC_PATH" ]]; then
  echo "Unknown slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/$SLICE_ID"
# B84 A4：固定路径仍供下游读取；覆盖前把上一批证据归档到 .history，不直接删除。
novel_artifact_archive "$ARTIFACT_DIR" "$PROJECT_ROOT/artifacts/slice-verify" || exit $?
mkdir -p "$ARTIFACT_DIR"

# 测试库前置统一由 scripts/lib/test_env.sh 承担；本入口固定库目录到本次
# artifact 下，避免 mix 的 pid token 让「建库/seed/后端」落到不同 SQLite 文件。
export NOVEL_TEST_DB_DIR="${NOVEL_TEST_DB_DIR:-$ARTIFACT_DIR/database}"

PHX_PID=""
VITE_PID=""

cleanup() {
  local original=$?
  local cleanup_failed=0
  # 整棵进程树回收：pnpm/mix 包装进程之下的 vite node、beam.smp 必须一并终止，
  # 否则包装进程一死，真实实例被 reparent 到 init 后常驻、占用端口。
  kill_process_tree "$VITE_PID" || cleanup_failed=1
  wait "$VITE_PID" 2>/dev/null || true
  kill_process_tree "$PHX_PID" || cleanup_failed=1
  wait "$PHX_PID" 2>/dev/null || true
  if (( cleanup_failed != 0 )); then
    echo "[slice-verify] cleanup failed (original exit=$original)" >&2
    if (( original == 0 )); then exit 1; fi
  fi
  exit "$original"
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local max="${3:-30}"

  for _ in $(seq 1 "$max"); do
    if curl -s "$url" >/dev/null 2>&1; then
      echo "[slice-verify] $label ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "[slice-verify] $label did not become ready: $url" >&2
  return 1
}

echo "[slice-verify] slice: $SLICE_ID"
echo "[slice-verify] artifacts: $ARTIFACT_DIR"

cd "$PROJECT_ROOT"

# B70/B73：数据驱动语料场景使用隔离 DB + 合成状态 seed + 确定性语料替身。
if [[ "$SLICE_ID" == "author-behavior-corpus" || "$SLICE_ID" == "author-behavior-explore" || "$SLICE_ID" == "author-behavior-negative" || "$SLICE_ID" == "author-behavior-actions" || "$SLICE_ID" == "author-behavior-read-failure" ]]; then
  export NOVEL_TEST_DB_DIR="$ARTIFACT_DIR/database"
  mkdir -p "$NOVEL_TEST_DB_DIR"
  export AUTHOR_BEHAVIOR_CORPUS_JSON="$ARTIFACT_DIR/corpus.json"
  export AUTHOR_BEHAVIOR_DB_PATH="$NOVEL_TEST_DB_DIR/ai_novel_studio_test.sqlite3"
  export SLICE_VERIFY_LLM_LOG_DIR="${SLICE_VERIFY_LLM_LOG_DIR:-$ARTIFACT_DIR/llm-calls}"
fi

if [[ "$SLICE_ID" == "author-behavior-explore" ]]; then
  export AUTHOR_BEHAVIOR_EXPLORE_SEED="${AUTHOR_BEHAVIOR_EXPLORE_SEED:-20261030}"
  # CP3：覆盖扩展后探索 pool；可被 env 覆盖（负控/缩化重放）。
  export AUTHOR_BEHAVIOR_EXPLORE_POOL="${AUTHOR_BEHAVIOR_EXPLORE_POOL:-C-F1-001,C-F1-002,C-F2-002,C-F3-001,C-F3-003,C-F3-005,C-F4-001,C-F4-002,C-F4-003,C-F5-001,C-F5-002}"
fi
if [[ "$SLICE_ID" == "author-behavior-negative" ]]; then
  export AUTHOR_BEHAVIOR_NEGATIVE_CONTROLS=1
fi
if [[ "$SLICE_ID" == "author-behavior-actions" ]]; then
  export AUTHOR_BEHAVIOR_ACTION_COVERAGE=1
  export AUTHOR_BEHAVIOR_EXPLORE_SEED="${AUTHOR_BEHAVIOR_EXPLORE_SEED:-20261031}"
fi
if [[ "$SLICE_ID" == "author-behavior-read-failure" ]]; then
  export AUTHOR_BEHAVIOR_READ_FAILURE=1
fi

if ! novel_test_db_prepare --quiet --root "$PROJECT_ROOT"; then
  echo "[slice-verify] 测试库前置失败：$NOVEL_TEST_DB_DIR" >&2
  exit 1
fi

if [[ "$SLICE_ID" == "author-behavior-corpus" || "$SLICE_ID" == "author-behavior-explore" || "$SLICE_ID" == "author-behavior-negative" || "$SLICE_ID" == "author-behavior-actions" || "$SLICE_ID" == "author-behavior-read-failure" ]]; then
  MIX_ENV=test mix run scripts/seed_author_behavior_states.exs >"$ARTIFACT_DIR/seed.log" 2>&1
fi

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$ARTIFACT_DIR/app-log" \
  SLICE_VERIFY_LLM_LOG_DIR="${SLICE_VERIFY_LLM_LOG_DIR:-}" \
  SLICE_VERIFY_PROVIDER="${SLICE_VERIFY_PROVIDER:-slice_verify}" \
  AUTHOR_BEHAVIOR_CORPUS_JSON="${AUTHOR_BEHAVIOR_CORPUS_JSON:-}" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
if [[ "${SLICE_VERIFY_STATIC_FRONTEND:-0}" == "1" ]]; then
  # 并发开发时冻结本次真实页面资源，避免其它 WIP 的 HMR 在动作中途整页重载。
  VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
    VITE_WS_ENDPOINT="$WS_URL" \
    VITE_DEV_PORT="$VITE_PORT" \
    pnpm build >"$ARTIFACT_DIR/frontend-build.log" 2>&1
  VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
    VITE_WS_ENDPOINT="$WS_URL" \
    VITE_DEV_PORT="$VITE_PORT" \
    pnpm preview --host 127.0.0.1 --port "$VITE_PORT" --strictPort >"$ARTIFACT_DIR/frontend.log" 2>&1 &
else
  VITE_API_ENDPOINT="" \
  VITE_PROXY_TARGET="$API_URL" \
    VITE_WS_ENDPOINT="$WS_URL" \
    VITE_DEV_PORT="$VITE_PORT" \
    pnpm dev --host 127.0.0.1 >"$ARTIFACT_DIR/frontend.log" 2>&1 &
fi
VITE_PID=$!
wait_for_url "$BASE_URL" "Vite"

SLICE_VERIFY_BASE_URL="$BASE_URL" \
  SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
  SLICE_VERIFY_LLM_LOG_DIR="${SLICE_VERIFY_LLM_LOG_DIR:-}" \
  AUTHOR_BEHAVIOR_CORPUS_JSON="${AUTHOR_BEHAVIOR_CORPUS_JSON:-}" \
  AUTHOR_BEHAVIOR_DB_PATH="${AUTHOR_BEHAVIOR_DB_PATH:-}" \
  AUTHOR_BEHAVIOR_CASE_IDS="${AUTHOR_BEHAVIOR_CASE_IDS:-}" \
  AUTHOR_BEHAVIOR_NEGATIVE_CONTROLS="${AUTHOR_BEHAVIOR_NEGATIVE_CONTROLS:-}" \
  AUTHOR_BEHAVIOR_ACTION_COVERAGE="${AUTHOR_BEHAVIOR_ACTION_COVERAGE:-}" \
  AUTHOR_BEHAVIOR_READ_FAILURE="${AUTHOR_BEHAVIOR_READ_FAILURE:-}" \
  AUTHOR_BEHAVIOR_EXPLORE_SEED="${AUTHOR_BEHAVIOR_EXPLORE_SEED:-}" \
  AUTHOR_BEHAVIOR_EXPLORE_POOL="${AUTHOR_BEHAVIOR_EXPLORE_POOL:-}" \
  node "$SPEC_PATH"

echo "[slice-verify] passed: $SLICE_ID"
