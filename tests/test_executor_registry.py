from __future__ import annotations

import unittest

from novel_workbench.executors import BaseExecutor, ExecutorRegistry, make_executor_result


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


if __name__ == "__main__":
    unittest.main()
