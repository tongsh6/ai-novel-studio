"""Minimal context assembly for Router and Executor stages."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from novel_workbench.storage import RepositoryBundle


JsonDict = dict[str, Any]


class ContextManager:
    """Assemble task-scoped context instead of scattering repository reads."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.repos = RepositoryBundle(conn)

    def build_router_context(self, *, work_id: str | None, text: str) -> JsonDict:
        work = None
        chapter = None
        characters: list[JsonDict] = []
        if work_id:
            work = self.repos.works.get(work_id)
            if work:
                characters = self.repos.characters.list_by_work(work_id)
                active_chapter_id = work.get("active_chapter_id")
                if active_chapter_id:
                    chapter = self.repos.chapters.get(active_chapter_id)

        return {
            "work": work,
            "chapter": chapter,
            "characters": characters,
            "minimal_context": {
                "work_name": str(work.get("title") or "").strip() if work else "",
                "plot_scope": "current_plot" if work else "",
                "constraints": self._parse_json_list(work.get("boundaries_json")) if work else [],
                "user_request": text,
            },
        }

    def build_executor_context(
        self,
        *,
        work_id: str,
        intent: str,
        parameters: JsonDict,
    ) -> JsonDict:
        work = self.repos.works.get(work_id)
        if work is None:
            raise KeyError(f"work not found: {work_id}")

        chapters = self.repos.chapters.list_by_work(work_id)
        active_chapter = None
        active_chapter_id = work.get("active_chapter_id")
        if active_chapter_id:
            active_chapter = self.repos.chapters.get(active_chapter_id)

        all_characters = self.repos.characters.list_by_work(work_id)
        character_names = {
            str(parameters.get("character_name") or "").strip(),
            str(parameters.get("character_a") or "").strip(),
            str(parameters.get("character_b") or "").strip(),
        }
        related_characters = [
            character for character in all_characters if str(character.get("name") or "").strip() in character_names
        ]
        if not related_characters:
            related_characters = all_characters[:5]

        outline = self.repos.outlines.get_by_work(work_id)
        recent_decisions = self.repos.decision_logs.list_by_work(work_id)[:5]

        return {
            "intent": intent,
            "parameters": parameters,
            "work": work,
            "outline": outline,
            "active_chapter": active_chapter,
            "chapter_summaries": [
                {
                    "id": chapter["id"],
                    "title": chapter["title"],
                    "summary": chapter["summary"],
                    "status": chapter["status"],
                }
                for chapter in chapters[:10]
            ],
            "related_characters": related_characters,
            "recent_decisions": recent_decisions,
        }

    def _parse_json_list(self, raw_json: Any) -> list[str]:
        if raw_json is None:
            return []
        parsed = raw_json
        if isinstance(raw_json, str):
            try:
                parsed = json.loads(raw_json)
            except json.JSONDecodeError:
                return []
        if not isinstance(parsed, list):
            return []
        result: list[str] = []
        for item in parsed:
            text = str(item or "").strip()
            if text:
                result.append(text)
        return result
