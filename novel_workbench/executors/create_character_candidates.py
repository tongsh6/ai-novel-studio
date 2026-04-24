"""Executor for CREATE_CHARACTER_CANDIDATES."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client, prompts

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]
MAX_CONTINUATION_ROUNDS = 2


def _candidate_count(parameters: JsonDict) -> int:
    try:
        count = int(parameters.get("candidate_count") or 3)
    except (TypeError, ValueError):
        count = 3
    return max(2, min(5, count))


def _max_tokens_for_candidate_count(count: int) -> int:
    return min(1800, 700 + count * 350)


def _candidate_output_complete(content: str, count: int) -> bool:
    if "## 综合建议" not in content:
        return False
    for index in range(1, count + 1):
        if f"## 角色候选 {index}" not in content:
            return False
    required_advice = ("最稳妥方案", "最有张力方案", "最适合后续展开方案")
    return all(marker in content for marker in required_advice)


def _incomplete_reason(content: str, count: int, finish_reason: Any) -> str:
    if finish_reason == "length":
        return "length"
    if not _candidate_output_complete(content, count):
        return "missing_sections"
    return ""


def _build_continuation_messages(content: str, count: int) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "你是小说创作执行器。你的任务是补全上一轮被截断或结构不完整的角色候选输出。\n"
                "只输出缺失或未完成的后续部分，不要重复已经完整写出的候选，不要解释。"
            ),
        },
        {
            "role": "user",
            "content": "\n".join(
                [
                    f"候选总数：{count}",
                    "完整输出必须包含：",
                    *[f"- ## 角色候选 {index}" for index in range(1, count + 1)],
                    "- ## 综合建议",
                    "- 最稳妥方案",
                    "- 最有张力方案",
                    "- 最适合后续展开方案",
                    "",
                    "下面是已有输出，请从断点继续补完，只输出缺失部分：",
                    content[-5000:],
                ]
            ),
        },
    ]


def _fallback_candidate_content(executor_context: JsonDict, parameters: JsonDict) -> str:
    work = executor_context.get("work") or {}
    title = work.get("title") or "当前作品"
    role_type = str(parameters.get("role_type") or "functional_role")
    count = _candidate_count(parameters)
    blocks: list[str] = []
    for index in range(1, count + 1):
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
        count = _candidate_count(parameters)
        normalized_parameters = {
            **parameters,
            "candidate_count": count,
        }
        messages = prompts.build_create_character_candidates_messages(
            context,
            parameters=normalized_parameters,
        )
        metadata: JsonDict = {
            "candidate_count": count,
            "max_tokens_per_call": _max_tokens_for_candidate_count(count),
            "continuation_used": False,
            "generation_rounds": 0,
            "finish_reasons": [],
            "fallback_used": False,
        }
        try:
            completion = llm_client.chat_completion(
                messages,
                temperature=0.7,
                max_tokens=metadata["max_tokens_per_call"],
            )
            content = str(completion.get("content") or "").strip()
            finish_reason = completion.get("finish_reason")
            metadata["generation_rounds"] += 1
            metadata["finish_reasons"].append(finish_reason)
            metadata["finish_reason"] = finish_reason
            metadata["model"] = completion.get("model")
            incomplete_reason = _incomplete_reason(content, count, finish_reason)
            for _ in range(MAX_CONTINUATION_ROUNDS):
                if not incomplete_reason:
                    break
                metadata["continuation_used"] = True
                continuation = llm_client.chat_completion(
                    _build_continuation_messages(content, count),
                    temperature=0.4,
                    max_tokens=metadata["max_tokens_per_call"],
                )
                continuation_content = str(continuation.get("content") or "").strip()
                if continuation_content:
                    content = f"{content.rstrip()}\n{continuation_content.lstrip()}".strip()
                finish_reason = continuation.get("finish_reason")
                metadata["generation_rounds"] += 1
                metadata["finish_reasons"].append(finish_reason)
                metadata["finish_reason"] = finish_reason
                incomplete_reason = _incomplete_reason(content, count, finish_reason)

            if incomplete_reason:
                metadata["fallback_used"] = True
                metadata["fallback_reason"] = incomplete_reason
                content = _fallback_candidate_content(context, normalized_parameters)
        except Exception:
            metadata["fallback_used"] = True
            metadata["fallback_reason"] = "llm_error"
            content = _fallback_candidate_content(context, normalized_parameters)
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={
                "type": "character_candidates",
                "intent": self.intent,
                "content": content,
                "parameters": normalized_parameters,
            },
            metadata=metadata,
        )
