#!/usr/bin/env bash
#
# Slice verification entrypoint.
#
# Usage:
#   bash scripts/slice_verify.sh --list
#   bash scripts/slice_verify.sh au10-micro-plan-entry
#
# The script starts a deterministic test backend and Vite frontend, runs the
# selected Playwright scenario from the real workbench, and writes artifacts to
# artifacts/slice-verify/<slice-id>/.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
  au10-micro-plan-entry
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
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  if [[ -n "$PHX_PID" ]]; then
    kill "$PHX_PID" 2>/dev/null || true
    wait "$PHX_PID" 2>/dev/null || true
  fi
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
MIX_ENV=test mix ecto.create --quiet >/dev/null 2>&1 || true
MIX_ENV=test mix ecto.migrate --quiet >/dev/null

MIX_ENV=test \
  PHOENIX_TEST_PORT="$PHOENIX_PORT" \
  PHOENIX_PORT="$PHOENIX_PORT" \
  SLICE_VERIFY_APP_LOG_DIR="$ARTIFACT_DIR/app-log" \
  mix run --no-start --no-halt scripts/slice_verify_server.exs >"$ARTIFACT_DIR/backend.log" 2>&1 &
PHX_PID=$!
wait_for_url "$API_URL/health" "Phoenix"

cd "$PROJECT_ROOT/frontend"
VITE_API_ENDPOINT="$API_URL" \
  VITE_WS_ENDPOINT="$WS_URL" \
  VITE_DEV_PORT="$VITE_PORT" \
  pnpm dev --host 127.0.0.1 >"$ARTIFACT_DIR/frontend.log" 2>&1 &
VITE_PID=$!
wait_for_url "$BASE_URL" "Vite"

SLICE_VERIFY_BASE_URL="$BASE_URL" \
  SLICE_VERIFY_ARTIFACT_DIR="$ARTIFACT_DIR" \
  node "$SPEC_PATH"

echo "[slice-verify] passed: $SLICE_ID"
