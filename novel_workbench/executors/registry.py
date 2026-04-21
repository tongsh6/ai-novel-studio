"""Registry and dispatcher for executors."""

from __future__ import annotations

from typing import Any

from .base import BaseExecutor
from .result_types import make_executor_result


JsonDict = dict[str, Any]


class ExecutorRegistry:
    """Resolve and dispatch executors by intent."""

    def __init__(self) -> None:
        self._executors: dict[str, BaseExecutor] = {}

    def register(self, executor: BaseExecutor) -> None:
        self._executors[executor.intent] = executor

    def execute(self, intent: str, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        executor = self._executors.get(intent)
        if executor is None:
            return make_executor_result(
                handled=False,
                status="UNHANDLED",
                metadata={"intent": intent},
            )
        return executor.execute(context=context, parameters=parameters)
