"""Executor for SUMMARIZE_CURRENT_STATE."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client, prompts

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _fallback_summary_content(executor_context: JsonDict) -> str:
    work = executor_context.get("work") or {}
    chapters = executor_context.get("chapter_summaries") or []
    characters = executor_context.get("related_characters") or []
    latest_chapter = chapters[0] if chapters else {}
    character_names = ", ".join(
        str(item.get("name") or "").strip() for item in characters if str(item.get("name") or "").strip()
    ) or "暂无核心角色记录"
    return "\n".join(
        [
            "## 当前作品状态总结",
            "### 已确定内容",
            f"- 作品：{work.get('title', '')}",
            f"- 核心卖点：{work.get('one_line_pitch', '')}",
            "### 当前剧情进度",
            f"- 当前章节：{latest_chapter.get('title', '')} / 状态：{latest_chapter.get('status', '')}",
            f"- 当前摘要：{latest_chapter.get('summary', '')}",
            "### 核心角色现状",
            f"- 相关角色：{character_names}",
            "### 世界设定现状",
            f"- 当前题材边界：{work.get('genre', '')}",
            "### 主要未决问题",
            "- 关键冲突是否已经明确升级。",
            "- 角色目标是否与当前剧情节点充分绑定。",
            "### 推荐下一步",
            "- 若当前章未成型，优先确认下一步冲突推进方式。",
        ]
    )


class SummarizeCurrentStateExecutor(BaseExecutor):
    intent = "SUMMARIZE_CURRENT_STATE"

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        messages = prompts.build_summarize_current_state_messages(
            context,
            parameters=parameters,
        )
        try:
            content = llm_client.chat(messages, temperature=0.5, max_tokens=1000)
        except Exception:
            content = _fallback_summary_content(context)
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "state_summary",
                "intent": self.intent,
                "content": content,
                "parameters": parameters,
            },
        )
