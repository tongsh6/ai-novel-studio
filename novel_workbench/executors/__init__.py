"""Executor contracts and registry for workbench actions."""

from .advance_plot import AdvancePlotExecutor
from .base import BaseExecutor
from .create_character_candidates import CreateCharacterCandidatesExecutor
from .refine_existing_character import RefineExistingCharacterExecutor
from .registry import ExecutorRegistry
from .result_types import make_executor_result
from .summarize_current_state import SummarizeCurrentStateExecutor

__all__ = [
    "AdvancePlotExecutor",
    "BaseExecutor",
    "CreateCharacterCandidatesExecutor",
    "ExecutorRegistry",
    "make_executor_result",
    "RefineExistingCharacterExecutor",
    "SummarizeCurrentStateExecutor",
]
