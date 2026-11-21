#!/usr/bin/env bash
# SU04/B85：真实 release 唯一生命周期 owner；UI 场景不拥有启动/退出/cleanup。
# Design: tasks/slices/B85-model-context-window-settings.md §6
# 无模型生成；保留完整隔离 HOME 与失败证据；只清理已核验的 owned PID。
set -euo pipefail
export LC_ALL=C
# 同一 owner 的纯 phase 参数构造出口，供实际 phase() 与独立契约测试共同消费。
# 此分支不创建目录、不观察桌面、不启动任何应用。
if [[ "${1:-}" == --phase-input ]]; then
  shift
  node -e 'const [phase,case_id,provider,window,current,saved,source,prefs,provider_label]=process.argv.slice(1);const x={phase,case_id,provider,provider_label,preferences_path:prefs};for(const [k,v]of [["window",window],["expected_current",current],["expected_saved",saved]])if(v!=="")x[k]=v==="null"?null:v==="unknown"?"unknown":Number(v);if(phase==="invalid")x.window=window;if(source)x.expected_source=source==="null"?null:source;console.log(JSON.stringify(x,null,2))' "$@"
  exit
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCENARIO="${1:-}"
APP="${SU04_APP_PATH:-$ROOT/frontend/src-tauri/target/release/bundle/macos/AI Novel Studio.app}"
PORT="${SU04_SIDECAR_PORT:-4658}"
PROFILE="${SU04_PROFILE:-release-verify}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
DIR="$ROOT/artifacts/slice-verify/su04-release-app/${SCENARIO:-unknown}-$STAMP"
HOME_DIR="$DIR/home"
GEN=0
GEN_DIR=""
OWN=""
APP_PID=""
OCCUPIER_PID=""
OCCUPIER_OWN=""
CLEANED=0
OBS="$ROOT/scripts/lib/native_ui/process_observation.mjs"
UI="$ROOT/scripts/native_b85_context_window_drive.mjs"
case "$SCENARIO" in cold-start|exit-no-orphan|port-conflict|bad-archive|b85-context-window) ;; *)
  echo "usage: $0 <cold-start|exit-no-orphan|port-conflict|bad-archive|b85-context-window>" >&2; exit 64;; esac
mkdir -p "$HOME_DIR"
log() { printf '[release] %s\n' "$*"; }
json_event() {
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1],JSON.stringify({at:new Date().toISOString(),status:process.argv[2],reason:process.argv[3]},null,2))' "$1" "$2" "$3"
}
observe() { node "$OBS" "$@"; }
refresh() { [[ -n "$OWN" && -f "$OWN" ]] && observe refresh "$OWN" >/dev/null; }
remaining() { observe remaining "$OWN" "${1:-all}"; }
port_pids() {
  local out rc
  if out="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)"; then printf '%s' "$out"; else
    rc=$?; [[ "$rc" == 1 ]] || return "$rc"
  fi
}
cleanup() {
  [[ "$CLEANED" == 0 ]] || return 0
  CLEANED=1
  local failed=0
  if [[ -n "$APP_PID" && ( -z "$OWN" || ! -f "$OWN" ) ]]; then
    failed=1
    json_event "$DIR/unresolved-spawn.json" unknown "spawned_pid_${APP_PID}_identity_not_registered_no_signal_sent"
  fi
  if [[ -n "$OCCUPIER_PID" && ( -z "$OCCUPIER_OWN" || ! -f "$OCCUPIER_OWN" ) ]]; then
    failed=1
    json_event "$DIR/unresolved-occupier.json" unknown "spawned_pid_${OCCUPIER_PID}_identity_not_registered_no_signal_sent"
  fi
  if [[ -n "$OWN" && -f "$OWN" ]]; then
    refresh || failed=1
    observe signal "$OWN" SIGTERM all >"$GEN_DIR/cleanup-term.json" || failed=1
    sleep 1
    observe signal "$OWN" SIGKILL all >"$GEN_DIR/cleanup-kill.json" || failed=1
    observe remaining "$OWN" all >"$GEN_DIR/cleanup-remaining.json" || failed=1
    [[ "$(cat "$GEN_DIR/cleanup-remaining.json" 2>/dev/null)" == "[]" ]] || failed=1
  fi
  if [[ -n "$OCCUPIER_OWN" && -f "$OCCUPIER_OWN" ]]; then
    observe signal "$OCCUPIER_OWN" SIGTERM all >"$DIR/occupier-cleanup.json" || failed=1
    for _ in $(seq 1 20); do
      [[ "$(observe remaining "$OCCUPIER_OWN" all)" == "[]" ]] && break
      sleep .1
    done
    observe signal "$OCCUPIER_OWN" SIGKILL all >"$DIR/occupier-cleanup-kill.json" || failed=1
    if [[ "$(observe remaining "$OCCUPIER_OWN" all)" == "[]" ]]; then
      wait "$OCCUPIER_PID" 2>/dev/null || true
    else
      failed=1
    fi
    observe remaining "$OCCUPIER_OWN" all >"$DIR/occupier-cleanup-remaining.json" || failed=1
  fi
  # 不删除 HOME、profile、快照、日志；失败现场本身也是需保留的用户证据。
  json_event "$DIR/cleanup.json" "$([[ $failed == 0 ]] && echo pass || echo fail)" "owned_processes_only"
  return "$failed"
}
fail() { json_event "$DIR/failure.json" fail "$1"; log "FAIL: $1"; exit 1; }
trap 'cleanup || true' EXIT
[[ "$PORT" == 4658 ]] || fail release_port_must_match_product_4658
[[ -d "$APP" && -x "$APP/Contents/MacOS/app" ]] || fail missing_release_bundle
[[ -f "$APP/Contents/Resources/sidecar.tar.gz" ]] || fail missing_bundled_sidecar
[[ -z "$(port_pids)" ]] || fail port_already_in_use_before_start
bash "$ROOT/scripts/lib/native_ui/build.sh" >"$DIR/native-helper-build.txt"
shasum -a 256 "$APP/Contents/MacOS/app" "$APP/Contents/Resources/sidecar.tar.gz" >"$DIR/build-hashes.txt"
git -C "$ROOT" rev-parse HEAD >"$DIR/head.txt"
git -C "$ROOT" status --short >"$DIR/source-status.txt"

wait_empty() {
  local scope="${1:-all}" i
  for i in $(seq 1 100); do
    refresh
    [[ "$(remaining "$scope")" == "[]" ]] && return 0
    sleep .2
  done
  return 1
}
start_app() {
  local profile="$1" archive_fault="${2:-no}"
  if [[ "$SCENARIO" == port-conflict ]]; then
    [[ "$(port_pids)" == "$OCCUPIER_PID" ]] || fail conflict_listener_not_owned
  else
    [[ -z "$(port_pids)" ]] || fail port_not_free_before_launch
  fi
  GEN=$((GEN+1)); GEN_DIR="$DIR/generation-$GEN"; mkdir -p "$GEN_DIR"
  local copy="$GEN_DIR/AI Novel Studio.app"
  local need_kb free_kb
  need_kb="$(du -sk "$APP" | awk '{print $1}')"
  free_kb="$(df -Pk "$GEN_DIR" | tail -1 | awk '{print $4}')"
  [[ "$free_kb" -gt $((need_kb+1048576)) ]] || fail insufficient_space_for_evidence_bundle
  cp -R "$APP" "$copy"
  shasum -a 256 "$copy/Contents/MacOS/app" "$copy/Contents/Resources/sidecar.tar.gz" >"$GEN_DIR/build-hashes.txt"
  cmp "$APP/Contents/MacOS/app" "$copy/Contents/MacOS/app" || fail executable_copy_mismatch
  cmp "$APP/Contents/Resources/sidecar.tar.gz" "$copy/Contents/Resources/sidecar.tar.gz" || fail sidecar_copy_mismatch
  if [[ "$archive_fault" == yes ]]; then printf 'invalid-isolated-archive' >"$copy/Contents/Resources/sidecar.tar.gz"; fi
  OWN="$GEN_DIR/owned-processes.json"
  PROFILE="$profile"
  node -e 'const fs=require("fs");const [d,h,p,w]=process.argv.slice(1);fs.writeFileSync(d+"/launch-input.json",JSON.stringify({HOME:h,AI_NOVEL_DESKTOP_PROFILE:p||null,NOVEL_CONTEXT_WINDOW_OVERRIDES:w||null,note:"explicit_parent_input_not_child_env_observation"},null,2))' "$GEN_DIR" "$HOME_DIR" "$profile" "${B85_INHERITED_WINDOW:-}"
  local -a launch_env
  launch_env=(env -u AI_NOVEL_DESKTOP_PROFILE -u NOVEL_CONTEXT_WINDOW_OVERRIDES "HOME=$HOME_DIR")
  [[ -z "$profile" ]] || launch_env+=("AI_NOVEL_DESKTOP_PROFILE=$profile")
  [[ -z "${B85_INHERITED_WINDOW:-}" ]] || launch_env+=("NOVEL_CONTEXT_WINDOW_OVERRIDES=$B85_INHERITED_WINDOW")
  "${launch_env[@]}" "$copy/Contents/MacOS/app" >"$GEN_DIR/app.out" 2>&1 &
  APP_PID=$!
  json_event "$GEN_DIR/spawn-receipt.json" unverified "direct_child_pid_${APP_PID}_parent_$$"
  # 初始化只能接受本 shell 直接 child 的 PID + exact exec；失败不按应用名寻找替身。
  local ok=0
  for _ in $(seq 1 20); do
    if observe init "$OWN" "$APP_PID" "$$" "$copy/Contents/MacOS/app" "$HOME_DIR" "$profile" >"$GEN_DIR/start-identity.json" 2>"$GEN_DIR/start-observation-error.txt"; then ok=1; break; fi
    sleep .1
  done
  [[ $ok == 1 ]] || fail child_identity_not_proven
  node -e 'const fs=require("fs"); const [dir,pid]=process.argv.slice(1);fs.writeFileSync(dir+"/native-driver-ready.json",JSON.stringify({driver:"external-system-ui",run_ref:dir.split("/").slice(-2).join("-"),bundle_identifier:"com.ai-novel-studio.app",native_executable:"app",app_path:dir+"/AI Novel Studio.app",app_pid:Number(pid),web_url:"http://127.0.0.1:4658"},null,2))' "$GEN_DIR" "$APP_PID"
}
wait_backend() {
  for _ in $(seq 1 300); do
    refresh
    if [[ -n "$(port_pids)" ]]; then
      observe listener "$OWN" "$PORT" >"$GEN_DIR/listener-identity.json" || fail listener_not_owned
      return 0
    fi
    [[ "$(remaining)" != "[]" ]] || fail app_exited_before_ready
    sleep .2
  done
  fail sidecar_not_ready
}
phase() {
  local name="$1" case_id="$2" window="${3:-}" current="${4:-}" saved="${5:-}" source="${6:-}"
  refresh
  local input
  input="$(bash "$ROOT/scripts/release_app_lifecycle_check.sh" --phase-input "$name" "$case_id" "${PROVIDER:-}" "$window" "$current" "$saved" "$source" "${PREFS:-}" "${PROVIDER_LABEL:-}")"
  node -e 'const fs=require("fs");const [dir,id,s]=process.argv.slice(1);fs.writeFileSync(dir+"/b85-input-"+id+".json",s,{flag:"wx"});fs.writeFileSync(dir+"/b85-phase-input.json",s)' "$GEN_DIR" "$case_id" "$input"
  node "$UI" "$GEN_DIR" "$name" || fail "ui_phase_failed:$case_id"
  refresh
}
exit_app() {
  # 真实 close 由同一个精确 target UI 输入边界执行，绝不按 process name。
  phase close "close-$GEN"
  wait_empty all || fail normal_close_left_owned_processes
  [[ -z "$(port_pids)" ]] || fail port_not_released_after_normal_close
  cp "$OWN" "$GEN_DIR/normal-exit-processes.json"
  json_event "$GEN_DIR/normal-exit.json" pass bound_ax_close
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
}
preferences_path() {
  local base="$HOME_DIR/Library/Application Support/com.ai-novel-studio.app"
  [[ -z "$PROFILE" ]] || base="$base/profiles/$PROFILE"
  printf '%s/preferences.json' "$base"
}
options() {
  refresh
  observe listener "$OWN" "$PORT" >"$GEN_DIR/listener-$1.json" || fail "options_listener_not_owned:$1"
  curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/provider/options" |
    node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const o=JSON.parse(s);console.log(JSON.stringify({current_provider:o.current_provider,providers:o.providers.map(p=>({id:p.id,label:p.label,context_window:p.context_window}))},null,2))})' >"$GEN_DIR/options-$1.json"
}
b85_baseline() {
  wait_backend; PREFS="$(preferences_path)"
  options baseline
  read -r PROVIDER CURRENT DEFAULT SOURCE < <(node -e 'const o=require(process.argv[1]);const p=o.providers.find(p=>p.id===o.current_provider);if(!p?.context_window)throw Error("missing_runtime_window");const w=p.context_window;console.log(p.id,w.effective_tokens,w.default_tokens,w.source)' "$GEN_DIR/options-baseline.json")
  [[ -n "$CURRENT" ]] || fail missing_current_window
  PROVIDER_LABEL="$(node -e 'const o=require(process.argv[1]);const ps=o.providers.filter(p=>p.id===o.current_provider);if(ps.length!==1||typeof ps[0].label!=="string"||!ps[0].label.trim()||o.providers.filter(p=>p.label===ps[0].label).length!==1)throw Error("provider_label_not_unique");console.log(ps[0].label)' "$GEN_DIR/options-baseline.json")" || fail provider_label_not_unique
}
assert_runtime() {
  local label="$1" expected="$2"
  options "$label"
  node -e 'const o=require(process.argv[1]);const p=o.providers.find(p=>p.id===process.argv[2]);if(o.current_provider!==process.argv[2]||p.context_window.effective_tokens!==Number(process.argv[3]))throw Error("runtime_or_provider_changed")' "$GEN_DIR/options-$label.json" "$PROVIDER" "$expected" || fail "runtime_mismatch:$label"
}
case "$SCENARIO" in
  cold-start|exit-no-orphan)
    start_app "$PROFILE"; wait_backend
    find "$HOME_DIR" -name .install-complete -type f >"$GEN_DIR/install-markers.txt"
    [[ -s "$GEN_DIR/install-markers.txt" ]] || fail install_marker_missing
    exit_app
    ;;
  port-conflict)
    # 占用者由本 shell 创建，身份同样记录，不把任何原有 listener 当作可清理对象。
    python3 -m http.server "$PORT" --bind 127.0.0.1 >"$DIR/occupier.out" 2>&1 &
    OCCUPIER_PID=$!; OCCUPIER_OWN="$DIR/occupier-owned.json"
    json_event "$DIR/occupier-spawn-receipt.json" unverified "direct_child_pid_${OCCUPIER_PID}_parent_$$"
    sleep .2
    occupier_exec="$("$ROOT/artifacts/tools/ax_cua" process-path "$OCCUPIER_PID" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).executable))')"
    observe init "$OCCUPIER_OWN" "$OCCUPIER_PID" "$$" "$occupier_exec" "$HOME_DIR" "" >"$DIR/occupier-identity.json"
    start_app "$PROFILE"
    for _ in $(seq 1 150); do refresh; sleep .2; done
    [[ "$(port_pids)" == "$OCCUPIER_PID" ]] || fail conflict_occupier_changed
    [[ "$(remaining sidecar)" == "[]" ]] || fail conflict_left_sidecar
    phase close "close-$GEN"
    wait_empty all || fail conflict_app_did_not_close
    [[ "$(port_pids)" == "$OCCUPIER_PID" ]] || fail conflict_killed_occupier
    ;;
  bad-archive)
    start_app "$PROFILE" yes
    for _ in $(seq 1 100); do refresh; sleep .2; done
    [[ -z "$(port_pids)" ]] || fail invalid_archive_bound_port
    [[ -z "$(find "$HOME_DIR" -name .install-complete -type f)" ]] || fail invalid_archive_installed
    grep -qiE 'sidecar|archive|安装|失败|failed' "$GEN_DIR/app.out" || fail missing_archive_error
    exit_app
    ;;
  b85-context-window)
    # A named / B 真 unset；所有调用仅设置 UI，不调用模型。
    start_app b85-window; b85_baseline
    A_BASE="$CURRENT"; A_VALUE=$((CURRENT+1234))
    [[ "$CURRENT" == "$DEFAULT" && "$SOURCE" == conservative_default ]] || fail initial_runtime_not_default
    phase snapshot baseline "" "$CURRENT" null conservative_default
    phase cancel cancel "$A_VALUE" "$CURRENT" null "$SOURCE"
    phase invalid invalid 0 "$CURRENT" null "$SOURCE"
    phase save save "$A_VALUE" "$CURRENT" "$A_VALUE" "$SOURCE"
    phase repeat repeat "$A_VALUE" "$CURRENT" "$A_VALUE" "$SOURCE"
    assert_runtime saved-still-old "$A_BASE"
    exit_app
    start_app b85-window; b85_baseline
    assert_runtime restarted "$A_VALUE"
    phase snapshot restarted "" "$A_VALUE" "$A_VALUE" runtime_override
    exit_app
    start_app ""; b85_baseline
    [[ "$CURRENT" == "$DEFAULT" ]] || fail unset_profile_leaked_named_override
    B_VALUE=$((CURRENT+2345))
    phase save unset-save "$B_VALUE" "$CURRENT" "$B_VALUE" "$SOURCE"
    exit_app
    start_app ""; b85_baseline
    assert_runtime unset-restarted "$B_VALUE"
    phase snapshot unset-restarted "" "$B_VALUE" "$B_VALUE" runtime_override
    exit_app
    start_app b85-window; b85_baseline
    assert_runtime named-preserved "$A_VALUE"
    phase clear clear "" "$A_VALUE" null runtime_override
    assert_runtime clear-still-old "$A_VALUE"
    exit_app
    start_app b85-window; b85_baseline
    assert_runtime cleared-restarted "$DEFAULT"
    phase snapshot cleared-restarted "" "$DEFAULT" null conservative_default
    exit_app
    # 独立继承 env + 偏好空值的真实 release 启动，证明清空不必然回默认。
    B85_INHERITED_WINDOW="$PROVIDER:$A_VALUE"
    start_app b85-window; b85_baseline
    assert_runtime inherited "$A_VALUE"
    phase snapshot inherited "" "$A_VALUE" null runtime_override
    unset B85_INHERITED_WINDOW
    # 坏 prefs 保存是独立文件故障，原文件备份/失败原字节全部保留。
    cp "$PREFS" "$GEN_DIR/preferences-before-corrupt.backup"
    printf '{invalid-json' >"$PREFS"
    phase save-failure corrupt-save "$B_VALUE" "$A_VALUE" unknown runtime_override
    cmp "$PREFS" <(printf '{invalid-json') || fail corrupted_preferences_overwritten
    cp "$PREFS" "$GEN_DIR/preferences-failure-preserved.json"
    cp "$GEN_DIR/preferences-before-corrupt.backup" "$PREFS"
    # 最后一阶段只终止已证明的 sidecar；不是正常 close 的替代证据。
    refresh
    observe signal "$OWN" SIGTERM sidecar >"$GEN_DIR/runtime-fault-actions.json"
    wait_empty sidecar || fail owned_sidecar_fault_not_stopped
    phase runtime-unavailable runtime-unavailable "$B_VALUE" null null null
    # 故障阶段 app 最终 close；前面各正常退出证据不可由此阶段代签。
    exit_app
    ;;
esac
cleanup || fail owned_cleanup_failed
json_event "$DIR/summary.json" pass "$SCENARIO"
log "PASS: $SCENARIO evidence=$DIR"
