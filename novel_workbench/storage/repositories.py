"""Minimal repositories for the V1 SQLite schema."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any


RowDict = dict[str, Any]


@dataclass(frozen=True)
class TableSpec:
    table_name: str
    columns: tuple[str, ...]
    default_order_by: str


class SQLiteRepository:
    """Thin repository wrapper around a single SQLite table."""

    spec: TableSpec

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get(self, record_id: str) -> RowDict | None:
        query = f"SELECT * FROM {self.spec.table_name} WHERE id = ?"
        row = self.conn.execute(query, (record_id,)).fetchone()
        return dict(row) if row else None

    def list_all(self) -> list[RowDict]:
        query = f"SELECT * FROM {self.spec.table_name} ORDER BY {self.spec.default_order_by}"
        rows = self.conn.execute(query).fetchall()
        return [dict(row) for row in rows]

    def save(self, record: RowDict) -> RowDict:
        if not record.get("id"):
            raise ValueError(f"{self.spec.table_name} save requires a non-empty id")

        payload = {column: record.get(column) for column in self.spec.columns}
        columns_sql = ", ".join(self.spec.columns)
        placeholders_sql = ", ".join(f":{column}" for column in self.spec.columns)
        updates_sql = ", ".join(
            f"{column} = excluded.{column}" for column in self.spec.columns if column != "id"
        )
        query = (
            f"INSERT INTO {self.spec.table_name} ({columns_sql}) "
            f"VALUES ({placeholders_sql}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates_sql}"
        )
        self.conn.execute(query, payload)
        self.conn.commit()
        saved = self.get(str(record["id"]))
        if saved is None:
            raise RuntimeError(f"failed to reload {self.spec.table_name}:{record['id']}")
        return saved

    def delete(self, record_id: str) -> bool:
        query = f"DELETE FROM {self.spec.table_name} WHERE id = ?"
        cursor = self.conn.execute(query, (record_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def list_by_work(self, work_id: str) -> list[RowDict]:
        if "work_id" not in self.spec.columns:
            raise NotImplementedError(f"{self.spec.table_name} is not work-scoped")
        query = (
            f"SELECT * FROM {self.spec.table_name} "
            f"WHERE work_id = ? "
            f"ORDER BY {self.spec.default_order_by}"
        )
        rows = self.conn.execute(query, (work_id,)).fetchall()
        return [dict(row) for row in rows]


class WorkRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="works",
        columns=(
            "id",
            "title",
            "subtitle",
            "one_line_pitch",
            "genre",
            "subgenres_json",
            "tags_json",
            "target_platform",
            "target_audience",
            "target_word_count",
            "planned_volume_count",
            "update_frequency",
            "commercial_positioning",
            "core_differentiators_json",
            "boundaries_json",
            "core_theme",
            "sub_themes_json",
            "emotional_base_tone",
            "desired_ending_emotion",
            "start_state",
            "end_state",
            "inciting_incident",
            "midpoint_shift",
            "final_convergence",
            "summary",
            "stage",
            "active_volume_id",
            "active_chapter_id",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="updated_at DESC, created_at DESC, id ASC",
    )


class CharacterRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="characters",
        columns=(
            "id",
            "work_id",
            "name",
            "gender",
            "age",
            "identity",
            "role_type",
            "appearance",
            "public_persona",
            "inner_core",
            "core_desire",
            "core_fear",
            "surface_goal",
            "deep_goal",
            "initial_flaw",
            "obsession",
            "values_json",
            "action_style",
            "decision_style",
            "emotion_triggers_json",
            "bottom_line",
            "taboos_json",
            "growth_arc",
            "power_growth_path",
            "identity_secrets_json",
            "breakdown_points_json",
            "fate_question",
            "first_appearance_chapter_id",
            "current_state",
            "status",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="updated_at DESC, created_at DESC, id ASC",
    )


class OutlineRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="outlines",
        columns=(
            "id",
            "work_id",
            "one_sentence_premise",
            "protagonist_need",
            "why_impossible",
            "cost_to_pay",
            "main_opponent",
            "core_conflict",
            "main_goal",
            "stage_goals_json",
            "final_goal",
            "story_start_point",
            "inciting_incident",
            "midpoint_shift",
            "final_convergence",
            "ending_direction",
            "main_suspense",
            "truth_reveal_order_json",
            "story_engine",
            "escalation_pattern",
            "status",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="updated_at DESC, created_at DESC, id ASC",
    )

    def get_by_work(self, work_id: str) -> RowDict | None:
        rows = self.list_by_work(work_id)
        return rows[0] if rows else None


class VolumeRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="volumes",
        columns=(
            "id",
            "work_id",
            "order_no",
            "title",
            "theme",
            "main_task",
            "main_enemy",
            "core_conflict",
            "objective",
            "entry_state",
            "exit_state",
            "climax",
            "resolution_style",
            "hook",
            "related_location_ids_json",
            "related_plotline_ids_json",
            "involved_character_ids_json",
            "status",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="order_no ASC, created_at ASC, id ASC",
    )


class ChapterRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="chapters",
        columns=(
            "id",
            "work_id",
            "volume_id",
            "order_no",
            "title",
            "pov_character_id",
            "function",
            "core_event",
            "conflict",
            "info_points_json",
            "foreshadow_refs_json",
            "character_progress",
            "emotional_progress",
            "worldbuilding_progress",
            "ending_hook",
            "target_word_count",
            "is_explosive_chapter",
            "summary",
            "status",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="order_no ASC, created_at ASC, id ASC",
    )

    def list_by_volume(self, volume_id: str) -> list[RowDict]:
        query = (
            f"SELECT * FROM {self.spec.table_name} "
            f"WHERE volume_id = ? "
            f"ORDER BY {self.spec.default_order_by}"
        )
        rows = self.conn.execute(query, (volume_id,)).fetchall()
        return [dict(row) for row in rows]


class DraftRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="drafts",
        columns=(
            "id",
            "work_id",
            "chapter_id",
            "version_no",
            "source_type",
            "text",
            "word_count",
            "summary",
            "status",
            "created_by",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="chapter_id ASC, version_no DESC, created_at DESC, id ASC",
    )

    def list_by_chapter(self, chapter_id: str) -> list[RowDict]:
        query = (
            f"SELECT * FROM {self.spec.table_name} "
            f"WHERE chapter_id = ? "
            f"ORDER BY version_no DESC, created_at DESC, id ASC"
        )
        rows = self.conn.execute(query, (chapter_id,)).fetchall()
        return [dict(row) for row in rows]

    def latest_for_chapter(self, chapter_id: str) -> RowDict | None:
        drafts = self.list_by_chapter(chapter_id)
        return drafts[0] if drafts else None


class DecisionLogRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="decision_logs",
        columns=(
            "id",
            "work_id",
            "decision_type",
            "title",
            "decision",
            "rationale",
            "affected_object_refs_json",
            "confirmed_by_user",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="created_at DESC, updated_at DESC, id ASC",
    )


class ContinuityStateRepository(SQLiteRepository):
    spec = TableSpec(
        table_name="continuity_states",
        columns=(
            "id",
            "work_id",
            "scope_type",
            "scope_id",
            "state_type",
            "current_value_json",
            "effective_from_event_id",
            "effective_to_event_id",
            "visibility_scope",
            "status",
            "extensions_json",
            "notes_json",
            "created_at",
            "updated_at",
        ),
        default_order_by="updated_at DESC, created_at DESC, id ASC",
    )

    def list_by_scope(self, work_id: str, scope_type: str, scope_id: str) -> list[RowDict]:
        query = (
            f"SELECT * FROM {self.spec.table_name} "
            "WHERE work_id = ? AND scope_type = ? AND scope_id = ? "
            f"ORDER BY {self.spec.default_order_by}"
        )
        rows = self.conn.execute(query, (work_id, scope_type, scope_id)).fetchall()
        return [dict(row) for row in rows]


class RepositoryBundle:
    """Convenience entry point for the V1 repositories."""

    def __init__(self, conn: sqlite3.Connection):
        self.works = WorkRepository(conn)
        self.characters = CharacterRepository(conn)
        self.outlines = OutlineRepository(conn)
        self.volumes = VolumeRepository(conn)
        self.chapters = ChapterRepository(conn)
        self.drafts = DraftRepository(conn)
        self.decision_logs = DecisionLogRepository(conn)
        self.continuity_states = ContinuityStateRepository(conn)
