"""Intent enums and parameter slots for the minimal Router protocol."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


CREATE_CHARACTER_CANDIDATES = "CREATE_CHARACTER_CANDIDATES"
REFINE_EXISTING_CHARACTER = "REFINE_EXISTING_CHARACTER"
ADVANCE_PLOT = "ADVANCE_PLOT"
SUMMARIZE_CURRENT_STATE = "SUMMARIZE_CURRENT_STATE"
OTHER = "OTHER"

MINIMAL_INTENTS = (
    CREATE_CHARACTER_CANDIDATES,
    REFINE_EXISTING_CHARACTER,
    ADVANCE_PLOT,
    SUMMARIZE_CURRENT_STATE,
)

ALL_INTENTS = MINIMAL_INTENTS + (OTHER,)

_PARAMETER_SLOTS: dict[str, dict[str, Any]] = {
    CREATE_CHARACTER_CANDIDATES: {
        "work_name": "",
        "plot_scope": "",
        "generation_target": "new_character_candidates",
        "candidate_count": None,
        "role_type": "",
        "selection_flow": "",
        "constraints": [],
    },
    REFINE_EXISTING_CHARACTER: {
        "work_name": "",
        "character_name": "",
        "refine_dimensions": [],
        "current_basis": "",
        "constraints": [],
    },
    ADVANCE_PLOT: {
        "work_name": "",
        "current_plot_scope": "",
        "advance_goal": "",
        "target_position": "",
        "constraints": [],
    },
    SUMMARIZE_CURRENT_STATE: {
        "work_name": "",
        "summary_scope": "",
        "summary_focus": [],
    },
    OTHER: {},
}


def normalize_intent(value: Any) -> str:
    intent = str(value or "").strip().upper()
    if intent in ALL_INTENTS:
        return intent
    return OTHER


def empty_parameters(intent: str) -> dict[str, Any]:
    return deepcopy(_PARAMETER_SLOTS.get(intent, {}))
