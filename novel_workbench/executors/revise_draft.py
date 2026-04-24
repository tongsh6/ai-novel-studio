"""Executor for REVISE_DRAFT."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _find_latest_draft(snapshot: JsonDict, chapter_id: str) -> JsonDict | None:
    drafts = snapshot.get("latestDrafts") or {}
    if isinstance(drafts, dict):
        value = drafts.get(chapter_id)
        if isinstance(value, dict):
            return value
    return None


def _find_chapter(snapshot: JsonDict, chapter_id: str) -> JsonDict:
    for chapter in snapshot.get("chapters") or []:
        if chapter.get("id") == chapter_id:
            return chapter
    return {}


def _build_summary_content(snapshot: JsonDict, chapter_id: str) -> str:
    chapter = _find_chapter(snapshot, chapter_id)
    draft = _find_latest_draft(snapshot, chapter_id) or {}
    version = draft.get("version_no") or draft.get("versionNo") or 0
    return "\n".join(
        [
            f"## 修订草稿 v{version} 已生成",
            f"- 章节：{chapter.get('title', '')}",
            "- 已基于上一版草稿完成修订，可在工作台查看。",
        ]
    )


class ReviseDraftExecutor(BaseExecutor):
    intent = "REVISE_DRAFT"

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
                revise_mode=str(parameters.get("revise_mode") or "revise_direct"),
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
                "type": "chapter_revise",
                "intent": self.intent,
                "content": _build_summary_content(snapshot, chapter_id),
                "workbench": snapshot,
                "chapterId": chapter_id,
            },
        )
