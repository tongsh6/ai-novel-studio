"""Prompt builders for legacy chat routing and chapter/new-intent generation flows."""

from __future__ import annotations

from typing import Any


JsonDict = dict[str, Any]
_LEGACY_INTENT_SYSTEM = """\
你是一位专业的小说创作助理，负责与作者对话并协助其在“对话式小说工作台”中推进创作。
你的任务是：
1. 分析作者的输入意图。
2. 给出亲切、专业的回复。
3. 如果作者的要求涉及具体的创作动作，提取出相应的参数。

## 意图列表 (intent)
- CREATE_WORK: 创建/立项新作品。参数: title, oneLinePitch, genre
- REFINE_CHARACTER: 创建或更新角色设定。参数: name, identity, coreDesire, roleType
- GENERATE_OUTLINE: 为当前章节生成细纲。参数: instructionText
- GENERATE_DRAFT: 为当前章节生成或修订正文草稿。参数: instructionText
- ENTER_READ_MODE: 切换到阅读模式。
- UNKNOWN: 闲聊或无法识别的指令。

## 输出格式（严格 JSON，无其他文字）
```json
{
  "reply": "你对作者的自然语言回复",
  "intent": "上述意图之一",
  "parameters": {
    "key": "value"
  }
}
```
"""


def build_intent_messages(
    text: str,
    *,
    work: JsonDict | None = None,
    chapter: JsonDict | None = None,
    characters: list[JsonDict] | None = None,
) -> list[dict[str, str]]:
    context_parts = ["## 当前上下文"]
    if work:
        context_parts.append(f"- 当前作品：《{work['title']}》")
        context_parts.append(f"- 卖点：{work.get('one_line_pitch', '')}")
    if chapter:
        context_parts.append(f"- 当前章节：{chapter['title']} (状态: {chapter['status']})")
    if characters:
        char_names = [c["name"] for c in characters]
        context_parts.append(f"- 已有角色：{', '.join(char_names)}")

    user_parts = [
        "\n".join(context_parts),
        "",
        f"作者说：\"{text}\"",
        "",
        "请分析意图并给出 JSON 响应。",
    ]

    return [
        {"role": "system", "content": _LEGACY_INTENT_SYSTEM},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


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


def _render_executor_context_block(executor_context: JsonDict) -> str:
    work = executor_context.get("work") or {}
    active_chapter = executor_context.get("active_chapter") or {}
    outline = executor_context.get("outline") or {}
    chapters = executor_context.get("chapter_summaries") or []
    characters = executor_context.get("related_characters") or []
    decisions = executor_context.get("recent_decisions") or []

    chapter_lines = [
        f"- {chapter.get('title', '')}：{chapter.get('summary', '') or chapter.get('status', '')}"
        for chapter in chapters[:5]
    ] or ["- 暂无章节摘要"]
    character_lines = [
        f"- {character.get('name', '')}：{character.get('identity', '') or character.get('current_state', '')}"
        for character in characters[:5]
    ] or ["- 暂无相关角色信息"]
    decision_lines = [
        f"- {decision.get('title', '')}：{decision.get('decision', '')}"
        for decision in decisions[:3]
    ] or ["- 暂无最近决策"]

    return "\n".join(
        [
            "## 当前作品信息",
            f"- 作品名：{work.get('title', '')}",
            f"- 核心卖点：{work.get('one_line_pitch', '')}",
            f"- 风格边界：{work.get('genre', '')}",
            f"- 当前章节：{active_chapter.get('title', '')}",
            f"- 主线前提：{outline.get('one_sentence_premise', '')}",
            "",
            "## 相关剧情摘要",
            *chapter_lines,
            "",
            "## 相关角色信息",
            *character_lines,
            "",
            "## 最近决策",
            *decision_lines,
        ]
    )


def build_create_character_candidates_messages(
    executor_context: JsonDict,
    *,
    parameters: JsonDict,
) -> list[dict[str, str]]:
    system = """\
你是小说创作执行器。
当前任务是：基于当前剧情与约束，生成新的角色候选。

要求：
1. 输出多个候选角色，而不是只输出一个
2. 每个候选必须服务当前剧情
3. 每个候选必须有明确功能位
4. 不要替作者拍板，只给候选与比较
5. 请严格按指定格式输出
"""
    user = "\n".join(
        [
            "## 当前任务",
            f"- intent: CREATE_CHARACTER_CANDIDATES",
            f"- parameters: {parameters}",
            "",
            _render_executor_context_block(executor_context),
            "",
            "## 当前任务要求",
            f"- 候选数量：{parameters.get('candidate_count')}",
            f"- 角色类型：{parameters.get('role_type')}",
            f"- 额外限制：{parameters.get('constraints')}",
            "",
            "请按如下结构输出：",
            "## 角色候选 1",
            "- 姓名：",
            "- 身份：",
            "- 立场：",
            "- 核心欲望：",
            "- 性格关键词：",
            "- 与当前剧情的连接点：",
            "- 适合承担的功能位：",
            "- 可用戏剧张力：",
            "- 风险点：",
            "",
            "## 综合建议",
            "- 最稳妥方案：",
            "- 最有张力方案：",
            "- 最适合后续展开方案：",
        ]
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_refine_existing_character_messages(
    executor_context: JsonDict,
    *,
    parameters: JsonDict,
) -> list[dict[str, str]]:
    system = """\
你是小说创作执行器。
当前任务是：细化已有角色设定。

要求：
1. 只围绕指定角色展开
2. 只补强，不随意改写人物根基
3. 聚焦指定 refine_dimensions
4. 强调角色推动力、冲突潜力和主线绑定
5. 请按指定格式输出
"""
    user = "\n".join(
        [
            "## 当前任务",
            "- intent: REFINE_EXISTING_CHARACTER",
            f"- parameters: {parameters}",
            "",
            _render_executor_context_block(executor_context),
            "",
            "## 当前任务要求",
            f"- 角色名：{parameters.get('character_name')}",
            f"- 细化维度：{parameters.get('refine_dimensions')}",
            "",
            "请按如下结构输出：",
            "## 角色细化结果",
            "### 基础定位",
            "- 角色名：",
            "- 当前身份：",
            "- 当前功能位：",
            "### 细化维度",
            "#### 1. 核心欲望",
            "#### 2. 软肋与弱点",
            "#### 3. 长期执念",
            "#### 4. 情感触发点",
            "#### 5. 成长弧线",
            "#### 6. 与主线绑定方式",
        ]
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_advance_plot_messages(
    executor_context: JsonDict,
    *,
    parameters: JsonDict,
) -> list[dict[str, str]]:
    system = """\
你是小说创作执行器。
当前任务是：推进剧情。

要求：
1. 必须说明为什么这样推进
2. 必须给出具体推进路径，而不是空泛建议
3. 必须指出关键冲突点与可选转折点
4. 除非明确要求，不直接写整章正文
5. 请按指定格式输出
"""
    user = "\n".join(
        [
            "## 当前任务",
            "- intent: ADVANCE_PLOT",
            f"- parameters: {parameters}",
            "",
            _render_executor_context_block(executor_context),
            "",
            "## 当前任务要求",
            f"- 推进目标：{parameters.get('advance_goal')}",
            f"- 目标位置：{parameters.get('target_position')}",
            f"- 限制条件：{parameters.get('constraints')}",
            "",
            "请按如下结构输出：",
            "## 剧情推进方案",
            "### 当前状态判断",
            "### 下一步推进目标",
            "### 推荐推进路径",
            "1.",
            "2.",
            "3.",
            "### 关键冲突点",
            "### 可选转折点",
            "### 风险点",
            "### 建议优先方案",
        ]
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_summarize_current_state_messages(
    executor_context: JsonDict,
    *,
    parameters: JsonDict,
) -> list[dict[str, str]]:
    system = """\
你是小说创作执行器。
当前任务是：总结当前作品状态。

要求：
1. 强调已确定与未确定的边界
2. 覆盖当前剧情进度、角色现状和未决问题
3. 不要写成散文
4. 最后给出清晰的下一步建议
5. 请按指定格式输出
"""
    user = "\n".join(
        [
            "## 当前任务",
            "- intent: SUMMARIZE_CURRENT_STATE",
            f"- parameters: {parameters}",
            "",
            _render_executor_context_block(executor_context),
            "",
            "请按如下结构输出：",
            "## 当前作品状态总结",
            "### 已确定内容",
            "### 当前剧情进度",
            "### 核心角色现状",
            "### 世界设定现状",
            "### 主要未决问题",
            "### 推荐下一步",
        ]
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
