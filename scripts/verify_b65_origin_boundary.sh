#!/usr/bin/env bash
# B65 隔离来源边界外部探针：启动 test-env Phoenix endpoint，外部 curl 构造
# 允许/拒绝 Origin 的 HTTP 与 WebSocket 握手；不进入产品业务写入。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${B65_PROBE_PORT:-4665}"
DIR="${B65_PROBE_DIR:-artifacts/slice-verify/b65-origin-boundary-probe}"
rm -rf "$DIR"; mkdir -p "$DIR"
SERVER_LOG="$DIR/server.log"
MIX_ENV=test PHOENIX_TEST_PORT="$PORT" mix run --no-start scripts/b65_origin_probe_server.exs >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/health"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "probe server exited" >&2; cat "$SERVER_LOG" >&2; exit 1; fi
  sleep 1
done
BASE="http://127.0.0.1:$PORT"
WS_URL="$BASE/socket/websocket?vsn=2.0.0"
KEY="dGhlIHNhbXBsZSBub25jZQ=="
ws_probe() {
  local origin="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 3 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H "Sec-WebSocket-Key: $KEY" -H "Origin: $origin" "$WS_URL" || true
}
http_get() {
  local origin="$1"
  curl -sS -D - -o /dev/null --max-time 3 -H "Origin: $origin" "$BASE/health" | tr -d '\r'
}
record() { printf '%s\n' "$1" >> "$DIR/curl-results.log"; }
record "ws_allowed_tauri=$(ws_probe 'tauri://localhost')"
record "ws_allowed_dev=$(ws_probe 'http://127.0.0.1:5769')"
record "ws_disallowed_prefix_spoof=$(ws_probe 'https://localhost.example.invalid')"
record "ws_disallowed_wrong_port=$(ws_probe 'http://127.0.0.1:6000')"
record "ws_disallowed_null=$(ws_probe 'null')"
record "http_allowed_headers_begin"
http_get 'tauri://localhost' >> "$DIR/curl-results.log"
record "http_allowed_headers_end"
record "http_disallowed_headers_begin"
http_get 'https://localhost.example.invalid' >> "$DIR/curl-results.log"
record "http_disallowed_headers_end"
# 机械判据：允许来源 101；拒绝来源 403；HTTP 允许有 ACAO，拒绝没有。
python3 - "$DIR/curl-results.log" <<'PY'
import sys
text=open(sys.argv[1]).read()
ws_allowed=text.count("ws_allowed_tauri=101") and text.count("ws_allowed_dev=101")
ws_rejected=all(f"=403" in line for line in text.splitlines() if line.startswith(("ws_disallowed_prefix_spoof","ws_disallowed_wrong_port","ws_disallowed_null")))
allow_block=text.split("http_allowed_headers_begin",1)[1].split("http_allowed_headers_end",1)[0].lower()
deny_block=text.split("http_disallowed_headers_begin",1)[1].split("http_disallowed_headers_end",1)[0].lower()
http_allow="access-control-allow-origin: tauri://localhost" in allow_block
http_deny="access-control-allow-origin" not in deny_block
ok=bool(ws_allowed and ws_rejected and http_allow and http_deny)
print(f"b65_probe_ok={str(ok).lower()} ws_allowed={bool(ws_allowed)} ws_rejected={bool(ws_rejected)} http_allow={http_allow} http_deny={http_deny}")
sys.exit(0 if ok else 1)
PY
echo "b65-origin-boundary-probe PASS dir=$DIR"
