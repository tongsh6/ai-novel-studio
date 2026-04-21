"""Base executor contracts."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any


JsonDict = dict[str, Any]


class BaseExecutor(ABC):
    """Unified executor contract for intent-driven actions."""

    intent: str

    @abstractmethod
    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        raise NotImplementedError


class FunctionExecutor(BaseExecutor):
    """Thin adapter for wrapping existing service methods into the executor contract."""

    def __init__(self, intent: str, fn: Callable[..., JsonDict]):
        self.intent = intent
        self._fn = fn

    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        return self._fn(context=context, parameters=parameters)
