"""Canonical agent-turn orchestration adapters."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from novel_workbench.orchestration import resolve_slot_policy
from novel_workbench.router.intents import CREATE_WORK_SEED, OTHER
from novel_workbench.services.workbench import (
    WorkbenchService,
    json_text,
    now_ms,
)
from novel_workbench.validators import (
    validate_executor_result,
    validate_router_result,
)


JsonDict = dict[str, Any]


class AgentOrchestrator:
    """Orchestrator shell that wraps service packets into AgentTurnResult."""

    def __init__(self, service: WorkbenchService):
        self.service = service

    def orchestrate_turn(
        self,
        *,
        work_id: str,
        user_message: str,
        clarification_target_interaction_id: str | None = None,
        client_context: JsonDict | None = None,
    ) -> JsonDict:
        del client_context
        active_clarification = self._find_active_clarification(
            work_id=work_id,
            clarification_target_interaction_id=clarification_target_interaction_id,
        )
        route_packet = self.service._route_user_request(
            work_id=work_id,
            text=user_message,
            persist=True,
        )
        interaction_id = str(route_packet.get("interactionId") or "").strip() or None
        route_result = deepcopy(route_packet.get("routeResult") or {})

        if active_clarification and self._should_continue_clarification(
            clarification_state=active_clarification,
            route_result=route_result,
            explicit_target=bool(clarification_target_interaction_id),
        ):
            packet, slot_resolution = self._resolve_clarification_packet(
                work_id=work_id,
                user_message=user_message,
                route_packet=route_packet,
                interaction_id=interaction_id,
                clarification_state=active_clarification,
            )
            clarification_context = active_clarification
        else:
            if active_clarification:
                raw_intent = str(route_result.get("intent") or "")
                if raw_intent and raw_intent != OTHER and raw_intent != active_clarification["intent"]:
                    self._close_clarification(
                        active_clarification,
                        status="SUPERSEDED",
                        resolution={
                            "close_reason": "superseded",
                            "superseded_by_interaction_id": interaction_id,
                            "superseded_by_intent": raw_intent,
                        },
                    )
            packet, slot_resolution = self._resolve_route_packet(
                work_id=work_id,
                user_message=user_message,
                route_packet=route_packet,
                interaction_id=interaction_id,
            )
            clarification_context = None

        interaction_id = str(packet.get("interactionId") or "").strip() or None
        row = self.service.repos.interaction_logs.get(interaction_id) if interaction_id else None
        turn_result = self._packet_to_turn_result(
            packet,
            row=row,
            slot_resolution=slot_resolution,
            user_message=user_message,
        )
        clarification_row = self._sync_clarification_state(
            work_id=work_id,
            packet=packet,
            interaction_id=interaction_id,
            slot_resolution=slot_resolution,
            assistant_message=turn_result["assistant_message"],
            active_clarification=clarification_context,
        )
        if clarification_row:
            turn_result["clarification"] = self._clarification_from_row(clarification_row)
        elif turn_result["phase"] != "NEEDS_CLARIFICATION":
            turn_result["clarification"] = None
        return turn_result

    def orchestrate_workless_turn(
        self,
        *,
        user_message: str,
        client_context: JsonDict | None = None,
    ) -> JsonDict:
        del client_context
        route_packet = self.service.route_user_request(
            work_id=None,
            text=user_message,
        )
        route_result = deepcopy(route_packet.get("routeResult") or {})
        slot_resolution = resolve_slot_policy(
            intent=str(route_result.get("intent") or ""),
            parameters=route_result.get("parameters") or {},
            missing_fields=list(route_result.get("missing_fields") or []),
            user_message=user_message,
            work_title="",
            character_names=[],
            autofilled_fields=list(route_packet.get("autofilledFields") or []),
            active_chapter_id="",
        )
        resolved_route_result = {
            **route_result,
            "parameters": slot_resolution["parameters"],
            "missing_fields": slot_resolution["blocked_missing_fields"],
        }
        route_validation = validate_router_result(resolved_route_result)
        validated_route_result = route_validation["validated_result"]
        intent = str(validated_route_result.get("intent") or "").strip().upper()

        if intent != CREATE_WORK_SEED:
            guidance_reply = (
                "请先创建作品（例如：“创建作品《风》，题材悬疑，主角做海员”），"
                "再发起其他创作对话。"
            )
            guided_route_result = {
                **validated_route_result,
                "missing_fields": [],
                "reply": guidance_reply,
            }
            packet = {
                "status": "ROUTED",
                "routeResult": guided_route_result,
                "validationResult": route_validation,
                "executionResult": None,
                "executionValidation": None,
                "interactionId": None,
                "autofilledFields": slot_resolution["autofilled_fields"],
            }
            return self._packet_to_turn_result(
                packet,
                row=None,
                slot_resolution=slot_resolution,
                user_message=user_message,
            )

        if not route_validation["is_valid"]:
            packet = {
                "status": "FAILED",
                "routeResult": validated_route_result,
                "validationResult": route_validation,
                "executionResult": None,
                "executionValidation": None,
                "interactionId": None,
                "autofilledFields": slot_resolution["autofilled_fields"],
            }
            return self._packet_to_turn_result(
                packet,
                row=None,
                slot_resolution=slot_resolution,
                user_message=user_message,
            )

        if slot_resolution["blocked_missing_fields"]:
            packet = {
                "status": "NEEDS_CLARIFICATION",
                "routeResult": validated_route_result,
                "validationResult": route_validation,
                "executionResult": None,
                "executionValidation": None,
                "interactionId": None,
                "autofilledFields": slot_resolution["autofilled_fields"],
            }
            return self._packet_to_turn_result(
                packet,
                row=None,
                slot_resolution=slot_resolution,
                user_message=user_message,
            )

        execution_context = {"work_id": "", "text": user_message}
        execution_result = self.service.executor_registry.execute(
            intent,
            context=execution_context,
            parameters=validated_route_result["parameters"],
        )
        execution_validation = validate_executor_result(intent, execution_result)
        execution_status = (
            "COMPLETED" if execution_validation["is_valid"] else "FAILED"
        )

        action_result = execution_result.get("actionResult") or {}
        new_work_id = ""
        if isinstance(action_result, dict):
            new_work_id = str(action_result.get("workId") or "").strip()

        interaction_id: str | None = None
        row: JsonDict | None = None
        if execution_status == "COMPLETED" and new_work_id:
            interaction = self.service._save_interaction_log(
                work_id=new_work_id,
                user_input=user_message,
                route_result=validated_route_result,
                route_validation=route_validation,
                execution_result=execution_result,
                execution_validation=execution_validation,
                status=execution_status,
                slot_resolution=slot_resolution,
            )
            interaction_id = interaction["id"]
            row = self.service.repos.interaction_logs.get(interaction_id)

        packet = {
            "status": execution_status,
            "routeResult": validated_route_result,
            "validationResult": route_validation,
            "executionResult": execution_result,
            "executionValidation": execution_validation,
            "interactionId": interaction_id,
            "autofilledFields": slot_resolution["autofilled_fields"],
        }
        return self._packet_to_turn_result(
            packet,
            row=row,
            slot_resolution=slot_resolution,
            user_message=user_message,
        )

    def list_turns(self, *, work_id: str) -> list[JsonDict]:
        rows = self.service.repos.interaction_logs.list_by_work(work_id)
        return [self._row_to_turn_result(row) for row in rows]

    def _resolve_route_packet(
        self,
        *,
        work_id: str,
        user_message: str,
        route_packet: JsonDict,
        interaction_id: str | None,
    ) -> tuple[JsonDict, JsonDict]:
        route_result = deepcopy(route_packet.get("routeResult") or {})
        slot_context = self._build_slot_context(work_id)
        slot_resolution = resolve_slot_policy(
            intent=str(route_result.get("intent") or ""),
            parameters=route_result.get("parameters") or {},
            missing_fields=list(route_result.get("missing_fields") or []),
            user_message=user_message,
            work_title=slot_context["work_title"],
            character_names=slot_context["character_names"],
            autofilled_fields=list(route_packet.get("autofilledFields") or []),
            active_chapter_id=slot_context["active_chapter_id"],
        )
        resolved_route_result = {
            **route_result,
            "parameters": slot_resolution["parameters"],
            "missing_fields": slot_resolution["blocked_missing_fields"],
        }
        return self._finalize_route_packet(
            work_id=work_id,
            user_message=user_message,
            route_result=resolved_route_result,
            interaction_id=interaction_id,
            slot_resolution=slot_resolution,
        )

    def _resolve_clarification_packet(
        self,
        *,
        work_id: str,
        user_message: str,
        route_packet: JsonDict,
        interaction_id: str | None,
        clarification_state: JsonDict,
    ) -> tuple[JsonDict, JsonDict]:
        route_result = deepcopy(route_packet.get("routeResult") or {})
        base_parameters = self.service._parse_json_text(
            clarification_state.get("current_parameters_json"),
            default={},
        )
        required_fields = self.service._parse_json_text(
            clarification_state.get("required_fields_json"),
            default=[],
        )
        merged_parameters = self._merge_nonblank_parameters(
            base_parameters,
            route_result.get("parameters") or {},
        )
        slot_context = self._build_slot_context(work_id)
        slot_resolution = resolve_slot_policy(
            intent=str(clarification_state.get("intent") or ""),
            parameters=merged_parameters,
            missing_fields=list(required_fields),
            user_message=user_message,
            work_title=slot_context["work_title"],
            character_names=slot_context["character_names"],
            autofilled_fields=[],
            active_chapter_id=slot_context["active_chapter_id"],
        )
        resolved_route_result = {
            "intent": str(clarification_state.get("intent") or ""),
            "parameters": slot_resolution["parameters"],
            "missing_fields": slot_resolution["blocked_missing_fields"],
            "confidence": float(route_result.get("confidence") or 1.0),
            "reply": self._clarification_reply(route_result=route_result),
        }
        return self._finalize_route_packet(
            work_id=work_id,
            user_message=user_message,
            route_result=resolved_route_result,
            interaction_id=interaction_id,
            slot_resolution=slot_resolution,
        )

    def _finalize_route_packet(
        self,
        *,
        work_id: str,
        user_message: str,
        route_result: JsonDict,
        interaction_id: str | None,
        slot_resolution: JsonDict,
    ) -> tuple[JsonDict, JsonDict]:
        route_validation = validate_router_result(route_result)
        resolved_route_result = route_validation["validated_result"]

        if not route_validation["is_valid"]:
            status = "FAILED"
        elif resolved_route_result.get("intent") == OTHER:
            status = "ROUTED"
        elif slot_resolution["blocked_missing_fields"]:
            status = "NEEDS_CLARIFICATION"
        else:
            packet = self.service.execute_router_result(
                work_id=work_id,
                route_result=resolved_route_result,
                interaction_id=interaction_id,
                user_input=user_message,
                persist=True,
                slot_resolution=slot_resolution,
            )
            packet["autofilledFields"] = slot_resolution["autofilled_fields"]
            return packet, slot_resolution

        interaction = self.service._save_interaction_log(
            work_id=work_id,
            user_input=user_message,
            route_result=resolved_route_result,
            route_validation=route_validation,
            status=status,
            interaction_id=interaction_id,
            slot_resolution=slot_resolution,
        )
        return (
            {
                "status": status,
                "routeResult": resolved_route_result,
                "validationResult": route_validation,
                "executionResult": None,
                "executionValidation": None,
                "interactionId": interaction["id"],
                "autofilledFields": slot_resolution["autofilled_fields"],
            },
            slot_resolution,
        )

    def _packet_to_turn_result(
        self,
        packet: JsonDict,
        *,
        row: JsonDict | None = None,
        slot_resolution: JsonDict | None = None,
        clarification_row: JsonDict | None = None,
        user_message: str = "",
    ) -> JsonDict:
        route_result = packet.get("routeResult") or {}
        execution_result = self._normalize_execution_result(packet.get("executionResult"))
        phase, status = self._map_phase_and_status(packet.get("status"))
        timestamps = {
            "created_at": row["created_at"] if row else now_ms(),
            "updated_at": row["updated_at"] if row else now_ms(),
        }
        interaction_id = str(packet.get("interactionId") or "").strip() or (
            str(row.get("id")) if row else ""
        )
        slot_resolution = slot_resolution or {
            "inferred_fields": [],
            "autofilled_fields": list(packet.get("autofilledFields") or []),
            "remaining_missing_fields": list(route_result.get("missing_fields") or []),
            "blocked_missing_fields": list(route_result.get("missing_fields") or []),
            "required_fields": [],
            "optional_fields": [],
        }
        assistant_message = self._build_assistant_message(
            phase=phase,
            route_result=route_result,
            execution_result=execution_result,
        )
        clarification = self._build_clarification(
            phase=phase,
            interaction_id=interaction_id,
            route_result=route_result,
            slot_resolution=slot_resolution,
            clarification_row=clarification_row,
        )
        return {
            "interaction_id": interaction_id,
            "user_message": user_message or (str(row.get("user_input") or "") if row else ""),
            "phase": phase,
            "status": status,
            "assistant_message": assistant_message,
            "route_result": route_result,
            "execution_result": execution_result,
            "validation": {
                "router": packet.get("validationResult"),
                "executor": packet.get("executionValidation"),
            },
            "slot_resolution": {
                "inferred_fields": list(slot_resolution.get("inferred_fields") or []),
                "autofilled_fields": list(slot_resolution.get("autofilled_fields") or []),
                "remaining_missing_fields": list(
                    slot_resolution.get("remaining_missing_fields") or []
                ),
            },
            "clarification": clarification,
            "next_action": self._build_next_action(phase=phase, route_result=route_result),
            "ui_hints": {
                "render_mode": "chat",
                "show_retry": phase == "FAILED",
                "show_structured_card": execution_result is not None,
            },
            "timestamps": timestamps,
        }

    def _row_to_turn_result(self, row: JsonDict) -> JsonDict:
        route_result = self.service._parse_json_text(row.get("route_result_json"), default={})
        phase, status = self._map_phase_and_status(row.get("status"))
        slot_resolution = self.service._parse_json_text(
            row.get("slot_resolution_json"),
            default={},
        ) or {}
        clarification_row = self.service.repos.clarification_states.get_latest_by_source_interaction(
            row["id"]
        )
        packet = {
            "status": row["status"],
            "routeResult": route_result,
            "validationResult": self.service._parse_json_text(
                row.get("route_validation_json"),
                default={},
            ),
            "executionResult": self.service._parse_json_text(
                row.get("execution_result_json"),
                default={},
            ),
            "executionValidation": self.service._parse_json_text(
                row.get("execution_validation_json"),
                default={},
            )
            or None,
            "interactionId": row["id"],
            "autofilledFields": list(slot_resolution.get("autofilled_fields") or []),
        }
        return self._packet_to_turn_result(
            packet,
            row=row,
            slot_resolution=slot_resolution,
            clarification_row=clarification_row,
        )

    def _normalize_execution_result(self, raw_execution_result: Any) -> JsonDict | None:
        if not isinstance(raw_execution_result, dict) or not raw_execution_result:
            return None
        return {
            "handled": bool(raw_execution_result.get("handled")),
            "status": str(raw_execution_result.get("status") or ""),
            "action_result": raw_execution_result.get("actionResult"),
            "metadata": raw_execution_result.get("metadata") or {},
        }

    def _map_phase_and_status(self, raw_status: Any) -> tuple[str, str]:
        status = str(raw_status or "").strip().upper()
        mapping = {
            "ROUTED": ("ROUTED", "READY"),
            "READY_FOR_EXECUTION": ("READY_TO_EXECUTE", "READY"),
            "NEEDS_CLARIFICATION": ("NEEDS_CLARIFICATION", "WAITING_USER"),
            "COMPLETED": ("COMPLETED", "DONE"),
            "FAILED": ("FAILED", "ERROR"),
        }
        return mapping.get(status, ("ROUTED", "READY"))

    def _build_assistant_message(
        self,
        *,
        phase: str,
        route_result: JsonDict,
        execution_result: JsonDict | None,
    ) -> JsonDict:
        content = ""
        action_result = execution_result.get("action_result") if execution_result else None
        if isinstance(action_result, dict):
            content = str(action_result.get("content") or "").strip()

        if not content and phase == "NEEDS_CLARIFICATION":
            reply = str(route_result.get("reply") or "").strip()
            missing_fields = list(route_result.get("missing_fields") or [])
            if missing_fields:
                content = f"{reply}\n当前还需要补充：{', '.join(missing_fields)}。"
            else:
                content = reply

        if not content and phase == "ROUTED":
            if route_result.get("intent") == OTHER:
                content = (
                    "我还不能稳定判断这轮该执行哪类创作动作。你可以直接说“总结当前状态”"
                    "“给我两个核心角色备选”或“把当前剧情往前推进”。"
                )
            else:
                content = str(route_result.get("reply") or "").strip()

        if not content and phase == "FAILED":
            content = "当前这轮交互未能完成，请稍后重试。"

        if not content:
            content = str(route_result.get("reply") or "").strip() or "当前已收到你的请求。"

        return {
            "role": "assistant",
            "content": content,
        }

    def _build_next_action(self, *, phase: str, route_result: JsonDict) -> JsonDict:
        if phase == "NEEDS_CLARIFICATION":
            return {
                "type": "ASK_USER",
                "expected_inputs": list(route_result.get("missing_fields") or []),
            }
        if phase == "COMPLETED":
            return {"type": "SHOW_RESULT", "expected_inputs": []}
        if phase == "FAILED":
            return {"type": "RETRY_SYSTEM", "expected_inputs": []}
        if phase == "ROUTED":
            return {"type": "ASK_USER", "expected_inputs": []}
        return {"type": "NO_FURTHER_ACTION", "expected_inputs": []}

    def _build_clarification(
        self,
        *,
        phase: str,
        interaction_id: str,
        route_result: JsonDict,
        slot_resolution: JsonDict | None = None,
        clarification_row: JsonDict | None = None,
    ) -> JsonDict | None:
        if phase != "NEEDS_CLARIFICATION":
            return None
        if clarification_row:
            return self._clarification_from_row(clarification_row)
        slot_resolution = slot_resolution or {}
        return {
            "clarification_id": f"clar_{interaction_id}",
            "source_interaction_id": interaction_id,
            "status": "OPEN",
            "required_fields": list(
                slot_resolution.get("blocked_missing_fields")
                or route_result.get("missing_fields")
                or []
            ),
            "optional_fields": list(slot_resolution.get("optional_fields") or []),
            "current_parameters": route_result.get("parameters") or {},
        }

    def _build_slot_context(self, work_id: str) -> JsonDict:
        work = self.service.get_work(work_id)
        character_names = [
            str(item.get("name") or "").strip()
            for item in self.service.repos.characters.list_by_work(work_id)
            if str(item.get("name") or "").strip()
        ]
        return {
            "work_title": str(work.get("title") or "").strip(),
            "character_names": character_names,
            "active_chapter_id": str(work.get("active_chapter_id") or "").strip(),
        }

    def _find_active_clarification(
        self,
        *,
        work_id: str,
        clarification_target_interaction_id: str | None,
    ) -> JsonDict | None:
        if clarification_target_interaction_id:
            return self.service.repos.clarification_states.get_open_by_source_interaction(
                clarification_target_interaction_id
            )
        open_items = self.service.repos.clarification_states.list_open_by_work(work_id)
        if len(open_items) == 1:
            return open_items[0]
        return None

    def _should_continue_clarification(
        self,
        *,
        clarification_state: JsonDict,
        route_result: JsonDict,
        explicit_target: bool,
    ) -> bool:
        if explicit_target:
            return True
        route_intent = str(route_result.get("intent") or "")
        clarification_intent = str(clarification_state.get("intent") or "")
        if route_intent == OTHER:
            return True
        return route_intent == clarification_intent

    def _sync_clarification_state(
        self,
        *,
        work_id: str,
        packet: JsonDict,
        interaction_id: str | None,
        slot_resolution: JsonDict,
        assistant_message: JsonDict,
        active_clarification: JsonDict | None,
    ) -> JsonDict | None:
        if not interaction_id:
            return None
        phase, _ = self._map_phase_and_status(packet.get("status"))
        if phase == "NEEDS_CLARIFICATION":
            return self._upsert_open_clarification(
                work_id=work_id,
                interaction_id=interaction_id,
                packet=packet,
                slot_resolution=slot_resolution,
                assistant_message=assistant_message,
                existing=active_clarification,
            )
        if active_clarification and phase == "COMPLETED":
            self._close_clarification(
                active_clarification,
                status="RESOLVED",
                resolution={
                    "close_reason": "resolved",
                    "resolved_by_interaction_id": interaction_id,
                },
            )
        return None

    def _upsert_open_clarification(
        self,
        *,
        work_id: str,
        interaction_id: str,
        packet: JsonDict,
        slot_resolution: JsonDict,
        assistant_message: JsonDict,
        existing: JsonDict | None,
    ) -> JsonDict:
        now = now_ms()
        route_result = packet.get("routeResult") or {}
        created_at = existing["created_at"] if existing else now
        source_interaction_id = (
            str(existing.get("source_interaction_id") or "").strip() if existing else interaction_id
        )
        record = {
            "id": existing["id"] if existing else f"clar_{interaction_id}",
            "work_id": work_id,
            "source_interaction_id": source_interaction_id,
            "intent": str(route_result.get("intent") or ""),
            "status": "OPEN",
            "required_fields_json": json_text(
                list(slot_resolution.get("blocked_missing_fields") or []),
                fallback=[],
            ),
            "optional_fields_json": json_text(
                list(slot_resolution.get("optional_fields") or []),
                fallback=[],
            ),
            "current_parameters_json": json_text(
                route_result.get("parameters") or {},
                fallback={},
            ),
            "prompt_message_json": json_text(assistant_message, fallback={}),
            "resolution_json": json_text({}, fallback={}),
            "created_at": created_at,
            "updated_at": now,
            "closed_at": None,
        }
        return self.service.repos.clarification_states.save(record)

    def _close_clarification(
        self,
        clarification_state: JsonDict,
        *,
        status: str,
        resolution: JsonDict,
    ) -> JsonDict:
        now = now_ms()
        record = {
            **clarification_state,
            "status": status,
            "resolution_json": json_text(resolution, fallback={}),
            "updated_at": now,
            "closed_at": now,
        }
        return self.service.repos.clarification_states.save(record)

    def _clarification_from_row(self, row: JsonDict) -> JsonDict:
        return {
            "clarification_id": row["id"],
            "source_interaction_id": row["source_interaction_id"],
            "status": row["status"],
            "required_fields": self.service._parse_json_text(
                row.get("required_fields_json"),
                default=[],
            ),
            "optional_fields": self.service._parse_json_text(
                row.get("optional_fields_json"),
                default=[],
            ),
            "current_parameters": self.service._parse_json_text(
                row.get("current_parameters_json"),
                default={},
            ),
            "resolution": self.service._parse_json_text(
                row.get("resolution_json"),
                default={},
            ),
        }

    def _merge_nonblank_parameters(self, base: JsonDict, patch: JsonDict) -> JsonDict:
        merged = deepcopy(base)
        for key, value in (patch or {}).items():
            if self._is_blank(value):
                continue
            merged[key] = value
        return merged

    def _clarification_reply(self, *, route_result: JsonDict) -> str:
        reply = str(route_result.get("reply") or "").strip()
        if reply and route_result.get("intent") != OTHER:
            return reply
        return "已收到这轮补充信息。"

    def _is_blank(self, value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return not value.strip()
        if isinstance(value, (list, dict)):
            return len(value) == 0
        return False
