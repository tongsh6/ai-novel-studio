"""Router protocol layer for the dialogue-based novel workbench."""

from .intents import ALL_INTENTS, MINIMAL_INTENTS, OTHER
from .service import RouterService

__all__ = [
    "ALL_INTENTS",
    "MINIMAL_INTENTS",
    "OTHER",
    "RouterService",
]
