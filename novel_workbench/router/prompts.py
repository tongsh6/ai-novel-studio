"""Prompt builders for the protocol-only Router layer."""

from __future__ import annotations

import json
from typing import Any


JsonDict = dict[str, Any]

_ROUTER_SYSTEM = """\
你不是小说创作助理。
你是“对话式小说工作台”的意图识别与参数提取器（Router）。

你的唯一职责：
1. 识别用户当前请求对应的唯一 intent
2. 从上下文与用户请求中提取 parameters
3. 判断是否存在信息缺失，并写入 missing_fields
4. 输出严格 JSON

你的禁止事项：
- 不得开始创作小说内容
- 不得生成角色设定正文、剧情正文、对白正文
- 不得寒暄
- 不得输出“好的，我会……”之类的执行承诺
- 不得输出 JSON 之外的任何内容

本阶段允许的 intent 只有：
- CREATE_CHARACTER_CANDIDATES
- REFINE_EXISTING_CHARACTER
- ADVANCE_PLOT
- SUMMARIZE_CURRENT_STATE
- OTHER

各 intent 的参数槽位如下：

CREATE_CHARACTER_CANDIDATES:
{
  "work_name": "",
  "plot_scope": "",
  "generation_target": "new_character_candidates",
  "candidate_count": null,
  "role_type": "",
  "selection_flow": "",
  "constraints": []
}

REFINE_EXISTING_CHARACTER:
{
  "work_name": "",
  "character_name": "",
  "refine_dimensions": [],
  "current_basis": "",
  "constraints": []
}

ADVANCE_PLOT:
{
  "work_name": "",
  "current_plot_scope": "",
  "advance_goal": "",
  "target_position": "",
  "constraints": []
}

SUMMARIZE_CURRENT_STATE:
{
  "work_name": "",
  "summary_scope": "",
  "summary_focus": []
}

输出 JSON 格式固定如下：
{
  "intent": "",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
"""


def build_router_messages(
    text: str,
    *,
    router_context: JsonDict | None = None,
) -> list[dict[str, str]]:
    router_context = router_context or {}
    work = router_context.get("work")
    chapter = router_context.get("chapter")
    characters = router_context.get("characters") or []
    minimal_context = router_context.get("minimal_context") or {}
    constraints = list(minimal_context.get("constraints") or [])
    if work and work.get("genre"):
        constraints = [*constraints, f"genre:{work['genre']}"]

    context_parts = [
        "## 当前最小上下文",
        f"- 当前作品：{minimal_context.get('work_name', '')}",
        f"- 当前剧情范围：{minimal_context.get('plot_scope', '')}",
        f"- 当前约束：{json.dumps(constraints, ensure_ascii=False)}",
    ]
    if chapter:
        context_parts.append(f"- 当前章节：{chapter['title']}（状态：{chapter['status']}）")
    if characters:
        names = [str(item.get("name") or "").strip() for item in characters]
        names = [name for name in names if name]
        if names:
            context_parts.append(f"- 已有角色：{', '.join(names)}")

    user_parts = [
        "\n".join(context_parts),
        "",
        "## 用户请求",
        text,
        "",
        "请识别意图并输出 JSON。",
    ]
    return [
        {"role": "system", "content": _ROUTER_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]
