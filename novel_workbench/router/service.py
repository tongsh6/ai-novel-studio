"""Service entrypoint for the protocol-only Router layer."""

from __future__ import annotations

from typing import Any

from novel_workbench.services import llm_client

from .prompts import build_router_messages
from .schemas import normalize_router_result


JsonDict = dict[str, Any]


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
        try:
            raw = llm_client.chat_json(messages, temperature=0.1, max_tokens=600)
        except Exception:
            raw = None
        return normalize_router_result(raw, work_name=work_name)
