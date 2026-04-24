"""Default-filling helpers for minimal Router results."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .intents import (
    ADVANCE_PLOT,
    CREATE_CHARACTER_CANDIDATES,
    CREATE_WORK_SEED,
    DRAFT_CHAPTER,
    GENERATE_CHAPTER_OUTLINE,
    REVISE_DRAFT,
    SUMMARIZE_CURRENT_STATE,
)


JsonDict = dict[str, Any]


def apply_router_defaults(route_result: JsonDict) -> tuple[JsonDict, list[str]]:
    """Apply low-risk defaults and remove resolved missing fields."""

    result = deepcopy(route_result)
    parameters = result.get("parameters") or {}
    missing_fields = list(result.get("missing_fields") or [])
    autofilled_fields: list[str] = []

    def fill(field_name: str, value: Any) -> None:
        if field_name not in parameters:
            return
        current = parameters.get(field_name)
        is_empty = current is None or (isinstance(current, str) and not current.strip())
        if not is_empty:
            return
        parameters[field_name] = value
        autofilled_fields.append(field_name)
        while field_name in missing_fields:
            missing_fields.remove(field_name)

    intent = str(result.get("intent") or "").strip().upper()
    if intent == CREATE_WORK_SEED:
        fill("target_platform", "起点中文网")
        fill("target_audience", "网文读者")
    elif intent == CREATE_CHARACTER_CANDIDATES:
        fill("plot_scope", "current_plot")
    elif intent == ADVANCE_PLOT:
        fill("current_plot_scope", "current_plot")
    elif intent == SUMMARIZE_CURRENT_STATE:
        fill("summary_scope", "current_work")
    elif intent == GENERATE_CHAPTER_OUTLINE:
        fill("rewrite_mode", "default")
    elif intent == DRAFT_CHAPTER:
        fill("rewrite_mode", "default")
    elif intent == REVISE_DRAFT:
        fill("revise_mode", "revise_direct")

    result["parameters"] = parameters
    result["missing_fields"] = missing_fields
    return result, autofilled_fields
