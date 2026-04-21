"""Normalization helpers for Router protocol payloads."""

from __future__ import annotations

from typing import Any, Mapping

from .intents import (
    ADVANCE_PLOT,
    CREATE_CHARACTER_CANDIDATES,
    OTHER,
    REFINE_EXISTING_CHARACTER,
    SUMMARIZE_CURRENT_STATE,
    empty_parameters,
    normalize_intent,
)


JsonDict = dict[str, Any]


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            result.append(text)
    return result


def _clamp_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, confidence))


def default_reply_for_intent(intent: str) -> str:
    return {
        CREATE_CHARACTER_CANDIDATES: "已识别为基于当前剧情生成角色候选的请求。",
        REFINE_EXISTING_CHARACTER: "已识别为对现有角色设定进行细化的请求。",
        ADVANCE_PLOT: "已识别为推进当前剧情的请求。",
        SUMMARIZE_CURRENT_STATE: "已识别为总结当前作品状态的请求。",
        OTHER: "已识别为暂时无法稳定归类的请求。",
    }.get(intent, "已识别为暂时无法稳定归类的请求。")


def normalize_parameters(
    intent: str,
    raw_parameters: Any,
    *,
    work_name: str = "",
) -> JsonDict:
    parameters = empty_parameters(intent)
    if isinstance(raw_parameters, Mapping):
        for key, value in raw_parameters.items():
            if key in parameters:
                parameters[str(key)] = value

    if work_name:
        if "work_name" in parameters and not str(parameters.get("work_name") or "").strip():
            parameters["work_name"] = work_name

    return parameters


def normalize_router_result(
    raw_result: Mapping[str, Any] | None,
    *,
    work_name: str = "",
) -> JsonDict:
    raw_result = raw_result or {}
    intent = normalize_intent(raw_result.get("intent"))
    parameters = normalize_parameters(
        intent,
        raw_result.get("parameters"),
        work_name=work_name,
    )
    missing_fields = _as_str_list(raw_result.get("missing_fields"))
    confidence = _clamp_confidence(raw_result.get("confidence"))
    reply = str(raw_result.get("reply") or "").strip() or default_reply_for_intent(intent)

    return {
        "intent": intent,
        "parameters": parameters,
        "missing_fields": missing_fields,
        "confidence": confidence,
        "reply": reply,
    }
