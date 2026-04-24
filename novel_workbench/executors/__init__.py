"""Executor contracts and registry for workbench actions."""

from .advance_plot import AdvancePlotExecutor
from .base import BaseExecutor
from .create_character_candidates import CreateCharacterCandidatesExecutor
from .create_work_seed import CreateWorkSeedExecutor
from .draft_chapter import DraftChapterExecutor
from .enter_read_mode import EnterReadModeExecutor
from .generate_chapter_outline import GenerateChapterOutlineExecutor
from .refine_existing_character import RefineExistingCharacterExecutor
from .registry import ExecutorRegistry
from .result_types import make_executor_result
from .revise_draft import ReviseDraftExecutor
from .summarize_current_state import SummarizeCurrentStateExecutor

__all__ = [
    "AdvancePlotExecutor",
    "BaseExecutor",
    "CreateCharacterCandidatesExecutor",
    "CreateWorkSeedExecutor",
    "DraftChapterExecutor",
    "EnterReadModeExecutor",
    "ExecutorRegistry",
    "GenerateChapterOutlineExecutor",
    "make_executor_result",
    "RefineExistingCharacterExecutor",
    "ReviseDraftExecutor",
    "SummarizeCurrentStateExecutor",
]
