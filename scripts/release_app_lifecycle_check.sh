#!/usr/bin/env bash
# SU04 CP1：真实 release 打包应用生命周期外部复验（隔离 HOME + profile）。
#
# 用法：
#   bash scripts/release_app_lifecycle_check.sh <scenario> [--app <path>]
#   scenario: cold-start | exit-no-orphan | port-conflict | bad-archive
#
# 预注册：artifacts/model-contracts/su04-cp1-release/preregistration.json
# 证据：  artifacts/slice-verify/su04-release-app/<scenario>-<timestamp>/
#
# 边界：只操作本批隔离 HOME 下归属的进程；不触碰作者真实数据；不启动真实模型。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCENARIO="${1:-}"
APP="${SU04_APP_PATH:-$ROOT/frontend/src-tauri/target/release/bundle/macos/AI Novel Studio.app}"
PORT="${SU04_SIDECAR_PORT:-4658}"
PROFILE="${SU04_PROFILE:-release-verify}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$ROOT/artifacts/slice-verify/su04-release-app/${SCENARIO:-unknown}-$STAMP"
HOME_DIR="$DIR/home"
APP_LOG="$DIR/app.out"
SUMMARY="$DIR/summary.json"
APP_PID=""
OCCUPIER_PID=""

if [[ -z "$SCENARIO" ]]; then
  echo "usage: bash scripts/release_app_lifecycle_check.sh <cold-start|exit-no-orphan|port-conflict|bad-archive>" >&2
  exit 64
fi

mkdir -p "$HOME_DIR"

log() { printf '[su04] %s\n' "$*"; }

write_json() {
  printf '%s\n' "$1" > "$2"
}

fail() {
  local reason="$1"
  write_json "{\"scenario\":\"$SCENARIO\",\"status\":\"fail\",\"reason\":\"$reason\",\"at\":\"$(date -u +%FT%TZ)\"}" "$DIR/failure.json"
  log "FAIL: $reason"
  cleanup
  exit 1
}

# 本批归属识别：命令行包含隔离 HOME 的进程（app 与 sidecar 解包目录都在其中）。
batch_pids() {
  ps -axo pid=,command= | grep -F "$HOME_DIR" | grep -v grep | awk '{print $1}' || true
}

app_pids() {
  ps -axo pid=,command= | grep -F "$APP/Contents/MacOS/app" | grep -v grep | awk '{print $1}' || true
}

port_listen_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

cleanup() {
  local pids
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$APP_PID" 2>/dev/null || true
  fi
  pids="$(batch_pids)"
  if [[ -n "$pids" ]]; then
    log "cleanup batch pids: $pids"
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    pids="$(batch_pids)"
    # shellcheck disable=SC2086
    [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true
  fi
  if [[ -n "$OCCUPIER_PID" ]] && kill -0 "$OCCUPIER_PID" 2>/dev/null; then
    kill -TERM "$OCCUPIER_PID" 2>/dev/null || true
    wait "$OCCUPIER_PID" 2>/dev/null || true
  fi
}

snapshot_processes() {
  local out="$1"
  {
    printf '{"at":"%s","batch_pids":[' "$(date -u +%FT%TZ)"
    batch_pids | paste -sd, -
    printf '],"app_pids":['
    app_pids | paste -sd, -
    printf '],"port_%s_listen_pids":[' "$PORT"
    port_listen_pids | paste -sd, -
    printf ']}\n'
  } > "$out"
}

port_state() {
  if [[ -n "$(port_listen_pids)" ]]; then echo "listen"; else echo "closed"; fi
}

wait_port_state() {
  local want="$1" budget="${2:-60}"
  for _ in $(seq 1 "$budget"); do
    [[ "$(port_state)" == "$want" ]] && return 0
    sleep 1
  done
  return 1
}

installed_marker() {
  find "$HOME_DIR" -name ".install-complete" -type f 2>/dev/null | head -1
}

start_app() {
  local app_path="$1"
  HOME="$HOME_DIR" AI_NOVEL_DESKTOP_PROFILE="$PROFILE" \
    "$app_path/Contents/MacOS/app" >"$APP_LOG" 2>&1 &
  APP_PID=$!
  log "app started pid=$APP_PID app=$app_path"
}

wait_app_alive() {
  local budget="${1:-60}"
  for _ in $(seq 1 "$budget"); do
    kill -0 "$APP_PID" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

exit_app() {
  [[ -n "$APP_PID" ]] || return 0

  # 作者真实关闭路径：AX 关闭窗口（Tauri CloseRequested → exit(0) → RunEvent::Exit
  # → shutdown_sidecar）。进程名可能是 "AI Novel Studio"（CFBundleName）或 "app"。
  local closed=1
  for proc in "AI Novel Studio" "app"; do
    if osascript -e "tell application \"System Events\" to tell process \"$proc\" to click (first button whose subrole is \"AXCloseButton\") of front window" >/dev/null 2>&1; then
      closed=0
      break
    fi
  done

  if [[ "$closed" == "0" ]]; then
    for _ in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || return 0
      sleep 1
    done
  fi

  # fallback：真实关闭不可用/失败时用 TERM，并在场景目录标注（该路径不作为
  # 产品"退出无孤儿"证据）。
  printf 'fallback=term\n' > "$DIR/exit-method.txt"
  kill -TERM "$APP_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$APP_PID" 2>/dev/null || return 0
    sleep 1
  done
  kill -KILL "$APP_PID" 2>/dev/null || true
}

# ── 预检 ────────────────────────────────────────────────────────────────
[[ -d "$APP" ]] || fail "missing_app_bundle"
[[ -x "$APP/Contents/MacOS/app" ]] || fail "missing_app_executable"
[[ -f "$APP/Contents/Resources/sidecar.tar.gz" ]] || fail "missing_bundled_sidecar"
lms ps >"$DIR/lms-ps-before.txt" 2>&1 || true
trap cleanup EXIT

if [[ "$SCENARIO" != "port-conflict" ]] && [[ -n "$(port_listen_pids)" ]]; then
  fail "port_already_in_use_before_start"
fi

case "$SCENARIO" in
  cold-start|exit-no-orphan)
    start_app "$APP"
    wait_app_alive 60 || fail "app_not_alive"
    wait_port_state listen 90 || fail "sidecar_port_not_listening"
    marker="$(installed_marker)"
    [[ -n "$marker" ]] || fail "install_marker_missing"
    snapshot_processes "$DIR/process-snapshot.json"
    find "$HOME_DIR" -maxdepth 6 -name "sidecar*" -print > "$DIR/sidecar-install-tree.txt" 2>/dev/null || true
    cp "$marker" "$DIR/install-complete.json" 2>/dev/null || true
    sidecar_log="$(dirname "$marker")/../data/log/sidecar.out"
    [[ -f "$sidecar_log" ]] && cp "$sidecar_log" "$DIR/sidecar.out" || true
    write_json "{\"scenario\":\"$SCENARIO\",\"status\":\"pass\",\"app_pid\":$APP_PID,\"marker\":\"${marker#$HOME_DIR}\",\"port\":\"$PORT\",\"port_state\":\"listen\",\"at\":\"$(date -u +%FT%TZ)\"}" "$SUMMARY"
    if [[ "$SCENARIO" == "cold-start" ]]; then
      exit_app
      wait "$APP_PID" 2>/dev/null || true
      APP_PID=""
      for _ in $(seq 1 10); do
        [[ -z "$(batch_pids)" ]] && break
        sleep 1
      done
      wait_port_state closed 10 || fail "port_not_released_after_cold_start"
    fi
    if [[ "$SCENARIO" == "exit-no-orphan" ]]; then
      exit_app
      wait "$APP_PID" 2>/dev/null || true
      for _ in $(seq 1 10); do
        [[ -z "$(batch_pids)" ]] && break
        sleep 1
      done
      remaining="$(batch_pids)"
      [[ -z "$remaining" ]] || fail "orphan_processes_after_exit:$remaining"
      wait_port_state closed 10 || fail "port_not_released_after_exit"
    fi
    ;;
  port-conflict)
    python3 -m http.server "$PORT" --bind 127.0.0.1 >"$DIR/occupier.out" 2>&1 &
    OCCUPIER_PID=$!
    for _ in $(seq 1 10); do
      [[ -n "$(port_listen_pids)" ]] && break
      sleep 1
    done
    [[ -n "$(port_listen_pids)" ]] || fail "occupier_failed_to_bind"
    start_app "$APP"
    wait_app_alive 60 || fail "app_not_alive_under_port_conflict"

    # 等待就绪探测失败与清理完成（15s 探测 + 组终止）。核心判据：
    # - 端口仍由占用者持有（无伪 ready，app 未绑定成功）；
    # - 本批 sidecar/beam 进程被清理干净（无孤儿残留）；
    # - 占用者未被误杀。
    sleep 30
    snapshot_processes "$DIR/process-snapshot.json"
    listen_pids="$(port_listen_pids)"
    [[ -n "$listen_pids" ]] || fail "occupier_lost_port"
    [[ "$listen_pids" == *"$OCCUPIER_PID"* ]] || fail "port_owner_changed"
    kill -0 "$OCCUPIER_PID" 2>/dev/null || fail "occupier_was_killed"

    profile_dir="$HOME_DIR/Library/Application Support/com.ai-novel-studio.app/profiles/$PROFILE"
    [[ -f "$profile_dir/log/sidecar.out" ]] && cp "$profile_dir/log/sidecar.out" "$DIR/sidecar.out" || true
    [[ -f "$profile_dir/erl_crash.dump" ]] && cp "$profile_dir/erl_crash.dump" "$DIR/erl_crash.dump" || true

    remaining="$(batch_pids)"
    [[ -z "$remaining" ]] || fail "leftover_batch_sidecar:$remaining"

    # 失败分类窗口：作者可见文案由 Tauri SidecarStatus + 前端恢复文案承载；
    # 外部 AX 文本读取待改进（已知限制），此处记录窗口存在与否，不作为硬判据。
    osascript -e 'tell application "System Events" to tell process "AI Novel Studio" to get name of every window' >"$DIR/window-titles.txt" 2>&1 || true
    write_json "{\"scenario\":\"port-conflict\",\"status\":\"pass\",\"occupier_alive\":true,\"no_fake_ready\":true,\"batch_pids_after\":\"$remaining\",\"failure_classification_channel\":\"tauri_sidecar_status+frontend_copy\",\"at\":\"$(date -u +%FT%TZ)\"}" "$SUMMARY"
    ;;
  bad-archive)
    COPY="$DIR/bad-app.app"
    cp -R "$APP" "$COPY"
    printf 'not-a-valid-tar-archive' > "$COPY/Contents/Resources/sidecar.tar.gz"
    start_app "$COPY"
    wait_app_alive 60 || fail "app_not_alive_with_bad_archive"
    sleep 20
    snapshot_processes "$DIR/process-snapshot.json"
    if grep -qiE "sidecar|archive|安装|失败|failed" "$APP_LOG"; then
      :
    else
      fail "no_bad_archive_classification_in_app_log"
    fi
    [[ -z "$(installed_marker)" ]] || fail "bad_archive_left_install_marker"
    write_json "{\"scenario\":\"bad-archive\",\"status\":\"pass\",\"app_log_has_classification\":true,\"at\":\"$(date -u +%FT%TZ)\"}" "$SUMMARY"
    ;;
  *)
    fail "unknown_scenario"
    ;;
esac

log "PASS: $SCENARIO evidence=$DIR"
