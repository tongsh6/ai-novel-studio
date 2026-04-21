"""Validator for minimal executor outputs."""

from __future__ import annotations

from typing import Any


JsonDict = dict[str, Any]


_REQUIRED_MARKERS: dict[str, tuple[str, ...]] = {
    "CREATE_CHARACTER_CANDIDATES": ("## 角色候选 1", "## 综合建议"),
    "REFINE_EXISTING_CHARACTER": ("## 角色细化结果", "### 基础定位"),
    "ADVANCE_PLOT": ("## 剧情推进方案", "### 推荐推进路径"),
    "SUMMARIZE_CURRENT_STATE": ("## 当前作品状态总结", "### 推荐下一步"),
}


def validate_executor_result(intent: str, execution_result: JsonDict) -> JsonDict:
    action_result = execution_result.get("actionResult")
    content = ""
    if isinstance(action_result, dict):
        content = str(action_result.get("content") or "").strip()

    errors: list[str] = []
    if not execution_result.get("handled"):
        errors.append("FAIL_TASK_MISALIGNED")

    markers = _REQUIRED_MARKERS.get(intent, ())
    if markers and content:
        for marker in markers:
            if marker not in content:
                errors.append("FAIL_EXECUTOR_FORMAT_INVALID")
                break
    elif markers and not content:
        errors.append("FAIL_EXECUTOR_FORMAT_INVALID")

    deduped_errors: list[str] = []
    for code in errors:
        if code not in deduped_errors:
            deduped_errors.append(code)

    suggested_action = "proceed" if not deduped_errors else "retry_with_stricter_instruction"
    return {
        "is_valid": not deduped_errors,
        "stage": "executor",
        "error_codes": deduped_errors,
        "warnings": [],
        "suggested_action": suggested_action,
        "validated_result": execution_result,
    }
