"""Executor for CREATE_WORK_SEED."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _build_summary_content(result: JsonDict) -> str:
    work = result.get("work") or {}
    title = work.get("title", "")
    genre = work.get("genre", "")
    pitch = work.get("one_line_pitch", "")
    return "\n".join(
        [
            "## 已创建作品立项底稿",
            f"- 作品：《{title}》",
            f"- 题材：{genre}",
            f"- 一句话卖点：{pitch}",
            "- 已生成第一卷、第1章占位骨架，可继续推进角色或细纲。",
        ]
    )


class CreateWorkSeedExecutor(BaseExecutor):
    intent = "CREATE_WORK_SEED"

    def __init__(self, callback: Callable[..., JsonDict]):
        self._callback = callback

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        del context
        title = str(parameters.get("title") or "").strip()
        one_line_pitch = str(parameters.get("one_line_pitch") or "").strip()
        genre = str(parameters.get("genre") or "").strip()
        if not title or not one_line_pitch or not genre:
            missing = [
                name
                for name, value in (
                    ("title", title),
                    ("one_line_pitch", one_line_pitch),
                    ("genre", genre),
                )
                if not value
            ]
            return make_executor_result(
                handled=False,
                status="NEEDS_PARAMETERS",
                metadata={"missing": missing},
            )

        target_platform = str(parameters.get("target_platform") or "").strip() or "起点中文网"
        target_audience = str(parameters.get("target_audience") or "").strip() or "网文读者"

        try:
            result = self._callback(
                title=title,
                one_line_pitch=one_line_pitch,
                genre=genre,
                target_platform=target_platform,
                target_audience=target_audience,
            )
        except Exception as exc:
            return make_executor_result(
                handled=False,
                status="FAILED",
                metadata={"error": str(exc)},
            )

        work = result.get("work") or {}
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "work_seed",
                "intent": self.intent,
                "content": _build_summary_content(result),
                "workbench": result,
                "workId": work.get("id"),
            },
        )
