#!/usr/bin/env bash
# VS-10 Observability Spine — 跨三源按 turn_id 回溯 (ADR-0018 §5)
#
# Usage:
#   bash scripts/grep_turn.sh <turn_id>
#   bash scripts/grep_turn.sh <turn_id> --only app
#   bash scripts/grep_turn.sh <turn_id> --since 2026-05-11
#
set -euo pipefail

TURN_ID="${1:?Usage: grep_turn.sh <turn_id> [--only app|llm|trace] [--since YYYY-MM-DD]}"
shift

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ONLY=""
SINCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --since) SINCE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

echo "=== grep_turn: ${TURN_ID} ==="
echo ""

# ── 1. Business logs (log/app/**/*.jsonl) ────────

if [[ "$ONLY" == "" || "$ONLY" == "app" ]]; then
  echo "── 1. 业务日志 (log/app/**/*.jsonl) ──"

  APP_ROOT="${ROOT}/log/app"
  if [[ -d "$APP_ROOT" ]]; then
    if command -v fd &>/dev/null; then
      FILES=$(fd -e jsonl . "$APP_ROOT" 2>/dev/null || true)
    else
      FILES=$(find "$APP_ROOT" -name '*.jsonl' -type f 2>/dev/null || true)
    fi
    if [[ -n "$FILES" ]]; then
      echo "$FILES" | xargs jq -c "select(.turn_id == \"${TURN_ID}\")" 2>/dev/null || true
    fi
  else
    echo "  (no log/app/ directory)"
  fi
  echo ""
fi

# ── 2. LLM call logs (log/llm-calls/**/*.jsonl) ──

if [[ "$ONLY" == "" || "$ONLY" == "llm" ]]; then
  echo "── 2. LLM 调用日志 (log/llm-calls/**/*.jsonl) ──"

  LLM_ROOT="${ROOT}/log/llm-calls"
  if [[ -d "$LLM_ROOT" ]]; then
    if command -v fd &>/dev/null; then
      FILES=$(fd -e jsonl . "$LLM_ROOT" 2>/dev/null || true)
    else
      FILES=$(find "$LLM_ROOT" -name '*.jsonl' -type f 2>/dev/null || true)
    fi
    if [[ -n "$FILES" ]]; then
      echo "$FILES" | xargs jq -c "select(.turn_id == \"${TURN_ID}\")" 2>/dev/null || true
    fi
  else
    echo "  (no log/llm-calls/ directory)"
  fi
  echo ""
fi

# ── 3. Decision traces (SQLite, best-effort) ──────

if [[ "$ONLY" == "" || "$ONLY" == "trace" ]]; then
  echo "── 3. Decision Trace (SQLite decision_traces) ──"

  DB=""
  for candidate in \
    "${ROOT}/priv/ai_novel_studio_dev.db" \
    "${ROOT}/priv/ai_novel_studio_stage.db"; do
    [[ -f "$candidate" ]] && DB="$candidate" && break
  done

  if [[ -n "$DB" ]]; then
    sqlite3 "$DB" \
      "SELECT trace_id, turn_id, decision_type, no_tool_reason, event_order, inserted_at
       FROM decision_traces
       WHERE turn_id = '${TURN_ID}'
       ORDER BY inserted_at;" 2>/dev/null || echo "  (query failed or table doesn't exist)"
  else
    echo "  (no database file found)"
  fi
  echo ""
fi

echo "=== done ==="
