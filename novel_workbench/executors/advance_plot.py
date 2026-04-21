"""Executor for ADVANCE_PLOT."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client, prompts

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _fallback_advance_plot_content(parameters: JsonDict) -> str:
    target = parameters.get("target_position") or "下一段有效冲突"
    goal = parameters.get("advance_goal") or "reasonable_next_progression"
    return "\n".join(
        [
            "## 剧情推进方案",
            "### 当前状态判断",
            "当前剧情已经具备继续推进的基础，但还缺一个更明确的冲突升级动作。",
            "### 下一步推进目标",
            f"围绕 {goal} 推进到 {target}。",
            "### 推荐推进路径",
            "1. 先让主角确认当前局面中最紧迫的问题。",
            "2. 再通过一个外部阻力把选择成本抬高。",
            "3. 最后把角色逼到必须立刻行动的节点。",
            "### 关键冲突点",
            "主角的短期选择与长期代价之间产生正面冲突。",
            "### 可选转折点",
            "让一个次要角色提前暴露立场，或让关键线索提前出现副作用。",
            "### 风险点",
            "如果补充过多新设定，可能冲淡当前节奏。",
            "### 建议优先方案",
            "优先选择能直接抬高冲突而不额外扩线的推进方式。",
        ]
    )


class AdvancePlotExecutor(BaseExecutor):
    intent = "ADVANCE_PLOT"

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        messages = prompts.build_advance_plot_messages(
            context,
            parameters=parameters,
        )
        try:
            content = llm_client.chat(messages, temperature=0.7, max_tokens=1200)
        except Exception:
            content = _fallback_advance_plot_content(parameters)
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "plot_advance",
                "intent": self.intent,
                "content": content,
                "parameters": parameters,
            },
        )
