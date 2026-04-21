"""Shared result helpers for executors."""

from __future__ import annotations

from typing import Any


JsonDict = dict[str, Any]


def make_executor_result(
    *,
    handled: bool,
    status: str = "NOOP",
    action_result: Any = None,
    reply_prefix: str = "",
    reply_override: str = "",
    metadata: JsonDict | None = None,
) -> JsonDict:
    return {
        "handled": handled,
        "status": status,
        "actionResult": action_result,
        "replyPrefix": reply_prefix,
        "replyOverride": reply_override,
        "metadata": metadata or {},
    }
