from __future__ import annotations

import unittest
from unittest.mock import patch

from novel_workbench.executors import (
    BaseExecutor,
    CreateCharacterCandidatesExecutor,
    ExecutorRegistry,
    make_executor_result,
)


class StubExecutor(BaseExecutor):
    intent = "TEST_INTENT"

    def execute(self, *, context, parameters):  # type: ignore[no-untyped-def]
        return make_executor_result(
            handled=True,
            status="COMPLETED",
            action_result={"ok": True, "context": context, "parameters": parameters},
        )


class ExecutorRegistryTest(unittest.TestCase):
    def test_registry_dispatches_registered_executor(self) -> None:
        registry = ExecutorRegistry()
        registry.register(StubExecutor())
        result = registry.execute("TEST_INTENT", context={"a": 1}, parameters={"b": 2})
        self.assertTrue(result["handled"])
        self.assertEqual(result["actionResult"]["parameters"]["b"], 2)

    def test_registry_returns_unhandled_for_unknown_intent(self) -> None:
        registry = ExecutorRegistry()
        result = registry.execute("UNKNOWN", context={}, parameters={})
        self.assertFalse(result["handled"])
        self.assertEqual(result["status"], "UNHANDLED")

    def test_character_candidates_falls_back_on_truncated_llm_output(self) -> None:
        executor = CreateCharacterCandidatesExecutor()
        with patch(
            "novel_workbench.executors.create_character_candidates.llm_client.chat_completion",
            return_value={
                "content": "## 角色候选 1\n- 姓名：半截输出",
                "finish_reason": "length",
                "model": "gpt-oss-120b",
                "usage": {},
            },
        ):
            result = executor.execute(
                context={"work": {"title": "测试作品"}},
                parameters={
                    "candidate_count": 3,
                    "role_type": "core_roles",
                },
            )

        content = result["actionResult"]["content"]
        self.assertIn("## 角色候选 3", content)
        self.assertIn("## 综合建议", content)
        self.assertTrue(result["metadata"]["fallback_used"])
        self.assertEqual(result["metadata"]["fallback_reason"], "length")

    def test_character_candidates_continues_until_output_is_complete(self) -> None:
        executor = CreateCharacterCandidatesExecutor()
        with patch(
            "novel_workbench.executors.create_character_candidates.llm_client.chat_completion",
            side_effect=[
                {
                    "content": "## 角色候选 1\n- 姓名：候选一",
                    "finish_reason": "length",
                    "model": "gpt-oss-120b",
                    "usage": {},
                },
                {
                    "content": "\n## 角色候选 2\n- 姓名：候选二\n## 综合建议\n- 最稳妥方案：候选一。\n- 最有张力方案：候选二。\n- 最适合后续展开方案：候选一。",
                    "finish_reason": "stop",
                    "model": "gpt-oss-120b",
                    "usage": {},
                },
            ],
        ):
            result = executor.execute(
                context={"work": {"title": "测试作品"}},
                parameters={
                    "candidate_count": 2,
                    "role_type": "core_roles",
                },
            )

        content = result["actionResult"]["content"]
        self.assertIn("## 角色候选 1", content)
        self.assertIn("## 角色候选 2", content)
        self.assertIn("## 综合建议", content)
        self.assertFalse(result["metadata"]["fallback_used"])
        self.assertTrue(result["metadata"]["continuation_used"])
        self.assertEqual(result["metadata"]["generation_rounds"], 2)


if __name__ == "__main__":
    unittest.main()
