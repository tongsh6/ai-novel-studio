#!/usr/bin/env bash
# B87 R01 无模型 runtime bootstrap 核对：受控子进程启动现有 slice_verify_server.exs，
# 使用一次性测试库与临时端口，采集同进程白名单 runtime facts，核对后才结束进程。
# 不启动 GUI、不发 generation、不占用户端口；退出时只清理本脚本启动的进程与临时目录。
#
# 用法：bash scripts/model_contracts/request_cost_runtime_bootstrap_check.sh [profile]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE="$ROOT/scripts/model_contracts/request_cost_baseline.mjs"
PROFILE="${1:-${REQUEST_COST_RUNTIME_PROFILE:-b87-r01-controlled-splash-high}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVID="${REQUEST_COST_BOOTSTRAP_EVIDENCE_DIR:-$ROOT/artifacts/model-contracts/b87-r01/20261113/goal-alignment/runtime-bootstrap-$STAMP}"

if [[ -e "$EVID" ]]; then
  echo "bootstrap 证据目录已存在，拒绝覆盖: $EVID" >&2
  exit 64
fi
mkdir -p "$EVID"

source "$ROOT/scripts/lib/test_env.sh"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/b87-r01-bootstrap.XXXXXX")"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

novel_test_db_prepare --dir "$TMP/db" --reset --quiet

PORT=""
for candidate in $(seq 4790 4820); do
  if novel_ports_precheck "$candidate" >/dev/null 2>&1; then
    PORT="$candidate"
    break
  fi
done
if [[ -z "$PORT" ]]; then
  echo "4790-4820 无空闲端口，未启动 bootstrap" >&2
  exit 1
fi

# runtime recipe 单点生成实验参数；bootstrap 不自行重写一份值。
RUNTIME_ENV="$(node "$BASELINE" runtime-env --profile "$PROFILE")"
while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "非法 env 名: $key" >&2; exit 1; }
  export "$key=$value"
done <<< "$RUNTIME_ENV"

export MIX_ENV=test
export PHOENIX_TEST_PORT="$PORT"
export PHOENIX_PORT="$PORT"
export NOVEL_TEST_DB_DIR="$TMP/db"
export SLICE_VERIFY_SKIP_DEFAULT_WORK_SEED="1"
export SLICE_VERIFY_RUNTIME_FACTS_PATH="$EVID/runtime-facts.json"
export SLICE_VERIFY_LLM_LOG_DIR="$TMP/llm-calls"

{
  echo "profile=$PROFILE"
  echo "port=$PORT"
  echo "digest=runtime recipe 由 request_cost_runtime_recipe.mjs 生成"
  echo "--- runtime-env (data lines) ---"
  printf '%s\n' "$RUNTIME_ENV"
} >"$EVID/command.txt"

(
  cd "$ROOT"
  exec mix run --no-start --no-halt scripts/slice_verify_server.exs
) >"$EVID/backend.log" 2>&1 &
SERVER_PID=$!

if ! novel_wait_for_http "http://127.0.0.1:$PORT/health" "bootstrap backend" 60; then
  tail -40 "$EVID/backend.log" >&2 || true
  exit 1
fi

for _ in $(seq 1 40); do
  [[ -f "$EVID/runtime-facts.json" ]] && break
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.5
done

if [[ ! -f "$EVID/runtime-facts.json" ]]; then
  echo "同进程 runtime facts 未落盘" >&2
  tail -40 "$EVID/backend.log" >&2 || true
  exit 1
fi

node "$BASELINE" verify-runtime-facts "$EVID/runtime-facts.json" --profile "$PROFILE" \
  >"$EVID/verify-runtime-facts.log" 2>&1

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

node -e '
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];
let files = 0;
let lines = 0;
if (fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
    files += 1;
    lines += fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter((line) => line.includes("{")).length;
  }
}
process.stdout.write(JSON.stringify({ files, llm_call_lines: lines }) + "\n");
' "$TMP/llm-calls" >"$EVID/llm-calls.json"

node -e '
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const db = new DatabaseSync(path.join(process.argv[1], "ai_novel_studio_test.sqlite3"), { readOnly: true });
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
process.stdout.write(JSON.stringify({ provider_runs: count("provider_runs"), agent_runs: count("agent_runs") }) + "\n");
db.close();
' "$TMP/db" >"$EVID/db-counts.json"

MODEL_CALLS="$(cat "$EVID/llm-calls.json")"
cat >"$EVID/summary.json" <<EOF
{
  "schema": "b87-r01-runtime-bootstrap-check/v1",
  "profile": "$PROFILE",
  "port": $PORT,
  "server_pid": "killed_after_facts",
  "evidence_dir": "$EVID",
  "mix_env": "test",
  "model_calls": $MODEL_CALLS,
  "db_writes": $(cat "$EVID/db-counts.json"),
  "verified": true
}
EOF

echo "[bootstrap] PASS evidence=$EVID llm_calls=$MODEL_CALLS"
