from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from novel_workbench import WorkbenchService, open_sqlite
from novel_workbench.context_manager import ContextManager


class ContextManagerTest(unittest.TestCase):
    def test_build_router_and_executor_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Path(tmpdir) / "ctx.sqlite3"
            with open_sqlite(db) as conn:
                service = WorkbenchService(conn)
                snapshot = service.create_work_seed(
                    title="测试作品",
                    one_line_pitch="主角必须在失控前找回秩序。",
                    genre="都市异能",
                )
                work_id = snapshot["work"]["id"]
                manager = ContextManager(conn)
                router_context = manager.build_router_context(work_id=work_id, text="总结一下现在情况")
                self.assertEqual(router_context["minimal_context"]["work_name"], "测试作品")

                executor_context = manager.build_executor_context(
                    work_id=work_id,
                    intent="SUMMARIZE_CURRENT_STATE",
                    parameters={"work_name": "测试作品", "summary_scope": "current_work", "summary_focus": []},
                )
                self.assertEqual(executor_context["work"]["id"], work_id)
                self.assertIn("chapter_summaries", executor_context)


if __name__ == "__main__":
    unittest.main()
