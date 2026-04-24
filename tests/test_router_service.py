from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_workbench.router.service import RouterService


FIXTURES = Path(__file__).parent / "fixtures" / "router_cases.json"


class RouterServiceTest(unittest.TestCase):
    def test_route_normalizes_fixture_result(self) -> None:
        fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))[0]
        service = RouterService()
        with patch("novel_workbench.router.service.llm_client.chat_json", return_value=fixture["result"]):
            result = service.route(
                fixture["request"],
                router_context={"minimal_context": {"work_name": "天龙"}},
            )
        self.assertEqual(result["intent"], "CREATE_CHARACTER_CANDIDATES")
        self.assertIn("missing_fields", result)
        self.assertEqual(result["parameters"]["work_name"], "天龙")

    def test_route_falls_back_to_normalized_other_on_llm_error(self) -> None:
        service = RouterService()
        with patch("novel_workbench.router.service.llm_client.chat_json", side_effect=RuntimeError("boom")):
            result = service.route("随便聊聊", router_context={"minimal_context": {"work_name": ""}})
        self.assertEqual(result["intent"], "OTHER")
        self.assertEqual(result["confidence"], 0.0)

    def test_route_continue_outlined_chapter_uses_context_without_llm(self) -> None:
        service = RouterService()
        router_context = {
            "chapter": {"id": "chapter-1", "title": "第1章", "status": "OUTLINED"},
            "minimal_context": {"work_name": "两个女人的江湖传说"},
        }
        with patch("novel_workbench.router.service.llm_client.chat_json") as chat_json:
            result = service.route("继续", router_context=router_context)
        chat_json.assert_not_called()
        self.assertEqual(result["intent"], "DRAFT_CHAPTER")
        self.assertEqual(result["parameters"]["work_name"], "两个女人的江湖传说")
        self.assertEqual(result["parameters"]["chapter_id"], "chapter-1")
        self.assertEqual(result["missing_fields"], [])
        self.assertGreaterEqual(result["confidence"], 0.9)

    def test_route_continue_backlog_chapter_generates_outline(self) -> None:
        service = RouterService()
        router_context = {
            "chapter": {"id": "chapter-1", "title": "第1章", "status": "BACKLOG"},
            "minimal_context": {"work_name": "章节流程测试"},
        }
        with patch("novel_workbench.router.service.llm_client.chat_json") as chat_json:
            result = service.route("接着写", router_context=router_context)
        chat_json.assert_not_called()
        self.assertEqual(result["intent"], "GENERATE_CHAPTER_OUTLINE")
        self.assertEqual(result["parameters"]["chapter_id"], "chapter-1")

    def test_route_continue_uses_context_after_empty_llm_content_error(self) -> None:
        service = RouterService()
        router_context = {
            "chapter": {"id": "chapter-1", "title": "第1章", "status": "OUTLINED"},
            "minimal_context": {"work_name": "两个女人的江湖传说"},
        }
        with patch(
            "novel_workbench.router.service.llm_client.chat_json",
            side_effect=RuntimeError("LLM returned empty content"),
        ) as chat_json:
            result = service.route("继续。", router_context=router_context)
        chat_json.assert_not_called()
        self.assertEqual(result["intent"], "DRAFT_CHAPTER")

    def test_route_ambiguous_create_character_command_uses_llm_result(self) -> None:
        service = RouterService()
        raw = {
            "intent": "CREATE_CHARACTER_CANDIDATES",
            "parameters": {
                "work_name": "",
                "plot_scope": "current_plot",
                "generation_target": "new_character_candidates",
                "candidate_count": None,
                "role_type": "",
                "selection_flow": "",
                "constraints": [],
            },
            "missing_fields": ["candidate_count", "role_type"],
            "confidence": 0.98,
            "reply": "",
        }
        with patch("novel_workbench.router.service.llm_client.chat_json", return_value=raw) as chat_json:
            result = service.route(
                "创建角色",
                router_context={"minimal_context": {"work_name": "天龙"}},
            )
        chat_json.assert_called_once()
        self.assertEqual(result["intent"], "CREATE_CHARACTER_CANDIDATES")
        self.assertEqual(result["parameters"]["work_name"], "天龙")
        self.assertEqual(result["missing_fields"], ["candidate_count", "role_type"])


if __name__ == "__main__":
    unittest.main()
