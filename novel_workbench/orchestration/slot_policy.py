"""Runtime slot policy resolution for active intents."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from novel_workbench.router.intents import (
    ADVANCE_PLOT,
    CREATE_CHARACTER_CANDIDATES,
    CREATE_WORK_SEED,
    DRAFT_CHAPTER,
    ENTER_READ_MODE,
    GENERATE_CHAPTER_OUTLINE,
    REFINE_EXISTING_CHARACTER,
    REVISE_DRAFT,
    SUMMARIZE_CURRENT_STATE,
)


JsonDict = dict[str, Any]

_CN_DIGITS = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _parse_count(text: str) -> int | None:
    match = re.search(r"([0-9]+)\s*(?:个|位|名)?(?:核心)?角色", text)
    if match:
        return int(match.group(1))
    match = re.search(r"([一二两三四五六七八九十])\s*(?:个|位|名)?(?:核心)?角色", text)
    if match:
        return _CN_DIGITS.get(match.group(1))
    if "两个" in text or "两位" in text:
        return 2
    if "三个" in text or "三位" in text:
        return 3
    if "一个" in text or "一位" in text:
        return 1
    return None


def _infer_role_type(text: str) -> str:
    if "核心角色" in text:
        return "core_roles"
    if "反派" in text:
        return "antagonist"
    if "配角" in text:
        return "supporting_roles"
    if "女主" in text:
        return "female_lead"
    if "男主" in text:
        return "male_lead"
    return ""


def _infer_refine_dimensions(text: str) -> list[str]:
    dimensions: list[str] = []
    if any(token in text for token in ("更狠", "狠一点", "再狠一点")):
        dimensions.extend(["temperament", "behavioral_edge"])
    if any(token in text for token in ("更细", "细一点", "更立体", "再细一点")):
        dimensions.extend(["motivation", "growth_arc", "behavioral_edge"])
    if any(token in text for token in ("更柔", "柔一点", "更脆弱")):
        dimensions.extend(["emotional_layers"])
    deduped: list[str] = []
    for item in dimensions:
        if item not in deduped:
            deduped.append(item)
    return deduped


def _infer_character_name(text: str, character_names: list[str]) -> str:
    for name in character_names:
        if name and name in text:
            return name
    return ""


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    if isinstance(value, dict):
        return len(value) == 0
    return False


def resolve_slot_policy(
    *,
    intent: str,
    parameters: JsonDict,
    missing_fields: list[str],
    user_message: str,
    work_title: str = "",
    character_names: list[str] | None = None,
    autofilled_fields: list[str] | None = None,
    active_chapter_id: str = "",
) -> JsonDict:
    resolved_parameters = deepcopy(parameters)
    remaining_missing_fields = list(missing_fields)
    inferred_fields: list[str] = []
    updated_autofilled_fields = list(autofilled_fields or [])

    def remove_missing(field_name: str) -> None:
        while field_name in remaining_missing_fields:
            remaining_missing_fields.remove(field_name)

    def infer(field_name: str, value: Any) -> None:
        if _blank(value):
            return
        resolved_parameters[field_name] = value
        remove_missing(field_name)
        if field_name in updated_autofilled_fields:
            updated_autofilled_fields.remove(field_name)
        if field_name not in inferred_fields:
            inferred_fields.append(field_name)

    def default(field_name: str, value: Any) -> None:
        if not _blank(resolved_parameters.get(field_name)):
            return
        resolved_parameters[field_name] = value
        remove_missing(field_name)
        if field_name not in updated_autofilled_fields:
            updated_autofilled_fields.append(field_name)

    def optional(field_name: str) -> None:
        remove_missing(field_name)

    def ensure_missing(field_name: str) -> None:
        if field_name not in remaining_missing_fields:
            remaining_missing_fields.append(field_name)

    extra_required_fields: list[str] = []

    if intent == CREATE_CHARACTER_CANDIDATES:
        parsed_count = _parse_count(user_message)
        inferred_role_type = _infer_role_type(user_message)
        infer("candidate_count", parsed_count)
        infer("role_type", inferred_role_type)
        default("plot_scope", "current_plot")
        default("generation_target", "new_character_candidates")
        if _blank(parsed_count) and _blank(inferred_role_type):
            ensure_missing("candidate_count")
            ensure_missing("role_type")
            extra_required_fields.extend(["candidate_count", "role_type"])
        else:
            default("candidate_count", 3)
            optional("role_type")
        optional("selection_flow")
        optional("constraints")
    elif intent == REFINE_EXISTING_CHARACTER:
        infer(
            "character_name",
            _infer_character_name(user_message, character_names or []),
        )
        infer("refine_dimensions", _infer_refine_dimensions(user_message))
        default("current_basis", "current_character_state")
        optional("constraints")
    elif intent == ADVANCE_PLOT:
        if any(token in user_message for token in ("推进", "往前推", "推一点", "下一步")):
            infer("advance_goal", "reasonable_next_progression")
        default("current_plot_scope", "current_plot")
        optional("target_position")
        optional("constraints")
    elif intent == SUMMARIZE_CURRENT_STATE:
        default("summary_scope", "current_work")
        optional("summary_focus")
    elif intent == GENERATE_CHAPTER_OUTLINE:
        if active_chapter_id:
            default("chapter_id", active_chapter_id)
        default("rewrite_mode", "default")
        optional("instruction_text")
    elif intent == DRAFT_CHAPTER:
        if active_chapter_id:
            default("chapter_id", active_chapter_id)
        default("rewrite_mode", "default")
        optional("instruction_text")
    elif intent == REVISE_DRAFT:
        if active_chapter_id:
            default("chapter_id", active_chapter_id)
        default("revise_mode", "revise_direct")
        optional("instruction_text")
    elif intent == ENTER_READ_MODE:
        pass
    elif intent == CREATE_WORK_SEED:
        default("target_platform", "起点中文网")
        default("target_audience", "网文读者")
        optional("target_platform")
        optional("target_audience")

    if work_title and _blank(resolved_parameters.get("work_name")) and "work_name" in resolved_parameters:
        default("work_name", work_title)

    required_fields = [
        *{
        CREATE_WORK_SEED: ["title", "one_line_pitch", "genre"],
        CREATE_CHARACTER_CANDIDATES: ["work_name"],
        REFINE_EXISTING_CHARACTER: ["work_name", "character_name", "refine_dimensions"],
        ADVANCE_PLOT: ["work_name", "advance_goal"],
        SUMMARIZE_CURRENT_STATE: ["work_name"],
        GENERATE_CHAPTER_OUTLINE: ["work_name", "chapter_id"],
        DRAFT_CHAPTER: ["work_name", "chapter_id"],
        REVISE_DRAFT: ["work_name", "chapter_id"],
        ENTER_READ_MODE: ["work_name"],
        }.get(intent, []),
        *extra_required_fields,
    ]

    optional_fields = {
        CREATE_WORK_SEED: ["target_platform", "target_audience"],
        CREATE_CHARACTER_CANDIDATES: ["role_type", "selection_flow", "constraints"],
        REFINE_EXISTING_CHARACTER: ["constraints"],
        ADVANCE_PLOT: ["target_position", "constraints"],
        SUMMARIZE_CURRENT_STATE: ["summary_focus"],
        GENERATE_CHAPTER_OUTLINE: ["instruction_text"],
        DRAFT_CHAPTER: ["instruction_text"],
        REVISE_DRAFT: ["instruction_text"],
        ENTER_READ_MODE: [],
    }.get(intent, [])

    blocked_missing_fields = [
        field_name
        for field_name in remaining_missing_fields
        if field_name in required_fields
    ]

    return {
        "parameters": resolved_parameters,
        "remaining_missing_fields": remaining_missing_fields,
        "blocked_missing_fields": blocked_missing_fields,
        "required_fields": required_fields,
        "optional_fields": optional_fields,
        "inferred_fields": inferred_fields,
        "autofilled_fields": updated_autofilled_fields,
    }
