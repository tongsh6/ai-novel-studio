"""Prompt builders for the three AI operations: outline / draft / revise."""

from __future__ import annotations

from typing import Any


JsonDict = dict[str, Any]

_OUTLINE_SYSTEM = """\
你是一位经验丰富的中文网络小说策划编辑。
你的任务是根据作品信息为指定章节生成结构化细纲。
请严格按照 JSON 格式输出，不要添加任何解释文字。
"""

_DRAFT_SYSTEM = """\
你是一位擅长中文网络小说的专业作家。
你的任务是根据章节细纲创作正文草稿。
直接输出正文内容，不要输出 JSON，不要输出标题行，不要添加任何说明文字。
正文应有节奏感，场景感强，人物行动和内心均衡，结尾留有钩子。
"""

_REVISE_SYSTEM = """\
你是一位中文网络小说专业编辑。
你的任务是根据修改要求对已有草稿进行修订。
直接输出修订后的完整正文，不要输出 JSON，不要重复修改要求，不要添加任何说明。
"""


def build_outline_messages(
    work: JsonDict,
    volume: JsonDict,
    chapter: JsonDict,
    outline: JsonDict | None,
    *,
    instruction_text: str = "",
    rewrite_mode: str = "default",
) -> list[dict[str, str]]:
    premise = outline["one_sentence_premise"] if outline else work.get("one_line_pitch", "")
    prior_summary = chapter.get("summary") or ""
    prior_function = chapter.get("function") or ""

    user_parts = [
        f"## 作品信息",
        f"- 标题：{work['title']}",
        f"- 一句话卖点：{work.get('one_line_pitch', '')}",
        f"- 题材：{work.get('genre', '')}",
        f"- 目标平台：{work.get('target_platform', '')}",
        f"- 故事前提：{premise}",
        "",
        f"## 当前卷",
        f"- 卷名：{volume.get('title', '')}",
        f"- 卷摘要：{volume.get('summary', '') or '（暂无）'}",
        "",
        f"## 待细化章节",
        f"- 章节名：{chapter['title']}",
        f"- 顺序：第 {chapter['order_no']} 章",
    ]
    if prior_function:
        user_parts.append(f"- 当前功能定位：{prior_function}")
    if prior_summary:
        user_parts.append(f"- 当前摘要：{prior_summary}")
    if instruction_text:
        user_parts += [
            "",
            f"## 本轮要求",
            f"{instruction_text}（执行模式：{rewrite_mode}）",
        ]

    user_parts += [
        "",
        "## 输出格式（严格 JSON，无其他文字）",
        (
            "```json\n"
            "{\n"
            '  "function": "本章在全书结构中的功能（一句话）",\n'
            '  "core_event": "本章核心事件（一句话）",\n'
            '  "conflict": "本章主要冲突或阻力",\n'
            '  "summary": "本章内容摘要（2-3句）",\n'
            '  "info_points": ["信息点1", "信息点2", "信息点3"],\n'
            '  "character_progress": "人物弧线在本章的推进",\n'
            '  "emotional_progress": "情绪节奏在本章的推进",\n'
            '  "worldbuilding_progress": "世界观信息在本章的露出方式",\n'
            '  "ending_hook": "章末钩子（一句话）"\n'
            "}\n"
            "```"
        ),
    ]

    return [
        {"role": "system", "content": _OUTLINE_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


def build_draft_messages(
    work: JsonDict,
    chapter: JsonDict,
    *,
    instruction_text: str = "",
    rewrite_mode: str = "default",
) -> list[dict[str, str]]:
    info_points: list[str] = []
    try:
        import json as _json
        raw = chapter.get("info_points_json") or "[]"
        info_points = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        info_points = []

    user_parts = [
        f"## 作品背景",
        f"- 标题：《{work['title']}》",
        f"- 一句话卖点：{work.get('one_line_pitch', '')}",
        f"- 题材：{work.get('genre', '')}",
        "",
        f"## 章节细纲：{chapter['title']}",
        f"- 功能定位：{chapter.get('function') or '推进主线'}",
        f"- 核心事件：{chapter.get('core_event') or '主角面临关键选择'}",
        f"- 主要冲突：{chapter.get('conflict') or '目标与阻力对撞'}",
        f"- 内容摘要：{chapter.get('summary') or ''}",
    ]
    if info_points:
        user_parts.append(f"- 信息点：{' / '.join(str(p) for p in info_points)}")
    user_parts += [
        f"- 人物进展：{chapter.get('character_progress') or ''}",
        f"- 情绪节奏：{chapter.get('emotional_progress') or ''}",
        f"- 世界观露出：{chapter.get('worldbuilding_progress') or ''}",
        f"- 章末钩子：{chapter.get('ending_hook') or ''}",
    ]
    if instruction_text:
        user_parts += [
            "",
            f"## 额外写作要求",
            f"{instruction_text}（执行模式：{rewrite_mode}）",
        ]
    user_parts += [
        "",
        "请根据以上细纲创作本章正文草稿，字数 1500-3000 字，直接输出正文。",
    ]

    return [
        {"role": "system", "content": _DRAFT_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


def build_revise_messages(
    work: JsonDict,
    chapter: JsonDict,
    base_draft: JsonDict,
    *,
    instruction_text: str = "",
    revise_mode: str = "revise_direct",
) -> list[dict[str, str]]:
    user_parts = [
        f"## 作品：《{work['title']}》 / 章节：{chapter['title']}",
        "",
        f"## 当前草稿（v{base_draft['version_no']}）",
        base_draft.get("text") or "",
        "",
        f"## 修改要求",
        instruction_text or "在保持主线不变的前提下，优化叙述节奏与语言表达。",
        f"（修订模式：{revise_mode}）",
        "",
        "请输出修订后的完整正文。",
    ]

    return [
        {"role": "system", "content": _REVISE_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]
