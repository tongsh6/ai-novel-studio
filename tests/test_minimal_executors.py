from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_workbench import WorkbenchService, open_sqlite


class MinimalExecutorsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tmpdir.name) / "exec.sqlite3"
        self.conn_cm = open_sqlite(self.db)
        self.conn = self.conn_cm.__enter__()
        self.service = WorkbenchService(self.conn)
        self.snapshot = self.service.create_work_seed(
            title="执行器测试",
            one_line_pitch="主角被迫进入一场更大的局。",
            genre="悬疑",
        )
        self.work_id = self.snapshot["work"]["id"]

    def tearDown(self) -> None:
        self.conn_cm.__exit__(None, None, None)
        self.tmpdir.cleanup()

    def test_process_interaction_summarize_persists_log(self) -> None:
        route_result = {
            "intent": "SUMMARIZE_CURRENT_STATE",
            "parameters": {
                "work_name": "执行器测试",
                "summary_scope": "current_work",
                "summary_focus": [],
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为总结当前作品状态的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.service.process_interaction(work_id=self.work_id, text="总结一下")
        self.assertEqual(result["status"], "COMPLETED")
        self.assertIn("executionResult", result)
        interactions = self.service.list_interactions(work_id=self.work_id)
        self.assertEqual(len(interactions), 1)

    def test_execute_router_result_for_advance_plot(self) -> None:
        route_result = {
            "intent": "ADVANCE_PLOT",
            "parameters": {
                "work_name": "执行器测试",
                "current_plot_scope": "current_plot",
                "advance_goal": "reasonable_next_progression",
                "target_position": "chapter_end_hook_ready",
                "constraints": [],
            },
            "missing_fields": [],
            "confidence": 0.94,
            "reply": "已识别为推进当前剧情的请求。",
        }
        result = self.service.execute_router_result(
            work_id=self.work_id,
            route_result=route_result,
            user_input="接下来怎么推进",
            persist=False,
        )
        self.assertEqual(result["status"], "COMPLETED")
        self.assertTrue(result["executionValidation"]["is_valid"])

    def test_chat_intent_executes_new_minimal_intent(self) -> None:
        route_result = {
            "intent": "SUMMARIZE_CURRENT_STATE",
            "parameters": {
                "work_name": "执行器测试",
                "summary_scope": "current_work",
                "summary_focus": [],
            },
            "missing_fields": [],
            "confidence": 0.95,
            "reply": "已识别为总结当前作品状态的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.service.chat_intent(work_id=self.work_id, text="总结一下现在情况")
        self.assertEqual(result["intent"], "SUMMARIZE_CURRENT_STATE")
        self.assertEqual(result["status"], "COMPLETED")
        self.assertIn("当前作品状态总结", result["reply"])

    def test_ensure_chapter_creates_and_activates_target_chapter(self) -> None:
        chapter = self.service.ensure_chapter(work_id=self.work_id, order_no=2, activate=True)
        self.assertEqual(chapter["order_no"], 2)
        work = self.service.get_work(self.work_id)
        self.assertEqual(work["active_chapter_id"], chapter["id"])

    def test_process_interaction_returns_routed_for_other_intent(self) -> None:
        route_result = {
            "intent": "OTHER",
            "parameters": {},
            "missing_fields": [],
            "confidence": 0.42,
            "reply": "已识别为暂时无法稳定归类的请求。",
        }
        with patch.object(self.service.router, "route", return_value=route_result):
            result = self.service.process_interaction(work_id=self.work_id, text="随便聊聊")
        self.assertEqual(result["status"], "ROUTED")
        self.assertNotIn("executionResult", result)

    def test_chat_intent_requires_work_context(self) -> None:
        result = self.service.chat_intent(work_id=None, text="总结一下")
        self.assertEqual(result["status"], "NEEDS_WORKBENCH")
        self.assertEqual(result["intent"], "OTHER")


if __name__ == "__main__":
    unittest.main()
