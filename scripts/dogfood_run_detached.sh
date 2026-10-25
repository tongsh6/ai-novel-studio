#!/usr/bin/env bash
# B37 CP2：detached 长跑监督。把 dogfood_run.sh 放进独立 session，避免 agent/job 生命周期信号杀死；
# 提供 start/status/stop、pidfile/lock、端口/模型预检、日志/心跳、termination.json。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-}"
shift || true

ARTIFACT_ARG=""
PASS_ARGS=()
while (($#)); do
  case "$1" in
    --artifact-dir)
      ARTIFACT_ARG="${2:-}"
      shift 2 2>/dev/null || shift
      ;;
    --artifact-dir=*)
      ARTIFACT_ARG="${1#*=}"
      shift
      ;;
    *)
      PASS_ARGS+=("$1")
      shift
      ;;
  esac
done
set -- "${PASS_ARGS[@]}"

ARTIFACT_DIR="${ARTIFACT_ARG:-${DOGFOOD_ARTIFACT_DIR:-}}"
if [[ -z "$ARTIFACT_DIR" ]]; then
  echo "[detached] artifact dir required: set DOGFOOD_ARTIFACT_DIR or pass --artifact-dir <dir>" >&2
  echo "usage: $0 start|status|stop [--artifact-dir <dir>] [dogfood_run.sh args...]" >&2
  exit 2
fi
if [[ "$ARTIFACT_DIR" != /* ]]; then
  ARTIFACT_DIR="$ROOT/$ARTIFACT_DIR"
fi
export DOGFOOD_ARTIFACT_DIR="$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
PIDFILE="$ARTIFACT_DIR/detached.pid"
LOCKDIR="$ARTIFACT_DIR/detached.lock"
LOG="$ARTIFACT_DIR/detached.log"
HEARTBEAT="$ARTIFACT_DIR/heartbeat.jsonl"
TERMINATION="$ARTIFACT_DIR/termination.json"
META="$ARTIFACT_DIR/detached-meta.json"

json_write() {
  # json_write <path> <json-string>
  python3 - "$1" "$2" <<'PY'
import sys, pathlib
pathlib.Path(sys.argv[1]).write_text(sys.argv[2])
PY
}

TERMINATION_WRITTEN=0
write_termination() {
  local signal="$1"
  local code="${2:-0}"
  TERMINATION_WRITTEN=1
  python3 - "$TERMINATION" "$HEARTBEAT" "$PROGRESS_FILE" "$signal" "$code" "$PIDFILE" <<'PY'
import json, os, sys, datetime
termination, heartbeat, progress, signal, code, pidfile = sys.argv[1:7]
last_hb = None
try:
    lines = [l for l in open(heartbeat, encoding="utf-8", errors="ignore") if l.strip()]
    if lines:
        last_hb = json.loads(lines[-1])
except Exception:
    pass
progress_tail = ""
try:
    lines = [l for l in open(progress, encoding="utf-8", errors="ignore") if l.strip()]
    if lines:
        progress_tail = lines[-1][:800]
except Exception:
    pass
pid = None
try:
    pid = int(open(pidfile).read().strip())
except Exception:
    pass
payload = {
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "signal": signal,
    "exit_code": int(code) if str(code).lstrip("-").isdigit() else code,
    "pid": pid,
    "last_heartbeat": last_hb,
    "progress_tail": progress_tail,
}
open(termination, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=2))
PY
}

child_mode() {
  echo "$$" >"$PIDFILE"
  PROGRESS_FILE="$ARTIFACT_DIR/progress.jsonl"
  export PROGRESS_FILE
  : >"$HEARTBEAT"
  (
    while true; do
      sleep 10
      python3 - "$HEARTBEAT" "$PROGRESS_FILE" "$$" <<'PY'
import json, sys, datetime, os
heartbeat, progress, pid = sys.argv[1:4]
tail = ""
try:
    lines = [l for l in open(progress, encoding="utf-8", errors="ignore") if l.strip()]
    if lines:
        tail = lines[-1][:800]
except Exception:
    pass
with open(heartbeat, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pid": int(pid),
        "progress_tail": tail,
    }, ensure_ascii=False) + "\n")
PY
    done
  ) &
  local heartbeat_pid=$!
  trap 'write_termination TERM 143; kill "$heartbeat_pid" 2>/dev/null || true; exit 143' TERM
  trap 'write_termination INT 130; kill "$heartbeat_pid" 2>/dev/null || true; exit 130' INT
  trap 'if [[ "${TERMINATION_WRITTEN:-0}" -eq 0 ]]; then write_termination EXIT "$?"; fi; kill "$heartbeat_pid" 2>/dev/null || true' EXIT

  bash "$ROOT/scripts/dogfood_run.sh" "$@"
  local code=$?
  write_termination EXIT "$code"
  kill "$heartbeat_pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  exit "$code"
}

preflight() {
  for port in 4657 5769; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[detached] port $port already in use" >&2
      return 1
    fi
  done
  local launch_provider="${DOGFOOD_PROVIDER:-slice_verify}"
  local prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--provider" ]]; then launch_provider="$arg"; fi
    prev="$arg"
  done
  if [[ "$launch_provider" == "strata" ]]; then
    local endpoint="${NOVEL_STRATA_ENDPOINT:-http://127.0.0.1:47831/v1}"
    local model="${NOVEL_STRATA_MODEL:-iq3_s}"
    if ! curl -sf --max-time 5 "${endpoint%/}/models" | grep -q "$model"; then
      echo "[detached] strata model $model not ready at ${endpoint%/}/models" >&2
      return 1
    fi
  fi
  return 0
}

case "$ACTION" in
  start)
    if [[ -f "$PIDFILE" ]]; then
      old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
      if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
        echo "[detached] already running pid=$old_pid (log $LOG)" >&2
        exit 1
      fi
      rm -f "$PIDFILE"
    fi
    if ! mkdir "$LOCKDIR" 2>/dev/null; then
      echo "[detached] lock exists: $LOCKDIR (another start in progress?)" >&2
      exit 1
    fi
    trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT
    preflight "$@" || exit 1
    : >"$LOG"
    : >"$HEARTBEAT"
    python3 - "$ROOT" "$ARTIFACT_DIR" "$PIDFILE" "$LOG" "$META" "$@" <<'PY'
import json, os, subprocess, sys, datetime, pathlib
root, artifact, pidfile, logpath, meta, *args = sys.argv[1:]
head = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
cmd = ["bash", os.path.join(root, "scripts", "dogfood_run_detached.sh"), "__child", *args]
env = os.environ.copy()
env["DOGFOOD_ARTIFACT_DIR"] = artifact
log = open(logpath, "ab", buffering=0)
proc = subprocess.Popen(
    cmd, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
    start_new_session=True,
)
pathlib.Path(pidfile).write_text(str(proc.pid))
meta_obj = {
    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "head": head,
    "pid": proc.pid,
    "command": cmd,
    "args": args,
    "env": {k: env.get(k) for k in ["DOGFOOD_ARTIFACT_DIR","DOGFOOD_PROVIDER","NOVEL_TEST_DB_DIR","NOVEL_STRATA_MODEL","NOVEL_STRATA_ENDPOINT","DOGFOOD_WAIT_INPUT_MS","DOGFOOD_FAULT_SIM"] if k in env},
}
pathlib.Path(meta).write_text(json.dumps(meta_obj, ensure_ascii=False, indent=2))
PY
    sleep 1
    if [[ ! -f "$PIDFILE" ]]; then
      echo "[detached] launch failed; see $LOG" >&2
      tail -40 "$LOG" >&2 || true
      exit 1
    fi
    echo "[detached] started pid=$(cat "$PIDFILE") log=$LOG status='$0 status'"
    ;;
  status)
    if [[ ! -f "$PIDFILE" ]]; then
      echo "[detached] not running (no pidfile)"
      exit 3
    fi
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "[detached] running pid=$pid log=$LOG"
      ps -p "$pid" -o pid,etime,command= 2>/dev/null || true
      echo "--- log tail ---"
      tail -20 "$LOG" 2>/dev/null || true
      [[ -f "$ARTIFACT_DIR/summary.json" ]] && echo "summary: $ARTIFACT_DIR/summary.json"
      [[ -f "$TERMINATION" ]] && echo "termination: $TERMINATION"
      exit 0
    fi
    echo "[detached] stale pidfile pid=$pid (process gone)"
    exit 4
    ;;
  stop)
    if [[ ! -f "$PIDFILE" ]]; then
      echo "[detached] not running (no pidfile)"
      exit 3
    fi
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
      echo "[detached] pid=$pid already gone"
      rm -f "$PIDFILE"
      exit 0
    fi
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmd" != *"dogfood_run_detached.sh"* && "$cmd" != *"dogfood_run.sh"* ]]; then
      echo "[detached] refusing to signal pid=$pid (unexpected command: $cmd)" >&2
      exit 1
    fi
    echo "[detached] stop pid=$pid (TERM process group)"
    python3 - "$pid" <<'PY'
import os, signal, sys
pid = int(sys.argv[1])
try:
    os.killpg(os.getpgid(pid), signal.SIGTERM)
except ProcessLookupError:
    pass
PY
    for ((wait_i = 0; wait_i < 30; wait_i++)); do
      if ! kill -0 "$pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "[detached] still alive after 30s; KILL process group" >&2
      python3 - "$pid" <<'PY'
import os, signal, sys
pid = int(sys.argv[1])
try:
    os.killpg(os.getpgid(pid), signal.SIGKILL)
except ProcessLookupError:
    pass
PY
      sleep 1
    fi
    rm -f "$PIDFILE"
    echo "[detached] stopped"
    ;;
  __child)
    child_mode "$@"
    ;;
  *)
    echo "usage: $0 start|status|stop [dogfood_run.sh args...]" >&2
    exit 2
    ;;
esac
