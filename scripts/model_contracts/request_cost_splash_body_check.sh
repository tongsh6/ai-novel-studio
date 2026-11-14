#!/usr/bin/env bash
# B87 R01 无模型 Splash 请求体核对入口：从 runtime recipe 单点注入 env 后，用现役
# adapter 的 test-only eventsource 边界截获实际 body。不启动后端/GUI、不连网络。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE="$ROOT/scripts/model_contracts/request_cost_baseline.mjs"
PROFILE="${REQUEST_COST_RUNTIME_PROFILE:-b87-r01-controlled-splash-high}"
OUT="${1:-}"

RUNTIME_ENV="$(node "$BASELINE" runtime-env --profile "$PROFILE")"
while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "非法 env 名: $key" >&2; exit 1; }
  export "$key=$value"
done <<< "$RUNTIME_ENV"

if [[ -n "$OUT" ]]; then
  MIX_ENV=test mix run --no-start "$ROOT/scripts/request_cost_splash_body_check.exs" "$OUT"
else
  MIX_ENV=test mix run --no-start "$ROOT/scripts/request_cost_splash_body_check.exs"
fi
