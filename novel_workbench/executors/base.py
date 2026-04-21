"""Base executor contracts."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


JsonDict = dict[str, Any]


class BaseExecutor(ABC):
    """Unified executor contract for intent-driven actions."""

    intent: str

    @abstractmethod
    def execute(self, *, context: JsonDict, parameters: JsonDict) -> JsonDict:
        raise NotImplementedError
