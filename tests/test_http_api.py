from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from novel_workbench.http_api import create_server
from novel_workbench.router.service import RouterService


AGENT_TURN_TOP_LEVEL_FIELDS = {
    "interaction_id",
    "user_message",
    "phase",
    "status",
    "assistant_message",
    "route_result",
    "execution_result",
    "validation",
    "slot_resolution",
    "clarification",
    "next_action",
    "ui_hints",
    "timestamps",
}

ALLOWED_PHASES = {
    "RECEIVED",
    "ROUTED",
    "NEEDS_CLARIFICATION",
    "READY_TO_EXECUTE",
    "EXECUTING",
    "COMPLETED",
    "FAILED",
}

ALLOWED_STATUSES = {
    "WAITING_USER",
    "READY",
    "RUNNING",
    "DONE",
    "ERROR",
}

ALLOWED_NEXT_ACTION_TYPES = {
    "ASK_USER",
    "EXECUTE_DIRECTLY",
    "SHOW_RESULT",
    "RETRY_SYSTEM",
    "NO_FURTHER_ACTION",
}


class HttpApiTest(unittest.TestCase):
    def test_server_factory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Path(tmpdir) / "api.sqlite3"
            web = Path(tmpdir)
            (web / "index.html").write_text("<html></html>", encoding="utf-8")
            fake_server = object()
            with patch(
                "novel_workbench.http_api.ThreadingHTTPServer", return_value=fake_server
            ) as factory:
                server = create_server(host="127.0.0.1", port=0, db_path=db, static_dir=web)
            self.assertIs(server, fake_server)
            factory.assert_called_once()


class _AgentStubs:
    """Patch both RouterService.route and llm_client.chat/chat_json so tests
    don't reach out to a real LLM. Executors fall back to their built-in stub
    output when llm_client raises."""

    def __init__(self) -> None:
        self._queue: list[dict] = []
        self._patchers: list = []

    def enqueue(self, route_result: dict) -> None:
        self._queue.append(route_result)

    def __enter__(self) -> "_AgentStubs":
        queue = self._queue

        def fake_route(self, text, *, router_context=None):  # noqa: ARG001
            if not queue:
                raise AssertionError("RouterService.route called but queue is empty")
            return queue.pop(0)

        def raise_offline(*args, **kwargs):  # noqa: ARG001
            raise ConnectionError("LLM disabled in tests")

        self._patchers = [
            patch.object(RouterService, "route", fake_route),
            patch("novel_workbench.services.llm_client.chat", raise_offline),
            patch("novel_workbench.services.llm_client.chat_json", raise_offline),
            patch(
                "novel_workbench.executors.summarize_current_state.llm_client.chat",
                raise_offline,
            ),
            patch(
                "novel_workbench.executors.advance_plot.llm_client.chat",
                raise_offline,
            ),
            patch(
                "novel_workbench.executors.refine_existing_character.llm_client.chat",
                raise_offline,
            ),
            patch(
                "novel_workbench.executors.create_character_candidates.llm_client.chat",
                raise_offline,
            ),
        ]
        for p in self._patchers:
            p.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        for p in reversed(self._patchers):
            p.stop()


class InteractionsContractTest(unittest.TestCase):
    """End-to-end contract tests for POST/GET /api/works/{id}/interactions."""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        tmp = Path(self.tmpdir.name)
        self.db_path = tmp / "api.sqlite3"
        (tmp / "index.html").write_text("<html></html>", encoding="utf-8")
        self.server = create_server(
            host="127.0.0.1", port=0, db_path=self.db_path, static_dir=tmp
        )
        self.host, self.port = self.server.server_address
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.work_id = self._create_work()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tmpdir.cleanup()

    # --- helpers -------------------------------------------------------

    def _request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        conn = HTTPConnection(self.host, self.port, timeout=5)
        try:
            raw = json.dumps(body).encode("utf-8") if body is not None else None
            headers = {"Content-Type": "application/json"} if raw else {}
            conn.request(method, path, body=raw, headers=headers)
            response = conn.getresponse()
            payload = response.read().decode("utf-8")
            data = json.loads(payload) if payload else {}
            return response.status, data
        finally:
            conn.close()

    def _create_work(self) -> str:
        status, data = self._request(
            "POST",
            "/api/works",
            {
                "title": "契约测试作品",
                "oneLinePitch": "为 /interactions 冻结 shape。",
                "genre": "都市",
            },
        )
        self.assertEqual(status, 201)
        return data["work"]["id"]

    def _post_interaction(self, message: str, target: str | None = None) -> tuple[int, dict]:
        body: dict = {"user_message": message}
        if target is not None:
            body["clarification_target_interaction_id"] = target
        return self._request(
            "POST", f"/api/works/{self.work_id}/interactions", body
        )

    def _assert_agent_turn_shape(self, turn: dict) -> None:
        self.assertEqual(set(turn.keys()), AGENT_TURN_TOP_LEVEL_FIELDS)
        self.assertIn(turn["phase"], ALLOWED_PHASES)
        self.assertIn(turn["status"], ALLOWED_STATUSES)

        self.assertIsInstance(turn["assistant_message"], dict)
        self.assertEqual(turn["assistant_message"].get("role"), "assistant")
        self.assertIsInstance(turn["assistant_message"].get("content"), str)
        self.assertTrue(turn["assistant_message"]["content"].strip())

        self.assertIsInstance(turn["route_result"], dict)
        self.assertIsInstance(turn["validation"], dict)
        self.assertIn("router", turn["validation"])
        self.assertIn("executor", turn["validation"])

        slot = turn["slot_resolution"]
        self.assertIsInstance(slot, dict)
        for key in ("inferred_fields", "autofilled_fields", "remaining_missing_fields"):
            self.assertIn(key, slot)
            self.assertIsInstance(slot[key], list)

        self.assertIn(turn["next_action"]["type"], ALLOWED_NEXT_ACTION_TYPES)
        self.assertIn("expected_inputs", turn["next_action"])

        ui = turn["ui_hints"]
        self.assertEqual(ui.get("render_mode"), "chat")
        self.assertIn("show_retry", ui)
        self.assertIn("show_structured_card", ui)

        ts = turn["timestamps"]
        self.assertIn("created_at", ts)
        self.assertIn("updated_at", ts)

    # --- tests ---------------------------------------------------------

    def test_post_interaction_returns_completed_agent_turn_shape(self) -> None:
        router = _AgentStubs()
        router.enqueue(
            {
                "intent": "SUMMARIZE_CURRENT_STATE",
                "parameters": {
                    "work_name": "契约测试作品",
                    "summary_scope": "current_work",
                    "summary_focus": [],
                },
                "missing_fields": [],
                "confidence": 0.95,
                "reply": "已识别为总结当前作品状态的请求。",
            }
        )
        with router:
            status, turn = self._post_interaction("总结一下现在情况")

        self.assertEqual(status, 201)
        self._assert_agent_turn_shape(turn)
        self.assertEqual(turn["phase"], "COMPLETED")
        self.assertEqual(turn["status"], "DONE")
        self.assertIsNone(turn["clarification"])
        self.assertIsNotNone(turn["execution_result"])
        self.assertEqual(turn["next_action"]["type"], "SHOW_RESULT")

    def test_post_interaction_returns_clarification_schema(self) -> None:
        router = _AgentStubs()
        router.enqueue(
            {
                "intent": "REFINE_EXISTING_CHARACTER",
                "parameters": {
                    "work_name": "契约测试作品",
                    "character_name": "",
                    "refine_dimensions": [],
                    "current_basis": "",
                    "constraints": [],
                },
                "missing_fields": ["character_name", "refine_dimensions"],
                "confidence": 0.96,
                "reply": "已识别为对现有角色设定进行细化的请求。",
            }
        )
        with router:
            status, turn = self._post_interaction("把角色再细一点")

        self.assertEqual(status, 201)
        self._assert_agent_turn_shape(turn)
        self.assertEqual(turn["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(turn["status"], "WAITING_USER")
        self.assertEqual(turn["next_action"]["type"], "ASK_USER")
        self.assertIsNone(turn["execution_result"])

        clarification = turn["clarification"]
        self.assertIsInstance(clarification, dict)
        for key in (
            "clarification_id",
            "source_interaction_id",
            "status",
            "required_fields",
            "optional_fields",
            "current_parameters",
        ):
            self.assertIn(key, clarification)
        self.assertEqual(clarification["status"], "OPEN")
        self.assertEqual(clarification["source_interaction_id"], turn["interaction_id"])
        self.assertIn("character_name", clarification["required_fields"])

    def test_get_interactions_returns_items_list_of_agent_turns(self) -> None:
        router = _AgentStubs()
        router.enqueue(
            {
                "intent": "SUMMARIZE_CURRENT_STATE",
                "parameters": {
                    "work_name": "契约测试作品",
                    "summary_scope": "current_work",
                    "summary_focus": [],
                },
                "missing_fields": [],
                "confidence": 0.95,
                "reply": "已识别为总结当前作品状态的请求。",
            }
        )
        with router:
            self._post_interaction("总结一下现在情况")

        status, data = self._request(
            "GET", f"/api/works/{self.work_id}/interactions"
        )
        self.assertEqual(status, 200)
        self.assertIn("items", data)
        self.assertNotIn("interactions", data)
        self.assertNotIn("rows", data)
        self.assertEqual(len(data["items"]), 1)
        self._assert_agent_turn_shape(data["items"][0])

    def test_get_interactions_is_stable_when_workspace_state_changes(self) -> None:
        """Replay must return the same AgentTurnResult even after the work's
        title or characters change. This locks the contract in docs/15 §4 and
        docs/16 §1."""

        router = _AgentStubs()
        router.enqueue(
            {
                "intent": "CREATE_CHARACTER_CANDIDATES",
                "parameters": {
                    "work_name": "契约测试作品",
                    "plot_scope": "",
                    "generation_target": "new_character_candidates",
                    "candidate_count": None,
                    "role_type": "",
                    "selection_flow": "",
                    "constraints": [],
                },
                "missing_fields": [
                    "plot_scope",
                    "candidate_count",
                    "role_type",
                    "selection_flow",
                    "constraints",
                ],
                "confidence": 0.97,
                "reply": "已识别为基于当前剧情生成角色候选的请求。",
            }
        )
        with router:
            post_status, post_turn = self._post_interaction("给我两个核心角色备选")
        self.assertEqual(post_status, 201)
        self.assertEqual(post_turn["phase"], "COMPLETED")

        original_slot = post_turn["slot_resolution"]
        self.assertTrue(
            original_slot["autofilled_fields"],
            "autofilled_fields should contain defaulted fields at write time",
        )

        # Mutate workspace state: rename the work and add characters.
        from novel_workbench import WorkbenchService, open_sqlite

        with open_sqlite(self.db_path) as conn:
            service = WorkbenchService(conn)
            service.refine_character(work_id=self.work_id, name="秦婉")
            service.refine_character(work_id=self.work_id, name="顾清岚")
            work_row = service.repos.works.get(self.work_id)
            work_row = dict(work_row)
            work_row["title"] = "改名后的作品"
            service.repos.works.save(work_row)

        status, data = self._request(
            "GET", f"/api/works/{self.work_id}/interactions"
        )
        self.assertEqual(status, 200)
        replayed = next(
            item
            for item in data["items"]
            if item["interaction_id"] == post_turn["interaction_id"]
        )

        self.assertEqual(
            replayed["slot_resolution"],
            original_slot,
            "slot_resolution must be stable across replays regardless of current workspace state",
        )
        self.assertEqual(replayed["route_result"], post_turn["route_result"])
        self.assertEqual(replayed["execution_result"], post_turn["execution_result"])
        self.assertEqual(
            replayed["assistant_message"], post_turn["assistant_message"]
        )


if __name__ == "__main__":
    unittest.main()
