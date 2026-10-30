#!/usr/bin/env bash
# B70 CP3：author-behavior 夜间/后台多 seed 探索批量 runner。
# 要求先写预注册（--preregistration JSON：scope/seeds/budget/criteria/evidence_dir），
# 以 nohup/detached 方式运行；每 seed 有预算、心跳、终止记录；失败批次只读保留。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/process_tree.sh"

PREREG=""
OUT=""
for arg in "$@"; do
  case "$arg" in
    --preregistration=*) PREREG="${arg#*=}" ;;
    --out=*) OUT="${arg#*=}" ;;
    -h|--help) echo "usage: bash scripts/author_behavior_nightly.sh --preregistration=<json> --out=<dir>"; exit 0 ;;
  esac
done
if [[ -z "$PREREG" || -z "$OUT" ]]; then
  echo "usage: bash scripts/author_behavior_nightly.sh --preregistration=<json> --out=<dir>" >&2
  exit 64
fi
if [[ ! -f "$PREREG" ]]; then
  echo "预注册文件不存在: $PREREG" >&2
  exit 64
fi

MKOUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"
node --input-type=module - "$PREREG" "$MKOUT" <<'NODE'
import fs from "node:fs";
const [preregPath, outDir] = process.argv.slice(2);
const prereg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
const fail = (message) => { console.error(`预注册无效: ${message}`); process.exit(64); };
if (prereg.schema !== "author-behavior-nightly-preregistration/v1") fail("schema");
if (!Array.isArray(prereg.seeds) || prereg.seeds.length === 0) fail("seeds");
if (!prereg.scope || !prereg.criteria) fail("scope/criteria");
if (prereg.evidence_dir !== outDir) fail(`evidence_dir 必须等于 --out（${outDir}）`);
if (!Number.isInteger(prereg.budget?.per_seed_timeout_s) || prereg.budget.per_seed_timeout_s < 60 || prereg.budget.per_seed_timeout_s > 600) fail("budget.per_seed_timeout_s");
NODE

STATE="$MKOUT/state.json"
PIDFILE="$MKOUT/runner.pid"
HEARTBEAT="$MKOUT/heartbeat.log"
TERMINATION="$MKOUT/termination.json"
START_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$$" > "$PIDFILE"
node --input-type=module - "$STATE" "$START_AT" "$$" "$MKOUT" "$PREREG" <<'NODE'
import fs from "node:fs";
const [statePath, startedAt, pid, outDir, preregPath] = process.argv.slice(2);
const prereg = JSON.parse(fs.readFileSync(preregPath, "utf8"));
fs.writeFileSync(statePath, JSON.stringify({ status: "running", started_at: startedAt, pid: Number(pid), out: outDir, seeds: prereg.seeds }, null, 2) + "\n");
NODE

SEEDS="$(node -e 'const fs=require("fs"),path=require("path");const p=JSON.parse(fs.readFileSync(path.resolve(process.argv[1]),"utf8"));process.stdout.write(p.seeds.join(" "))' "$PREREG")"
TIMEOUT="$(node -e 'const fs=require("fs"),path=require("path");const p=JSON.parse(fs.readFileSync(path.resolve(process.argv[1]),"utf8"));process.stdout.write(String(p.budget.per_seed_timeout_s))' "$PREREG")"
RESULTS="$MKOUT/results.tsv"
: > "$RESULTS"

PIDS=""
cleanup() {
  if [[ -n "$PIDS" ]]; then
    for pid in $PIDS; do kill_process_tree "$pid" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT INT TERM

for seed in $SEEDS; do
  echo "$(date -u +%FT%TZ) seed=$seed start" >> "$HEARTBEAT"
  (
    cd "$PROJECT_ROOT"
    SLICE_VERIFY_PROVIDER=slice_verify AUTHOR_BEHAVIOR_EXPLORE_SEED="$seed" \
      bash scripts/slice_verify.sh author-behavior-explore >"$MKOUT/seed-${seed}.log" 2>&1
    echo "$?" > "$MKOUT/seed-${seed}.exit"
  ) &
  pid=$!
  PIDS="$PIDS $pid"
  echo "$pid" > "$MKOUT/seed-${seed}.pid"
  elapsed=0
  timed_out=false
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    echo "$(date -u +%FT%TZ) seed=$seed elapsed=${elapsed}s" >> "$HEARTBEAT"
    if [[ "$elapsed" -ge "$TIMEOUT" ]]; then
      timed_out=true
      kill_process_tree "$pid" 2>/dev/null || true
      break
    fi
  done
  set +e
  wait "$pid"
  rc=$?
  set -e
  if [[ "$timed_out" == true ]]; then
    status="timeout"
    rc=124
  elif [[ "$rc" -eq 0 ]]; then
    status="pass"
  else
    status="fail"
  fi
  printf '%s\t%s\t%s\t%s\n' "$seed" "$status" "$rc" "$MKOUT/seed-${seed}.log" >> "$RESULTS"
  if [[ -f "$PROJECT_ROOT/artifacts/slice-verify/author-behavior-explore/summary.json" ]]; then
    cp "$PROJECT_ROOT/artifacts/slice-verify/author-behavior-explore/summary.json" "$MKOUT/seed-${seed}-summary.json"
    cp "$PROJECT_ROOT/artifacts/slice-verify/author-behavior-explore/exploration.json" "$MKOUT/seed-${seed}-exploration.json" 2>/dev/null || true
    cp "$PROJECT_ROOT/artifacts/slice-verify/author-behavior-explore/coverage.json" "$MKOUT/seed-${seed}-coverage.json" 2>/dev/null || true
  fi
  echo "$(date -u +%FT%TZ) seed=$seed done status=$status rc=$rc" >> "$HEARTBEAT"
  if [[ "$status" != "pass" ]]; then
    break
  fi
done

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PASS_COUNT="$(awk -F'\t' '$2=="pass"' "$RESULTS" | wc -l | tr -d ' ')"
FAIL_COUNT="$(awk -F'\t' '$2!="pass"' "$RESULTS" | wc -l | tr -d ' ')"
STATUS="pass"; [[ "$FAIL_COUNT" -gt 0 ]] && STATUS="fail"
node -e 'const fs=require("fs");const [statePath,termPath,status,pass,fail,finished,results]=process.argv.slice(1);const state=JSON.parse(fs.readFileSync(statePath,"utf8"));fs.writeFileSync(termPath,JSON.stringify({...state,status,pass_count:Number(pass),fail_count:Number(fail),finished_at:finished,results},null,2)+"\n");fs.writeFileSync(statePath,JSON.stringify({...state,status,pass_count:Number(pass),fail_count:Number(fail),finished_at:finished},null,2)+"\n");' "$STATE" "$TERMINATION" "$STATUS" "$PASS_COUNT" "$FAIL_COUNT" "$FINISHED_AT" "$RESULTS"
echo "[author-behavior-nightly] status=$STATUS pass=$PASS_COUNT fail=$FAIL_COUNT out=$MKOUT"
[[ "$STATUS" == "pass" ]]
