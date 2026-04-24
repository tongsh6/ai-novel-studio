"""Service entrypoint for the protocol-only Router layer."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client

from .intents import DRAFT_CHAPTER, GENERATE_CHAPTER_OUTLINE
from .prompts import build_router_messages
from .schemas import normalize_router_result


JsonDict = dict[str, Any]

_CONTINUE_COMMANDS = {
    "继续",
    "继续写",
    "继续生成",
    "接着",
    "接着写",
    "往下",
    "往下写",
}


class RouterService:
    """Pure Router service: classify intent and extract parameters only."""

    def route(
        self,
        text: str,
        *,
        router_context: JsonDict | None = None,
    ) -> JsonDict:
        messages = build_router_messages(
            text,
            router_context=router_context,
        )
        minimal_context = (router_context or {}).get("minimal_context") or {}
        work_name = str(minimal_context.get("work_name") or "").strip()
        fallback = _route_continue_command(text, router_context or {}, work_name=work_name)
        if fallback is not None:
            return normalize_router_result(fallback, work_name=work_name)
        try:
            raw = llm_client.chat_json(messages, temperature=0.1, max_tokens=1200)
        except Exception:
            raw = _route_continue_command(text, router_context or {}, work_name=work_name)
        return normalize_router_result(raw, work_name=work_name)


def _compact_command(text: str) -> str:
    return "".join(str(text or "").strip().lower().split()).strip("。！!,.，；;")


def _route_continue_command(
    text: str,
    router_context: JsonDict,
    *,
    work_name: str,
) -> JsonDict | None:
    if _compact_command(text) not in _CONTINUE_COMMANDS or not work_name:
        return None

    chapter = router_context.get("chapter")
    if not isinstance(chapter, dict):
        return None

    chapter_id = str(chapter.get("id") or "").strip()
    status = str(chapter.get("status") or "").strip().upper()
    if status == "BACKLOG":
        return {
            "intent": GENERATE_CHAPTER_OUTLINE,
            "parameters": {
                "work_name": work_name,
                "chapter_id": chapter_id,
                "instruction_text": "",
                "rewrite_mode": "default",
            },
            "missing_fields": [] if chapter_id else ["chapter_id"],
            "confidence": 0.9,
            "reply": "",
        }
    if status in {"OUTLINED", "DRAFTING"}:
        return {
            "intent": DRAFT_CHAPTER,
            "parameters": {
                "work_name": work_name,
                "chapter_id": chapter_id,
                "instruction_text": "",
                "rewrite_mode": "default",
            },
            "missing_fields": [] if chapter_id else ["chapter_id"],
            "confidence": 0.9,
            "reply": "",
        }
    return None
