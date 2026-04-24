"""Executor for GENERATE_CHAPTER_OUTLINE."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _find_chapter(snapshot: JsonDict, chapter_id: str) -> JsonDict:
    for chapter in snapshot.get("chapters") or []:
        if chapter.get("id") == chapter_id:
            return chapter
    return {}


def _build_summary_content(snapshot: JsonDict, chapter_id: str) -> str:
    chapter = _find_chapter(snapshot, chapter_id)
    return "\n".join(
        [
            f"## 章节细纲已生成：{chapter.get('title', '')}",
            f"- 功能定位：{chapter.get('function', '') or '（待补充）'}",
            f"- 核心事件：{chapter.get('core_event', '') or '（待补充）'}",
            f"- 主要冲突：{chapter.get('conflict', '') or '（待补充）'}",
            f"- 摘要：{chapter.get('summary', '') or '（待补充）'}",
            f"- 章末钩子：{chapter.get('ending_hook', '') or '（待补充）'}",
        ]
    )


class GenerateChapterOutlineExecutor(BaseExecutor):
    intent = "GENERATE_CHAPTER_OUTLINE"

    def __init__(self, callback: Callable[..., JsonDict]):
        self._callback = callback

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        work = context.get("work") or {}
        work_id = str(work.get("id") or "").strip()
        chapter_id = str(parameters.get("chapter_id") or "").strip()
        if not (work_id and chapter_id):
            return make_executor_result(
                handled=False,
                status="NEEDS_PARAMETERS",
                metadata={"missing": [name for name, value in (("work_id", work_id), ("chapter_id", chapter_id)) if not value]},
            )
        try:
            snapshot = self._callback(
                work_id=work_id,
                chapter_id=chapter_id,
                instruction_text=str(parameters.get("instruction_text") or ""),
                rewrite_mode=str(parameters.get("rewrite_mode") or "default"),
            )
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
                "type": "chapter_outline",
                "intent": self.intent,
                "content": _build_summary_content(snapshot, chapter_id),
                "workbench": snapshot,
                "chapterId": chapter_id,
            },
        )
