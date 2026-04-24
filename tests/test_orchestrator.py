from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_workbench import WorkbenchService, open_sqlite
from novel_workbench.orchestrator import AgentOrchestrator


class AgentOrchestratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tmpdir.name) / "orchestrator.sqlite3"
        self.conn_cm = open_sqlite(self.db)
        self.conn = self.conn_cm.__enter__()
        self.service = WorkbenchService(self.conn)
        snapshot = self.service.create_work_seed(
            title="编排测试",
            one_line_pitch="主角被迫面对更大的棋局。",
            genre="悬疑",
        )
        self.work_id = snapshot["work"]["id"]
        self.service.refine_character(work_id=self.work_id, name="秦婉")
        self.orchestrator = AgentOrchestrator(self.service)

    def tearDown(self) -> None:
        self.conn_cm.__exit__(None, None, None)
        self.tmpdir.cleanup()

    def test_orchestrate_turn_returns_completed_agent_turn_result(self) -> None:
        route_result = {
            "intent": "SUMMARIZE_CURRENT_STATE",
            "parameters": {
                "work_name": "编排测试",
                "summary_scope": "current_work",
                "summary_focus": [],
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为总结当前作品状态的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="总结一下现在情况",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["status"], "DONE")
        self.assertIn("assistant_message", result)
        self.assertIn("content", result["assistant_message"])
        self.assertIn("当前作品状态总结", result["assistant_message"]["content"])
        self.assertEqual(result["user_message"], "总结一下现在情况")
        self.assertEqual(result["route_result"]["intent"], "SUMMARIZE_CURRENT_STATE")
        self.assertIsNotNone(result["execution_result"])
        self.assertEqual(result["next_action"]["type"], "SHOW_RESULT")

    def test_orchestrate_turn_infers_and_executes_character_candidates(self) -> None:
        route_result = {
            "intent": "CREATE_CHARACTER_CANDIDATES",
            "parameters": {
                "work_name": "编排测试",
                "plot_scope": "current_plot",
                "generation_target": "new_character_candidates",
                "candidate_count": None,
                "role_type": "",
                "selection_flow": "",
                "constraints": [],
            },
            "missing_fields": ["candidate_count", "role_type", "selection_flow"],
            "confidence": 0.97,
            "reply": "",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="给我两个核心角色备选",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["status"], "DONE")
        self.assertEqual(result["slot_resolution"]["inferred_fields"], ["candidate_count", "role_type"])
        self.assertEqual(result["slot_resolution"]["remaining_missing_fields"], [])
        self.assertEqual(result["route_result"]["parameters"]["candidate_count"], 2)
        self.assertEqual(result["route_result"]["parameters"]["role_type"], "core_roles")
        self.assertIsNotNone(result["execution_result"])
        self.assertIsNone(result["clarification"])
        self.assertEqual(result["next_action"]["type"], "SHOW_RESULT")

    def test_orchestrate_turn_clarifies_ambiguous_character_creation(self) -> None:
        route_result = {
            "intent": "CREATE_CHARACTER_CANDIDATES",
            "parameters": {
                "work_name": "编排测试",
                "plot_scope": "",
                "generation_target": "new_character_candidates",
                "candidate_count": None,
                "role_type": "",
                "selection_flow": "",
                "constraints": [],
            },
            "missing_fields": [],
            "confidence": 0.91,
            "reply": "已识别为基于当前剧情生成角色候选的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="创建角色",
            )
        self.assertEqual(result["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(result["status"], "WAITING_USER")
        self.assertIsNone(result["execution_result"])
        self.assertEqual(
            result["slot_resolution"]["remaining_missing_fields"],
            ["candidate_count", "role_type"],
        )
        self.assertEqual(
            result["next_action"]["expected_inputs"],
            ["candidate_count", "role_type"],
        )
        self.assertIn("candidate_count", result["assistant_message"]["content"])
        self.assertIn("role_type", result["assistant_message"]["content"])

    def test_orchestrate_turn_returns_clarification_shape_for_required_fields(self) -> None:
        route_result = {
            "intent": "REFINE_EXISTING_CHARACTER",
            "parameters": {
                "work_name": "编排测试",
                "character_name": "",
                "refine_dimensions": [],
                "current_basis": "",
                "constraints": [],
            },
            "missing_fields": ["character_name", "refine_dimensions"],
            "confidence": 0.96,
            "reply": "已识别为对现有角色设定进行细化的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把角色再细一点",
            )
        self.assertEqual(result["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(result["status"], "WAITING_USER")
        self.assertEqual(result["slot_resolution"]["remaining_missing_fields"], ["character_name"])
        self.assertIsNone(result["execution_result"])
        self.assertIsNotNone(result["clarification"])
        self.assertEqual(result["next_action"]["type"], "ASK_USER")
        self.assertIn("character_name", result["assistant_message"]["content"])
        open_items = self.service.repos.clarification_states.list_open_by_work(self.work_id)
        self.assertEqual(len(open_items), 1)
        self.assertEqual(open_items[0]["source_interaction_id"], result["interaction_id"])

    def test_orchestrate_turn_resolves_clarification_on_followup_answer(self) -> None:
        initial_route = {
            "intent": "REFINE_EXISTING_CHARACTER",
            "parameters": {
                "work_name": "编排测试",
                "character_name": "",
                "refine_dimensions": [],
                "current_basis": "",
                "constraints": [],
            },
            "missing_fields": ["character_name", "refine_dimensions"],
            "confidence": 0.96,
            "reply": "已识别为对现有角色设定进行细化的请求。",
        }
        followup_route = {
            "intent": "OTHER",
            "parameters": {},
            "missing_fields": [],
            "confidence": 0.55,
            "reply": "",
        }
        with patch.object(
            self.service.router,
            "route",
            side_effect=[initial_route, followup_route],
        ):
            first = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把角色再细一点",
            )
            second = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="秦婉，狠一点",
                clarification_target_interaction_id=first["interaction_id"],
            )
        self.assertEqual(first["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(second["phase"], "COMPLETED")
        self.assertEqual(second["status"], "DONE")
        self.assertIsNone(second["clarification"])
        open_items = self.service.repos.clarification_states.list_open_by_work(self.work_id)
        self.assertEqual(open_items, [])
        clarification = self.service.repos.clarification_states.get_latest_by_source_interaction(
            first["interaction_id"]
        )
        self.assertIsNotNone(clarification)
        self.assertEqual(clarification["status"], "RESOLVED")
        resolution = self.service._parse_json_text(
            clarification["resolution_json"],
            default={},
        )
        self.assertEqual(resolution["resolved_by_interaction_id"], second["interaction_id"])

    def test_orchestrate_turn_supersedes_open_clarification_on_new_intent(self) -> None:
        initial_route = {
            "intent": "REFINE_EXISTING_CHARACTER",
            "parameters": {
                "work_name": "编排测试",
                "character_name": "",
                "refine_dimensions": [],
                "current_basis": "",
                "constraints": [],
            },
            "missing_fields": ["character_name", "refine_dimensions"],
            "confidence": 0.96,
            "reply": "已识别为对现有角色设定进行细化的请求。",
        }
        summarize_route = {
            "intent": "SUMMARIZE_CURRENT_STATE",
            "parameters": {
                "work_name": "编排测试",
                "summary_scope": "current_work",
                "summary_focus": [],
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为总结当前作品状态的请求。",
        }
        with patch.object(
            self.service.router,
            "route",
            side_effect=[initial_route, summarize_route],
        ):
            first = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把角色再细一点",
            )
            second = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="总结一下现在情况",
            )
        self.assertEqual(first["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(second["phase"], "COMPLETED")
        clarification = self.service.repos.clarification_states.get_latest_by_source_interaction(
            first["interaction_id"]
        )
        self.assertIsNotNone(clarification)
        self.assertEqual(clarification["status"], "SUPERSEDED")
        resolution = self.service._parse_json_text(
            clarification["resolution_json"],
            default={},
        )
        self.assertEqual(resolution["superseded_by_interaction_id"], second["interaction_id"])

    def test_list_turns_returns_items_in_agent_turn_shape(self) -> None:
        route_result = {
            "intent": "SUMMARIZE_CURRENT_STATE",
            "parameters": {
                "work_name": "编排测试",
                "summary_scope": "current_work",
                "summary_focus": [],
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为总结当前作品状态的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            created = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="总结一下现在情况",
            )
        turns = self.orchestrator.list_turns(work_id=self.work_id)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["interaction_id"], created["interaction_id"])
        self.assertEqual(turns[0]["user_message"], "总结一下现在情况")
        self.assertIn("assistant_message", turns[0])
        self.assertIn("timestamps", turns[0])

    def test_list_turns_preserves_clarification_resolution_details(self) -> None:
        initial_route = {
            "intent": "REFINE_EXISTING_CHARACTER",
            "parameters": {
                "work_name": "编排测试",
                "character_name": "",
                "refine_dimensions": [],
                "current_basis": "",
                "constraints": [],
            },
            "missing_fields": ["character_name", "refine_dimensions"],
            "confidence": 0.96,
            "reply": "已识别为对现有角色设定进行细化的请求。",
        }
        followup_route = {
            "intent": "OTHER",
            "parameters": {},
            "missing_fields": [],
            "confidence": 0.55,
            "reply": "",
        }
        with patch.object(
            self.service.router,
            "route",
            side_effect=[initial_route, followup_route],
        ):
            first = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把角色再细一点",
            )
            self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="秦婉，狠一点",
                clarification_target_interaction_id=first["interaction_id"],
            )
        turns = self.orchestrator.list_turns(work_id=self.work_id)
        original = next(item for item in turns if item["interaction_id"] == first["interaction_id"])
        self.assertIsNotNone(original["clarification"])
        self.assertEqual(original["clarification"]["status"], "RESOLVED")
        self.assertEqual(
            original["clarification"]["resolution"]["close_reason"],
            "resolved",
        )


class AgentOrchestratorChapterIntentsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tmpdir.name) / "orchestrator_chapters.sqlite3"
        self.conn_cm = open_sqlite(self.db)
        self.conn = self.conn_cm.__enter__()
        self.service = WorkbenchService(self.conn)
        snapshot = self.service.create_work_seed(
            title="章节流程测试",
            one_line_pitch="主角必须赶在截稿日前稳住第一章。",
            genre="都市",
        )
        self.work_id = snapshot["work"]["id"]
        self.active_chapter_id = snapshot["work"]["active_chapter_id"]
        self.orchestrator = AgentOrchestrator(self.service)

    def tearDown(self) -> None:
        self.conn_cm.__exit__(None, None, None)
        self.tmpdir.cleanup()

    def _route_for(self, intent: str, parameters: dict) -> dict:
        return {
            "intent": intent,
            "parameters": parameters,
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "",
        }

    def _fake_outline_payload(self) -> dict:
        return {
            "function": "点燃首章钩子",
            "core_event": "主角被迫接下一个不想接的委托",
            "conflict": "时间紧任务重，支援断线",
            "summary": "从被动观望走向主动出手，留下悬念。",
            "info_points": ["主角的处境", "真正的威胁", "下一步必须做什么"],
            "character_progress": "犹豫 -> 被迫决断",
            "emotional_progress": "不安 -> 压迫感",
            "worldbuilding_progress": "露出一角系统规则",
            "ending_hook": "一个必须立刻回应的电话。",
        }

    def test_generate_chapter_outline_runs_via_orchestrator(self) -> None:
        route = self._route_for(
            "GENERATE_CHAPTER_OUTLINE",
            {"work_name": "章节流程测试", "instruction_text": "", "rewrite_mode": "default"},
        )
        with patch.object(self.service.router, "route", return_value=route), \
             patch("novel_workbench.services.workbench.llm_client.chat_json", return_value=self._fake_outline_payload()):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="给我生成第一章细纲",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["route_result"]["intent"], "GENERATE_CHAPTER_OUTLINE")
        self.assertEqual(
            result["route_result"]["parameters"]["chapter_id"],
            self.active_chapter_id,
        )
        self.assertIn("chapter_id", result["slot_resolution"]["autofilled_fields"])
        action_result = result["execution_result"]["action_result"]
        self.assertEqual(action_result["type"], "chapter_outline")
        self.assertIn("章节细纲已生成", action_result["content"])
        self.assertIn("workbench", action_result)
        self.assertIn("chapters", action_result["workbench"])

    def test_draft_chapter_runs_via_orchestrator(self) -> None:
        # Prerequisite: chapter must be outlined before drafting
        self.service.generate_chapter_outline = self._wrapped_generate_outline()
        self.service.generate_chapter_outline(
            work_id=self.work_id,
            chapter_id=self.active_chapter_id,
        )

        route = self._route_for(
            "DRAFT_CHAPTER",
            {"work_name": "章节流程测试", "instruction_text": "", "rewrite_mode": "default"},
        )
        fake_draft_text = "第一章正文草稿：主角接到了那个电话，然后立刻动身。" * 20
        with patch.object(self.service.router, "route", return_value=route), \
             patch("novel_workbench.services.workbench.llm_client.chat", return_value=fake_draft_text):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把这一章写出来",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["route_result"]["intent"], "DRAFT_CHAPTER")
        action_result = result["execution_result"]["action_result"]
        self.assertEqual(action_result["type"], "chapter_draft")
        self.assertIn("正文草稿", action_result["content"])

    def test_revise_draft_runs_via_orchestrator(self) -> None:
        self.service.generate_chapter_outline = self._wrapped_generate_outline()
        self.service.generate_chapter_outline(
            work_id=self.work_id,
            chapter_id=self.active_chapter_id,
        )
        with patch("novel_workbench.services.workbench.llm_client.chat", return_value="首稿正文" * 100):
            self.service.draft_chapter(
                work_id=self.work_id,
                chapter_id=self.active_chapter_id,
            )

        route = self._route_for(
            "REVISE_DRAFT",
            {"work_name": "章节流程测试", "instruction_text": "节奏再紧一点", "revise_mode": "revise_direct"},
        )
        with patch.object(self.service.router, "route", return_value=route), \
             patch("novel_workbench.services.workbench.llm_client.chat", return_value="修订版正文" * 100):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="把这一版改得更紧凑一点",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["route_result"]["intent"], "REVISE_DRAFT")
        action_result = result["execution_result"]["action_result"]
        self.assertEqual(action_result["type"], "chapter_revise")
        self.assertIn("修订草稿", action_result["content"])

    def test_enter_read_mode_runs_via_orchestrator(self) -> None:
        route = self._route_for("ENTER_READ_MODE", {"work_name": "章节流程测试"})
        with patch.object(self.service.router, "route", return_value=route):
            result = self.orchestrator.orchestrate_turn(
                work_id=self.work_id,
                user_message="进入阅读模式",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["route_result"]["intent"], "ENTER_READ_MODE")
        action_result = result["execution_result"]["action_result"]
        self.assertEqual(action_result["type"], "read_mode")
        self.assertIn("阅读模式", action_result["content"])
        self.assertIn("readingProjection", action_result)
        self.assertEqual(
            action_result["readingProjection"]["workId"],
            self.work_id,
        )

    def _wrapped_generate_outline(self):
        original = self.service.__class__.generate_chapter_outline
        payload = self._fake_outline_payload()

        def wrapper(*args, **kwargs):
            with patch(
                "novel_workbench.services.workbench.llm_client.chat_json",
                return_value=payload,
            ):
                return original(self.service, *args, **kwargs)

        return wrapper


class AgentOrchestratorWorklessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tmpdir.name) / "orchestrator_workless.sqlite3"
        self.conn_cm = open_sqlite(self.db)
        self.conn = self.conn_cm.__enter__()
        self.service = WorkbenchService(self.conn)
        self.orchestrator = AgentOrchestrator(self.service)

    def tearDown(self) -> None:
        self.conn_cm.__exit__(None, None, None)
        self.tmpdir.cleanup()

    def test_workless_create_work_seed_executes_and_persists(self) -> None:
        route_result = {
            "intent": "CREATE_WORK_SEED",
            "parameters": {
                "title": "风起",
                "one_line_pitch": "海员少年卷入一桩陈年命案。",
                "genre": "悬疑",
                "target_platform": "",
                "target_audience": "",
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为创建新作品立项底稿的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_workless_turn(
                user_message="创建作品《风起》，题材悬疑，主角海员卷入陈年命案",
            )
        self.assertEqual(result["phase"], "COMPLETED")
        self.assertEqual(result["status"], "DONE")
        self.assertEqual(result["route_result"]["intent"], "CREATE_WORK_SEED")
        action_result = result["execution_result"]["action_result"]
        self.assertEqual(action_result["type"], "work_seed")
        new_work_id = action_result["workId"]
        self.assertTrue(new_work_id)
        self.assertIn("《风起》", action_result["content"])
        self.assertTrue(result["interaction_id"])
        rows = self.service.repos.interaction_logs.list_by_work(new_work_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "COMPLETED")

    def test_workless_non_create_intent_returns_routed_without_persist(self) -> None:
        route_result = {
            "intent": "CREATE_CHARACTER_CANDIDATES",
            "parameters": {
                "work_name": "",
                "plot_scope": "",
                "generation_target": "new_character_candidates",
                "candidate_count": None,
                "role_type": "",
                "selection_flow": "",
                "constraints": [],
            },
            "missing_fields": ["work_name"],
            "confidence": 0.9,
            "reply": "",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_workless_turn(
                user_message="给我两个核心角色备选",
            )
        self.assertEqual(result["phase"], "ROUTED")
        self.assertEqual(result["status"], "READY")
        self.assertIn("请先创建作品", result["assistant_message"]["content"])
        self.assertFalse(result["interaction_id"])
        self.assertEqual(self.service.repos.works.list_all(), [])

    def test_workless_create_work_seed_missing_fields_returns_clarification(self) -> None:
        route_result = {
            "intent": "CREATE_WORK_SEED",
            "parameters": {
                "title": "风起",
                "one_line_pitch": "",
                "genre": "",
                "target_platform": "",
                "target_audience": "",
            },
            "missing_fields": ["one_line_pitch", "genre"],
            "confidence": 0.85,
            "reply": "已识别为创建新作品立项底稿的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.orchestrator.orchestrate_workless_turn(
                user_message="帮我立项一本叫《风起》的书",
            )
        self.assertEqual(result["phase"], "NEEDS_CLARIFICATION")
        self.assertEqual(result["status"], "WAITING_USER")
        self.assertFalse(result["interaction_id"])
        remaining = result["slot_resolution"]["remaining_missing_fields"]
        self.assertIn("one_line_pitch", remaining)
        self.assertIn("genre", remaining)
        self.assertEqual(self.service.repos.works.list_all(), [])


if __name__ == "__main__":
    unittest.main()
