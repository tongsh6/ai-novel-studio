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
# B70 CP2：探索场景与固定回放共享同一外部 driver（同一真实页面入口），仅由 env 切换计划。
if [[ "$SLICE_ID" == "author-behavior-explore" ]]; then
  SPEC_PATH="$PROJECT_ROOT/frontend/slice-verify/author-behavior-corpus.mjs"
fi
if [[ ! -f "$SPEC_PATH" ]]; then
  echo "Unknown slice verification id: $SLICE_ID" >&2
  usage >&2
  exit 64
fi

ARTIFACT_DIR="$PROJECT_ROOT/artifacts/slice-verify/$SLICE_ID"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"

PHX_PID=""
VITE_PID=""

cleanup() {
  # 整棵进程树回收：pnpm/mix 包装进程之下的 vite node、beam.smp 必须一并终止，
  # 否则包装进程一死，真实实例被 reparent 到 init 后常驻、占用端口。
  kill_process_tree "$VITE_PID"
  wait "$VITE_PID" 2>/dev/null || true
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

# B70 CP1：数据驱动语料场景使用隔离 DB + 合成状态 seed + 确定性语料替身。
if [[ "$SLICE_ID" == "author-behavior-corpus" || "$SLICE_ID" == "author-behavior-explore" ]]; then
  export NOVEL_TEST_DB_DIR="$ARTIFACT_DIR/database"
  mkdir -p "$NOVEL_TEST_DB_DIR"
  export AUTHOR_BEHAVIOR_CORPUS_JSON="$ARTIFACT_DIR/corpus.json"
  export AUTHOR_BEHAVIOR_DB_PATH="$NOVEL_TEST_DB_DIR/ai_novel_studio_test.sqlite3"
fi

if [[ "$SLICE_ID" == "author-behavior-explore" ]]; then
  export AUTHOR_BEHAVIOR_EXPLORE_SEED="${AUTHOR_BEHAVIOR_EXPLORE_SEED:-20261030}"
fi

MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
MIX_ENV=test mix ecto.migrate --quiet >/dev/null

if [[ "$SLICE_ID" == "author-behavior-corpus" || "$SLICE_ID" == "author-behavior-explore" ]]; then
  MIX_ENV=test mix run scripts/seed_author_behavior_states.exs >"$ARTIFACT_DIR/seed.log" 2>&1
fi

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$ARTIFACT_DIR/app-log" \
  SLICE_VERIFY_PROVIDER="${SLICE_VERIFY_PROVIDER:-slice_verify}" \
  AUTHOR_BEHAVIOR_CORPUS_JSON="${AUTHOR_BEHAVIOR_CORPUS_JSON:-}" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
VITE_API_ENDPOINT="" \
VITE_PROXY_TARGET="$API_URL" \
  VITE_WS_ENDPOINT="$WS_URL" \
  VITE_DEV_PORT="$VITE_PORT" \
  pnpm dev --host 127.0.0.1 >"$ARTIFACT_DIR/frontend.log" 2>&1 &
VITE_PID=$!
wait_for_url "$BASE_URL" "Vite"

SLICE_VERIFY_BASE_URL="$BASE_URL" \
  SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
  AUTHOR_BEHAVIOR_CORPUS_JSON="${AUTHOR_BEHAVIOR_CORPUS_JSON:-}" \
  AUTHOR_BEHAVIOR_DB_PATH="${AUTHOR_BEHAVIOR_DB_PATH:-}" \
  AUTHOR_BEHAVIOR_CASE_IDS="${AUTHOR_BEHAVIOR_CASE_IDS:-}" \
  AUTHOR_BEHAVIOR_EXPLORE_SEED="${AUTHOR_BEHAVIOR_EXPLORE_SEED:-}" \
  AUTHOR_BEHAVIOR_EXPLORE_POOL="${AUTHOR_BEHAVIOR_EXPLORE_POOL:-}" \
  node "$SPEC_PATH"

echo "[slice-verify] passed: $SLICE_ID"
