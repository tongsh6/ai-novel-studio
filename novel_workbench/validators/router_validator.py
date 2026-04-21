"""Validator for minimal Router protocol results."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from novel_workbench.router.intents import (
    ADVANCE_PLOT,
    ALL_INTENTS,
    CREATE_CHARACTER_CANDIDATES,
    OTHER,
    REFINE_EXISTING_CHARACTER,
    SUMMARIZE_CURRENT_STATE,
)
from novel_workbench.router.schemas import default_reply_for_intent


JsonDict = dict[str, Any]

_OVERREACH_PATTERNS = (
    "好的，我会",
    "我来帮你写",
    "我现在开始",
    "接下来我为你生成",
    "我将为你补全",
)

_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    CREATE_CHARACTER_CANDIDATES: ("work_name", "plot_scope", "generation_target"),
    REFINE_EXISTING_CHARACTER: ("work_name", "character_name", "refine_dimensions"),
    ADVANCE_PLOT: ("work_name", "current_plot_scope", "advance_goal"),
    SUMMARIZE_CURRENT_STATE: ("work_name", "summary_scope"),
}

_MISSING_FIELD_EXPECTATIONS: dict[str, tuple[str, ...]] = {
    CREATE_CHARACTER_CANDIDATES: ("candidate_count", "role_type"),
    REFINE_EXISTING_CHARACTER: ("character_name", "refine_dimensions"),
    ADVANCE_PLOT: ("target_position",),
}


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    if isinstance(value, dict):
        return len(value) == 0
    return False


def _reply_overreaches(reply: str) -> bool:
    text = str(reply or "").strip()
    if not text:
        return False
    return any(pattern in text for pattern in _OVERREACH_PATTERNS)


def validate_router_result(route_result: JsonDict) -> JsonDict:
    """Validate protocol correctness, lightly auto-repairing reply overreach."""

    result = deepcopy(route_result)
    error_codes: list[str] = []
    warnings: list[str] = []
    intent = str(result.get("intent") or "").strip().upper()
    parameters = result.get("parameters")
    missing_fields = result.get("missing_fields")
    confidence = result.get("confidence")
    reply = str(result.get("reply") or "").strip()

    for field_name in ("intent", "parameters", "missing_fields", "confidence", "reply"):
        if field_name not in result:
            error_codes.append("FAIL_REQUIRED_FIELD_MISSING")
            break

    if intent not in ALL_INTENTS:
        error_codes.append("FAIL_INTENT_OUT_OF_ENUM")
        intent = OTHER
        result["intent"] = OTHER

    if not isinstance(parameters, dict):
        error_codes.append("FAIL_PARAMETERS_EMPTY")
        parameters = {}
        result["parameters"] = parameters

    if not isinstance(missing_fields, list):
        error_codes.append("FAIL_REQUIRED_FIELD_MISSING")
        missing_fields = []
        result["missing_fields"] = missing_fields

    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        error_codes.append("FAIL_CONFIDENCE_INVALID")
    else:
        if not 0.0 <= confidence_value <= 1.0:
            error_codes.append("FAIL_CONFIDENCE_INVALID")

    if _reply_overreaches(reply):
        warnings.append("AUTO_REPAIRED_REPLY_OVERREACH")
        result["reply"] = default_reply_for_intent(intent)

    if intent != OTHER:
        if parameters == {}:
            error_codes.append("FAIL_PARAMETERS_EMPTY")
        required_fields = _REQUIRED_FIELDS.get(intent, ())
        for field_name in required_fields:
            if _is_blank(parameters.get(field_name)):
                if field_name not in missing_fields:
                    error_codes.append("FAIL_SLOT_MISMATCH")
                    error_codes.append("FAIL_MISSING_FIELDS_INCONSISTENT")
                    break

        expected_missing_fields = _MISSING_FIELD_EXPECTATIONS.get(intent, ())
        for field_name in expected_missing_fields:
            if _is_blank(parameters.get(field_name)) and field_name not in missing_fields:
                error_codes.append("FAIL_MISSING_FIELDS_INCONSISTENT")
                break

        all_blank = all(_is_blank(value) for value in parameters.values())
        if all_blank and not missing_fields:
            error_codes.append("FAIL_PARAMETERS_EMPTY")

        if intent == CREATE_CHARACTER_CANDIDATES:
            target = parameters.get("generation_target")
            if target not in (None, "", "new_character_candidates"):
                error_codes.append("FAIL_SLOT_MISMATCH")

    deduped_errors: list[str] = []
    for code in error_codes:
        if code not in deduped_errors:
            deduped_errors.append(code)

    suggested_action = "proceed"
    if not deduped_errors and result.get("missing_fields"):
        suggested_action = "needs_clarification"
    elif "FAIL_REPLY_OVERREACH" in deduped_errors:
        suggested_action = "auto_repair_reply"
    elif "FAIL_INTENT_OUT_OF_ENUM" in deduped_errors:
        suggested_action = "downgrade_to_other"
    elif deduped_errors:
        suggested_action = "retry_with_stricter_instruction"

    return {
        "is_valid": len(deduped_errors) == 0,
        "stage": "router",
        "error_codes": deduped_errors,
        "warnings": warnings,
        "suggested_action": suggested_action,
        "validated_result": result,
    }
