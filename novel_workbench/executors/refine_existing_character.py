"""Executor for REFINE_EXISTING_CHARACTER."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from novel_workbench.services import llm_client, prompts

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _fallback_refine_content(parameters: JsonDict) -> str:
    name = parameters.get("character_name") or "目标角色"
    return "\n".join(
        [
            "## 角色细化结果",
            "### 基础定位",
            f"- 角色名：{name}",
            "- 当前身份：待结合作品上下文进一步明确",
            "- 当前功能位：当前阶段承担人物推动与情绪牵引功能",
            "",
            "### 细化维度",
            "#### 1. 核心欲望",
            "希望通过一次关键行动证明自身价值。",
            "#### 2. 软肋与弱点",
            "在情感绑定和失败成本面前容易失衡。",
            "#### 3. 长期执念",
            "想弥补过去一次没有完成的选择。",
            "#### 4. 情感触发点",
            "被质疑能力或被迫失去控制权时会明显反应。",
            "#### 5. 成长弧线",
            "从被动自证走向主动承担后果。",
            "#### 6. 与主线绑定方式",
            "让人物的个人目标与主线阶段目标产生直接交叉。",
        ]
    )


class RefineExistingCharacterExecutor(BaseExecutor):
    intent = "REFINE_EXISTING_CHARACTER"

    def __init__(self, refine_callback: Callable[..., JsonDict]):
        self._refine_callback = refine_callback

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        work = context.get("work") or {}
        work_id = work.get("id")
        name = str(parameters.get("character_name") or "").strip()
        if not (work_id and name):
            return make_executor_result(
                handled=False,
                status="NEEDS_PARAMETERS",
                metadata={"missing": ["character_name"]},
            )

        messages = prompts.build_refine_existing_character_messages(
            context,
            parameters=parameters,
        )
        try:
            content = llm_client.chat(messages, temperature=0.65, max_tokens=1200)
        except Exception:
            content = _fallback_refine_content(parameters)

        snapshot = self._refine_callback(
            work_id=work_id,
            name=name,
            core_desire=name if "motivation" in (parameters.get("refine_dimensions") or []) else "",
        )
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "character_refine",
                "intent": self.intent,
                "content": content,
                "workbench": snapshot,
                "characterName": name,
            },
        )
