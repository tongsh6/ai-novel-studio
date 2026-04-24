"""Executor for DRAFT_CHAPTER."""

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
    version = draft.get("version_no") or draft.get("versionNo") or 1
    word_count = draft.get("word_count") or draft.get("wordCount") or 0
    return "\n".join(
        [
            f"## 正文草稿 v{version} 已生成",
            f"- 章节：{chapter.get('title', '')}",
            f"- 字数（估计）：{word_count}",
            "- 可在工作台中查看完整正文。",
        ]
    )


class DraftChapterExecutor(BaseExecutor):
    intent = "DRAFT_CHAPTER"

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
                "type": "chapter_draft",
                "intent": self.intent,
                "content": _build_summary_content(snapshot, chapter_id),
                "workbench": snapshot,
                "chapterId": chapter_id,
            },
        )
