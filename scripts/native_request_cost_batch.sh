#!/usr/bin/env bash
# B87 R01 成本基线薄批次入口：只监督既有 tauri_slice_verify.sh 与已注册的
# prepare/driver/verify；不复制 Phoenix/Tauri/DB/代理运行时。
#
# 用法：
#   REQUEST_COST_MANIFEST=<frozen-manifest.json> REQUEST_COST_LENGTH=3|10|20 \
#     bash scripts/native_request_cost_batch.sh <tag>
#
# 前置：manifest 必须 frozen=true；Splash 服务与 local/Q4-PLE4 由作者环境提供；
# 本脚本只对本批隔离进程注入 request_cost_runtime_recipe.mjs 的受控实验参数，
# 不改 Splash 服务默认/作者偏好，也不把实验窗口说成产品默认。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$ROOT/scripts/model_contracts/request_cost_baseline.mjs"
TAG="${1:-}"
LENGTH="${REQUEST_COST_LENGTH:-}"
MANIFEST="${REQUEST_COST_MANIFEST:-}"
SNAPSHOT="${REQUEST_COST_SNAPSHOT:-}"

# 所有用户传入路径统一按仓库根解析为绝对路径；后续 node/bash 不再依赖当前 cwd。
abspath() {
  local value="$1"
  case "$value" in
    /*) ;;
    *) value="$ROOT/$value" ;;
  esac
  node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$value"
}

if [[ -z "$TAG" || ! "$TAG" =~ ^[a-z0-9-]+$ || ${#TAG} -gt 32 ]]; then
  echo "usage: REQUEST_COST_MANIFEST=<file> REQUEST_COST_LENGTH=3|10|20 bash scripts/native_request_cost_batch.sh <lowercase-tag-at-most-32-chars>" >&2
  exit 64
fi
if [[ "$LENGTH" != "3" && "$LENGTH" != "10" && "$LENGTH" != "20" ]]; then
  echo "REQUEST_COST_LENGTH 只能是 3/10/20，实测: ${LENGTH:-<empty>}" >&2
  exit 64
fi
if [[ -z "$MANIFEST" ]]; then
  echo "REQUEST_COST_MANIFEST 必须指向已冻结 manifest: <empty>" >&2
  exit 64
fi
MANIFEST="$(abspath "$MANIFEST")"
if [[ ! -f "$MANIFEST" ]]; then
  echo "REQUEST_COST_MANIFEST 不存在（按仓库根解析）: $MANIFEST" >&2
  exit 64
fi
if [[ -z "$SNAPSHOT" ]]; then
  echo "REQUEST_COST_SNAPSHOT 必须指向已核验 source-snapshot 目录: <empty>" >&2
  exit 64
fi
SNAPSHOT="$(abspath "$SNAPSHOT")"
if [[ ! -f "$SNAPSHOT/manifest.json" ]]; then
  echo "REQUEST_COST_SNAPSHOT 不存在（按仓库根解析）: $SNAPSHOT" >&2
  exit 64
fi

DIR="${REQUEST_COST_ARTIFACT_DIR:-$ROOT/artifacts/slice-verify/b87-r01-request-cost-live-$LENGTH-$TAG}"
DIR="$(abspath "$DIR")"
if [[ "$DIR" != "$ROOT/artifacts/"* || -e "$DIR" ]]; then
  echo "R01 证据目录必须位于 artifacts/ 且不存在: $DIR" >&2
  exit 64
fi

STATE_DIR="$ROOT/artifacts/request-cost-native"
mkdir -p "$STATE_DIR"
RUNNER_LOG="$STATE_DIR/batch-$TAG.runner.log"
DRIVER_LOG="$STATE_DIR/batch-$TAG.driver.log"

# 必须在启动 runner/驱动之前完成 manifest/快照/预算/目录冻结校验。
if ! node "$BASELINE" preflight "$MANIFEST" \
  --length "$LENGTH" --snapshot "$SNAPSHOT" --out "$DIR" >"$STATE_DIR/preflight-$TAG.log" 2>&1; then
  echo "R01 preflight failed before starting runner: $STATE_DIR/preflight-$TAG.log" >&2
  exit 1
fi

# manifest 是数据 JSON，不能 require 成 JS 模块；由 CLI 按仓库根读取并输出标量。
manifest_field() {
  node "$BASELINE" manifest-field "$MANIFEST" "$1"
}

WORK_ID="$(manifest_field seed.work_id)"
WORK_TITLE="$(manifest_field seed.title)"
SESSION_TITLE="$(manifest_field seed.session_title)"
export REQUEST_COST_WORK_ID="$WORK_ID"
export REQUEST_COST_WORK_TITLE="$WORK_TITLE"
export REQUEST_COST_SESSION_TITLE="$SESSION_TITLE"
export REQUEST_COST_SNAPSHOT="$SNAPSHOT"

# runtime recipe 的唯一定义在 request_cost_runtime_recipe.mjs；这里只消费数据行，
# 不 eval、不重写一份参数。任一 env 名非法即 fail closed。
RUNTIME_ENV="$(node "$BASELINE" runtime-env "$MANIFEST")"
while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "runtime recipe 返回非法 env 名: $key" >&2
    exit 1
  fi
  export "$key=$value"
done <<< "$RUNTIME_ENV"

export TAURI_NATIVE_SYSTEM_DRIVER=1
export TAURI_NATIVE_TRANSPORT_PROXY=1
export TAURI_NATIVE_ARTIFACT_TAG="$TAG"
export TAURI_NATIVE_ARTIFACT_DIR="$DIR"
export TAURI_NATIVE_SEED_SCRIPT="scripts/seed_request_cost_work.exs"
export REQUEST_COST_MANIFEST="$MANIFEST"
export REQUEST_COST_LENGTH="$LENGTH"
# Splash model/thinking/reasoning_effort、ContextPressure 窗口、自动维护与摘要策略
# 已由上面的 runtime recipe 统一注入；不修改 Splash 服务默认或作者保存的偏好。
export COREPACK_ENABLE_NETWORK=0

bash "$ROOT/scripts/tauri_slice_verify.sh" b87-r01-request-cost >"$RUNNER_LOG" 2>&1 &
RUNNER=$!

READY=0
for _ in $(seq 1 180); do
  if [[ -f "$DIR/native-driver-ready.json" ]]; then READY=1; break; fi
  if ! kill -0 "$RUNNER" 2>/dev/null; then
    echo "runner exited before native driver ready: $RUNNER_LOG" >&2
    exit 1
  fi
  sleep 2
done
if [[ "$READY" != "1" ]]; then
  echo "native driver ready timeout: $RUNNER_LOG" >&2
  kill "$RUNNER" 2>/dev/null || true
  wait "$RUNNER" 2>/dev/null || true
  exit 1
fi

if ! node "$ROOT/scripts/model_contracts/request_cost_baseline.mjs" prepare "$MANIFEST" "$DIR" --length "$LENGTH" >"$DIR/prepare.log" 2>&1; then
  echo "R01 prepare failed (manifest/seed/DB); app not driven: $DIR" >&2
  kill "$RUNNER" 2>/dev/null || true
  wait "$RUNNER" 2>/dev/null || true
  exit 1
fi

set +e
node "$ROOT/scripts/native_request_cost_drive.mjs" "$DIR" >"$DRIVER_LOG" 2>&1
DRIVER_RC=$?
set -e

if [[ "$DRIVER_RC" -ne 0 ]]; then
  # driver 失败也必须让既有 verifier 尽可能落 partial 报告；最多等 30s 收尾。
  for _ in $(seq 1 15); do
    kill -0 "$RUNNER" 2>/dev/null || break
    sleep 2
  done
  if kill -0 "$RUNNER" 2>/dev/null; then
    kill "$RUNNER" 2>/dev/null || true
  fi
  wait "$RUNNER" 2>/dev/null || true
  echo "[request-cost] FAIL driver_rc=$DRIVER_RC dir=$DIR" >&2
  echo "runner log: $RUNNER_LOG; driver log: $DRIVER_LOG" >&2
  exit 1
fi

set +e
wait "$RUNNER"
RUNNER_RC=$?
set -e

if [[ "$RUNNER_RC" -eq 0 ]]; then
  echo "[request-cost] PASS dir=$DIR"
  exit 0
fi
echo "[request-cost] FAIL runner_rc=$RUNNER_RC dir=$DIR" >&2
echo "runner log: $RUNNER_LOG; driver log: $DRIVER_LOG" >&2
exit 1
