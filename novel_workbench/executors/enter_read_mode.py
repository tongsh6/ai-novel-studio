"""Executor for ENTER_READ_MODE."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _build_summary_content(result: JsonDict) -> str:
    work = result.get("work") or {}
    projection = result.get("readingProjection") or {}
    toc = projection.get("toc") or []
    return "\n".join(
        [
            "## 已进入阅读模式",
            f"- 作品：《{work.get('title', '')}》",
            f"- 章节数：{len(toc)}",
            "- 可在工作台查看章节目录与正文。",
        ]
    )


class EnterReadModeExecutor(BaseExecutor):
    intent = "ENTER_READ_MODE"

    def __init__(self, callback: Callable[..., JsonDict]):
        self._callback = callback

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        del parameters
        work = context.get("work") or {}
        work_id = str(work.get("id") or "").strip()
        if not work_id:
            return make_executor_result(
                handled=False,
                status="NEEDS_PARAMETERS",
                metadata={"missing": ["work_id"]},
            )
        try:
            result = self._callback(work_id=work_id)
        except Exception as exc:
            return make_executor_result(
                handled=False,
                status="FAILED",
                metadata={"error": str(exc)},
            )
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "read_mode",
                "intent": self.intent,
                "content": _build_summary_content(result),
                "readingProjection": result.get("readingProjection"),
                "work": result.get("work"),
            },
        )
