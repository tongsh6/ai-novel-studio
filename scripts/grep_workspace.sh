#!/usr/bin/env bash
# VS-10 Observability Spine — 跨三源按 workspace_id 回溯 (ADR-0018 §5)
#
# Usage:
#   bash scripts/grep_workspace.sh <workspace_id>
#   bash scripts/grep_workspace.sh <workspace_id> --since 2026-05-11
#   bash scripts/grep_workspace.sh <workspace_id> --tail 20
#
set -euo pipefail

WS_ID="${1:?Usage: grep_workspace.sh <workspace_id> [--since YYYY-MM-DD] [--tail N]}"
shift

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="${2:-}"; shift 2 ;;
    --tail)  TAIL="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

echo "=== grep_workspace: ${WS_ID} ==="
echo ""

# ── 1. Business logs (log/app/**/*.jsonl) ────────

echo "── 1. 业务日志 (log/app/**/*.jsonl) ──"

APP_ROOT="${ROOT}/log/app"
if [[ -d "$APP_ROOT" ]]; then
  if command -v fd &>/dev/null; then
    FILES=$(fd -e jsonl . "$APP_ROOT" 2>/dev/null || true)
  else
    FILES=$(find "$APP_ROOT" -name '*.jsonl' -type f 2>/dev/null || true)
  fi
  if [[ -n "$FILES" ]]; then
    result=$(echo "$FILES" | xargs jq -c "select(.workspace_id == \"${WS_ID}\")" 2>/dev/null || true)
    if [[ -n "$TAIL" ]]; then
      echo "$result" | tail -n "$TAIL"
    else
      echo "$result"
    fi
  fi
else
  echo "  (no log/app/ directory)"
fi
echo ""

# ── 2. LLM call logs ────────────────────────────

echo "── 2. LLM 调用日志 ──"
echo "  LLMLog entries don't carry workspace_id directly — use grep_turn.sh"
echo "  with individual turn_ids found above."
echo ""

# ── 3. Decision traces (SQLite) ──────────────────

echo "── 3. Decision Trace (SQLite) ──"

DB=""
for candidate in \
  "${ROOT}/priv/ai_novel_studio_dev.db" \
  "${ROOT}/priv/ai_novel_studio_stage.db"; do
  [[ -f "$candidate" ]] && DB="$candidate" && break
done

if [[ -n "$DB" ]]; then
  sqlite3 "$DB" \
    "SELECT trace_id, turn_id, decision_type, event_order, inserted_at
     FROM decision_traces
     WHERE workspace_id = '${WS_ID}'
     ORDER BY inserted_at DESC
     LIMIT ${TAIL:-50};" 2>/dev/null || echo "  (query failed or table doesn't exist)"
else
  echo "  (no database file found)"
fi
echo ""

echo "=== done ==="
