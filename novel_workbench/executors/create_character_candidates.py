"""Executor for CREATE_CHARACTER_CANDIDATES."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client, prompts

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


def _fallback_candidate_content(executor_context: JsonDict, parameters: JsonDict) -> str:
    work = executor_context.get("work") or {}
    title = work.get("title") or "当前作品"
    role_type = str(parameters.get("role_type") or "functional_role")
    count = int(parameters.get("candidate_count") or 3)
    blocks: list[str] = []
    for index in range(1, max(2, count) + 1):
        blocks.extend(
            [
                f"## 角色候选 {index}",
                f"- 姓名：候选角色{index}",
                f"- 身份：{title}中的{role_type}候选",
                "- 立场：立场未定，但可与主角形成互补或摩擦",
                "- 核心欲望：通过一次关键选择证明自己有资格进入主线",
                "- 性格关键词：克制、敏感、执行力强",
                "- 与当前剧情的连接点：可在当前剧情卡点处承担信息或冲突触发作用",
                "- 适合承担的功能位：推进冲突、补足信息、制造后续关系线",
                "- 可用戏剧张力：立场摇摆与个人欲望之间的冲突",
                "- 风险点：如果背景太重，会挤占当前主线节奏",
                "",
            ]
        )
    blocks.extend(
        [
            "## 综合建议",
            "- 最稳妥方案：选择功能位最清晰、背景最轻的一位先落场。",
            "- 最有张力方案：选择与主角目标暂时冲突、但长期可合作的一位。",
            "- 最适合后续展开方案：选择既能带新信息、又能接后续关系线的一位。",
        ]
    )
    return "\n".join(blocks)


class CreateCharacterCandidatesExecutor(BaseExecutor):
    intent = "CREATE_CHARACTER_CANDIDATES"

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        messages = prompts.build_create_character_candidates_messages(
            context,
            parameters=parameters,
        )
        try:
            content = llm_client.chat(messages, temperature=0.7, max_tokens=1200)
        except Exception:
            content = _fallback_candidate_content(context, parameters)
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "character_candidates",
                "intent": self.intent,
                "content": content,
                "parameters": parameters,
            },
        )
