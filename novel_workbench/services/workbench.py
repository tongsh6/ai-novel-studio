"""Minimal V1 application service for the dialogue-based novel workbench."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from novel_workbench.context_manager import ContextManager
from novel_workbench.executors import (
    AdvancePlotExecutor,
    CreateCharacterCandidatesExecutor,
    ExecutorRegistry,
    RefineExistingCharacterExecutor,
    SummarizeCurrentStateExecutor,
)
from novel_workbench.router import RouterService
from novel_workbench.router.defaults import apply_router_defaults
from novel_workbench.router.intents import OTHER
from novel_workbench.storage import RepositoryBundle
from novel_workbench.services import llm_client, prompts
from novel_workbench.validators import validate_executor_result, validate_router_result


JsonDict = dict[str, Any]


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def json_text(value: Any, *, fallback: Any) -> str:
    if value is None:
        value = fallback
    return json.dumps(value, ensure_ascii=False)


def estimate_cn_word_count(text: str) -> int:
    compact = "".join(str(text or "").split())
    return len(compact)


class WorkbenchService:
    """Minimal V1 service orchestration over the SQLite repositories."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.repos = RepositoryBundle(conn)
        self.router = RouterService()
        self.context_manager = ContextManager(conn)
        self.executor_registry = self._build_executor_registry()

    def create_work_seed(
        self,
        *,
        title: str,
        one_line_pitch: str,
        genre: str,
        target_platform: str = "起点中文网",
        target_audience: str = "网文读者",
    ) -> JsonDict:
        title = title.strip()
        one_line_pitch = one_line_pitch.strip()
        genre = genre.strip()
        if not title:
            raise ValueError("title is required")
        if not one_line_pitch:
            raise ValueError("oneLinePitch is required")
        if not genre:
            raise ValueError("genre is required")

        now = now_ms()
        work_id = new_id("work")
        outline_id = new_id("outline")
        volume_id = new_id("volume")
        chapter_id = new_id("chapter")

        self.repos.works.save(
            {
                "id": work_id,
                "title": title,
                "subtitle": "",
                "one_line_pitch": one_line_pitch,
                "genre": genre,
                "subgenres_json": json_text([], fallback=[]),
                "tags_json": json_text([], fallback=[]),
                "target_platform": target_platform.strip(),
                "target_audience": target_audience.strip(),
                "target_word_count": None,
                "planned_volume_count": 1,
                "update_frequency": "",
                "commercial_positioning": "",
                "core_differentiators_json": json_text([], fallback=[]),
                "boundaries_json": json_text([], fallback=[]),
                "core_theme": "",
                "sub_themes_json": json_text([], fallback=[]),
                "emotional_base_tone": "",
                "desired_ending_emotion": "",
                "start_state": "",
                "end_state": "",
                "inciting_incident": "",
                "midpoint_shift": "",
                "final_convergence": "",
                "summary": one_line_pitch,
                "stage": "IDEATION",
                "active_volume_id": volume_id,
                "active_chapter_id": chapter_id,
                "extensions_json": json_text({}, fallback={}),
                "notes_json": json_text({}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )
        self.repos.outlines.save(
            {
                "id": outline_id,
                "work_id": work_id,
                "one_sentence_premise": one_line_pitch,
                "protagonist_need": "",
                "why_impossible": "",
                "cost_to_pay": "",
                "main_opponent": "",
                "core_conflict": "",
                "main_goal": "",
                "stage_goals_json": json_text([], fallback=[]),
                "final_goal": "",
                "story_start_point": "",
                "inciting_incident": "",
                "midpoint_shift": "",
                "final_convergence": "",
                "ending_direction": "",
                "main_suspense": "",
                "truth_reveal_order_json": json_text([], fallback=[]),
                "story_engine": "",
                "escalation_pattern": "",
                "status": "DRAFT",
                "extensions_json": json_text({}, fallback={}),
                "notes_json": json_text({}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )
        self.repos.volumes.save(
            {
                "id": volume_id,
                "work_id": work_id,
                "order_no": 1,
                "title": "第一卷",
                "theme": "",
                "main_task": "",
                "main_enemy": "",
                "core_conflict": "",
                "objective": "",
                "entry_state": "",
                "exit_state": "",
                "climax": "",
                "resolution_style": "",
                "hook": "",
                "related_location_ids_json": json_text([], fallback=[]),
                "related_plotline_ids_json": json_text([], fallback=[]),
                "involved_character_ids_json": json_text([], fallback=[]),
                "status": "BACKLOG",
                "extensions_json": json_text({}, fallback={}),
                "notes_json": json_text({}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )
        self.repos.chapters.save(
            {
                "id": chapter_id,
                "work_id": work_id,
                "volume_id": volume_id,
                "order_no": 1,
                "title": "第1章",
                "pov_character_id": None,
                "function": "立项后的首章落点",
                "core_event": "",
                "conflict": "",
                "info_points_json": json_text([], fallback=[]),
                "foreshadow_refs_json": json_text([], fallback=[]),
                "character_progress": "",
                "emotional_progress": "",
                "worldbuilding_progress": "",
                "ending_hook": "",
                "target_word_count": 3000,
                "is_explosive_chapter": 0,
                "summary": "",
                "status": "BACKLOG",
                "extensions_json": json_text({}, fallback={}),
                "notes_json": json_text({}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )
        self._log_decision(
            work_id=work_id,
            decision_type="work_seed_created",
            title="创建作品立项底稿",
            decision=f"已创建作品《{title}》的最小立项骨架。",
            rationale="V1 需要从灵感输入快速进入可写状态。",
            affected_object_refs=[work_id, outline_id, volume_id, chapter_id],
            confirmed_by_user=True,
        )
        return self.open_workbench(work_id)

    def list_works(self) -> list[JsonDict]:
        works = self.repos.works.list_all()
        result = []
        for work in works:
            chapters = self.repos.chapters.list_by_work(work["id"])
            latest_drafted = next(
                (chapter for chapter in chapters if chapter["status"] == "DRAFTED"),
                None,
            )
            result.append(
                {
                    "id": work["id"],
                    "title": work["title"],
                    "genre": work["genre"],
                    "oneLinePitch": work["one_line_pitch"],
                    "stage": work["stage"],
                    "activeVolumeId": work["active_volume_id"],
                    "activeChapterId": work["active_chapter_id"],
                    "updatedAt": work["updated_at"],
                    "chapterCount": len(chapters),
                    "draftedChapterCount": sum(
                        1 for chapter in chapters if chapter["status"] == "DRAFTED"
                    ),
                    "latestDraftedChapterId": latest_drafted["id"] if latest_drafted else None,
                }
            )
        return result

    def get_work(self, work_id: str) -> JsonDict:
        return self._require_work(work_id)

    def set_active_chapter(self, *, work_id: str, chapter_id: str) -> JsonDict:
        work = self._require_work(work_id)
        chapter = self._require_chapter_for_work(work_id, chapter_id)
        self.repos.works.save(
            {
                **work,
                "active_chapter_id": chapter["id"],
                "updated_at": now_ms(),
            }
        )
        return self.open_workbench(work_id)

    def ensure_chapter(
        self,
        *,
        work_id: str,
        order_no: int,
        activate: bool = True,
    ) -> JsonDict:
        if order_no <= 0:
            raise ValueError("order_no must be positive")

        work = self._require_work(work_id)
        chapters = self.repos.chapters.list_by_work(work_id)
        existing = next((chapter for chapter in chapters if int(chapter["order_no"]) == order_no), None)
        now = now_ms()
        if existing is None:
            volume_id = work.get("active_volume_id")
            if not volume_id:
                volumes = self.repos.volumes.list_by_work(work_id)
                if not volumes:
                    raise ValueError("active volume is required before creating chapters")
                volume_id = volumes[0]["id"]

            chapter = self.repos.chapters.save(
                {
                    "id": new_id("chapter"),
                    "work_id": work_id,
                    "volume_id": volume_id,
                    "order_no": order_no,
                    "title": f"第{order_no}章",
                    "pov_character_id": None,
                    "function": "待补章节定位",
                    "core_event": "",
                    "conflict": "",
                    "info_points_json": json_text([], fallback=[]),
                    "foreshadow_refs_json": json_text([], fallback=[]),
                    "character_progress": "",
                    "emotional_progress": "",
                    "worldbuilding_progress": "",
                    "ending_hook": "",
                    "target_word_count": 3000,
                    "is_explosive_chapter": 0,
                    "summary": "",
                    "status": "BACKLOG",
                    "extensions_json": json_text(
                        {
                            "autoCreated": True,
                            "autoCreatedReason": f"chapter_order_{order_no}",
                        },
                        fallback={},
                    ),
                    "notes_json": json_text({}, fallback={}),
                    "created_at": now,
                    "updated_at": now,
                }
            )
            self._log_decision(
                work_id=work_id,
                decision_type="chapter_created",
                title=f"创建章节：第{order_no}章",
                decision=f"已自动创建第{order_no}章骨架。",
                rationale="用户请求指向了尚不存在的目标章节，需要先创建最小章节对象以承接后续细纲或正文。",
                affected_object_refs=[work_id, chapter["id"]],
                confirmed_by_user=False,
                extensions={
                    "action": "ensure_chapter",
                    "chapterId": chapter["id"],
                    "orderNo": order_no,
                },
            )
        else:
            chapter = existing

        if activate:
            self.set_active_chapter(work_id=work_id, chapter_id=chapter["id"])
        return chapter

    def refine_character(
        self,
        *,
        work_id: str,
        name: str,
        identity: str = "",
        role_type: str = "PROTAGONIST",
        core_desire: str = "",
    ) -> JsonDict:
        work = self._require_work(work_id)
        name = name.strip()
        if not name:
            raise ValueError("character name is required")

        existing_chars = self.repos.characters.list_by_work(work_id)
        existing = next((c for c in existing_chars if c["name"] == name), None)
        now = now_ms()

        if existing:
            character = self.repos.characters.save(
                {
                    **existing,
                    "identity": identity.strip() or existing["identity"],
                    "role_type": role_type.strip() or existing["role_type"],
                    "core_desire": core_desire.strip() or existing["core_desire"],
                    "updated_at": now,
                }
            )
            decision_type = "character_updated"
            title = f"更新角色设定：{name}"
        else:
            character_id = new_id("character")
            character = self.repos.characters.save(
                {
                    "id": character_id,
                    "work_id": work_id,
                    "name": name,
                    "gender": "",
                    "age": None,
                    "identity": identity.strip(),
                    "role_type": role_type.strip(),
                    "appearance": "",
                    "public_persona": "",
                    "inner_core": "",
                    "core_desire": core_desire.strip(),
                    "core_fear": "",
                    "surface_goal": "",
                    "deep_goal": "",
                    "initial_flaw": "",
                    "obsession": "",
                    "values_json": json_text([], fallback=[]),
                    "action_style": "",
                    "decision_style": "",
                    "emotion_triggers_json": json_text([], fallback=[]),
                    "bottom_line": "",
                    "taboos_json": json_text([], fallback=[]),
                    "growth_arc": "",
                    "power_growth_path": "",
                    "identity_secrets_json": json_text([], fallback=[]),
                    "breakdown_points_json": json_text([], fallback=[]),
                    "fate_question": "",
                    "first_appearance_chapter_id": None,
                    "current_state": "",
                    "status": "DRAFT",
                    "extensions_json": json_text({}, fallback={}),
                    "notes_json": json_text({}, fallback={}),
                    "created_at": now,
                    "updated_at": now,
                }
            )
            decision_type = "character_created"
            title = f"创建角色：{name}"

        self._log_decision(
            work_id=work_id,
            decision_type=decision_type,
            title=title,
            decision=f"已记录角色设定：{name}（{identity}）",
            rationale=f"记录核心角色设定，为后续细纲和草稿提供人物基础。",
            affected_object_refs=[work_id, character["id"]],
            confirmed_by_user=True,
            extensions={
                "action": "refine_character",
                "characterId": character["id"],
                "name": name,
                "identity": identity,
            },
        )
        return self.open_workbench(work_id)

    def generate_chapter_outline(
        self,
        *,
        work_id: str,
        chapter_id: str,
        instruction_text: str = "",
        rewrite_mode: str = "default",
    ) -> JsonDict:
        work = self._require_work(work_id)
        chapter = self._require_chapter_for_work(work_id, chapter_id)
        volume = self.repos.volumes.get(chapter["volume_id"])
        if volume is None:
            raise KeyError(f"volume not found: {chapter['volume_id']}")
        outline = self.repos.outlines.get_by_work(work_id)
        instruction_text = str(instruction_text or "").strip()
        rewrite_mode = str(rewrite_mode or "default").strip() or "default"

        _outline_messages = prompts.build_outline_messages(
            work, volume, chapter, outline,
            instruction_text=instruction_text,
            rewrite_mode=rewrite_mode,
        )
        print(f"--- Calling LLM: generate_chapter_outline for {chapter['title']} ---")
        _llm_data = llm_client.chat_json(_outline_messages)

        function = str(_llm_data.get("function") or "推进主线并建立首轮章节钩子")
        core_event = str(_llm_data.get("core_event") or chapter["core_event"] or "主角被迫做出第一次关键行动")
        conflict = str(_llm_data.get("conflict") or chapter["conflict"] or "目标明确，但资源和信息都不足")
        summary = str(_llm_data.get("summary") or f"{work['title']}·{chapter['title']} 推进主线。")
        raw_info = _llm_data.get("info_points")
        info_points: list[str] = raw_info if isinstance(raw_info, list) else [
            "交代当前处境与本章目标",
            "抛出新的阻力或代价",
            "明确下一步必须行动的理由",
        ]
        character_progress = str(_llm_data.get("character_progress") or "主角从被动观察转为主动应对。")
        emotional_progress = str(_llm_data.get("emotional_progress") or "从不确定感推进到带压迫感的决断。")
        worldbuilding_progress = str(_llm_data.get("worldbuilding_progress") or "通过事件自然露出世界运行规则的一角。")
        ending_hook = str(_llm_data.get("ending_hook") or "章末留下必须立刻处理的新问题。")

        chapter_extensions = self._merge_json_text(
            chapter.get("extensions_json"),
            {
                "lastInstructionText": instruction_text,
                "lastRewriteMode": rewrite_mode,
            },
        )
        chapter = self.repos.chapters.save(
            {
                **chapter,
                "function": function,
                "core_event": core_event,
                "conflict": conflict,
                "info_points_json": json_text(info_points, fallback=[]),
                "character_progress": character_progress,
                "emotional_progress": emotional_progress,
                "worldbuilding_progress": worldbuilding_progress,
                "ending_hook": ending_hook,
                "summary": summary,
                "status": "OUTLINED",
                "extensions_json": chapter_extensions,
                "updated_at": now_ms(),
            }
        )
        self.repos.works.save(
            {
                **work,
                "stage": "CHAPTER_PLANNING",
                "active_chapter_id": chapter_id,
                "updated_at": now_ms(),
            }
        )
        outline_premise = (
            f"{outline['one_sentence_premise']}。"
            if outline
            else "基于作品立项目标生成首个可写章节结构。"
        )
        if instruction_text:
            decision_type = "chapter_outline_rewritten"
            decision_title = f"按要求重生成章节细纲：{chapter['title']}"
            decision_text = (
                f"已按要求重生成 {chapter['title']} 的章节细纲。"
                f"修改要求：{instruction_text}。"
            )
            rationale = (
                f"{outline_premise} 执行模式：{rewrite_mode}。"
                f"用户修改要求：{instruction_text}。"
            )
        else:
            decision_type = "chapter_outline_generated"
            decision_title = f"生成章节细纲：{chapter['title']}"
            decision_text = summary
            rationale = f"{outline_premise} 执行模式：{rewrite_mode}。"
        self._log_decision(
            work_id=work_id,
            decision_type=decision_type,
            title=decision_title,
            decision=decision_text,
            rationale=rationale,
            affected_object_refs=[work_id, chapter_id],
            confirmed_by_user=False,
            extensions={
                "action": "generate_chapter_outline",
                "chapterId": chapter_id,
                "rewriteMode": rewrite_mode,
                "instructionText": instruction_text,
            },
        )
        return self.open_workbench(work_id)

    def draft_chapter(
        self,
        *,
        work_id: str,
        chapter_id: str,
        created_by: str = "system_stub",
        instruction_text: str = "",
        rewrite_mode: str = "default",
    ) -> JsonDict:
        work = self._require_work(work_id)
        chapter = self._require_chapter_for_work(work_id, chapter_id)
        if chapter["status"] == "BACKLOG":
            raise ValueError("chapter outline is required before drafting")
        instruction_text = str(instruction_text or "").strip()
        rewrite_mode = str(rewrite_mode or "default").strip() or "default"

        existing_drafts = self.repos.drafts.list_by_chapter(chapter_id)
        next_version = (existing_drafts[0]["version_no"] + 1) if existing_drafts else 1
        _draft_messages = prompts.build_draft_messages(
            work, chapter,
            instruction_text=instruction_text,
            rewrite_mode=rewrite_mode,
        )
        print(f"--- Calling LLM: draft_chapter for {chapter['title']} ---")
        draft_text = llm_client.chat(_draft_messages)
        _gen_mode = "llm_generation"

        draft = self._save_draft_record(
            work_id=work_id,
            chapter_id=chapter_id,
            version_no=next_version,
            source_type="llm_generation",
            text=draft_text,
            summary=chapter["summary"] or chapter["core_event"] or chapter["title"],
            status="DRAFT",
            created_by=created_by,
            extensions={
                "generationMode": _gen_mode,
                "basedOnChapterStatus": chapter["status"],
                "instructionText": instruction_text,
                "rewriteMode": rewrite_mode,
            },
        )
        self.repos.chapters.save(
            {
                **chapter,
                "status": "DRAFTED",
                "extensions_json": self._merge_json_text(
                    chapter.get("extensions_json"),
                    {
                        "lastInstructionText": instruction_text,
                        "lastRewriteMode": rewrite_mode,
                        "lastDraftVersionNo": next_version,
                    },
                ),
                "updated_at": now_ms(),
            }
        )
        self.repos.works.save(
            {
                **work,
                "stage": "DRAFTING",
                "active_chapter_id": chapter_id,
                "updated_at": now_ms(),
            }
        )
        if instruction_text:
            decision_type = "chapter_draft_rewritten"
            decision_title = f"按要求重出正文草稿：{chapter['title']} v{next_version}"
            decision_text = (
                f"已按要求重出 {chapter['title']} 的第 {next_version} 个正文草稿版本。"
                f"修改要求：{instruction_text}。"
            )
            rationale = (
                f"V1 需要支持章节级多版本正文草稿. 执行模式: {rewrite_mode}。"
                f"用户修改要求：{instruction_text}。"
            )
        else:
            decision_type = "chapter_draft_created"
            decision_title = f"生成正文草稿：{chapter['title']} v{next_version}"
            decision_text = f"已生成 {chapter['title']} 的第 {next_version} 个正文草稿版本。"
            rationale = f"V1 需要支持章节级多版本正文草稿. 执行模式: {rewrite_mode}。"
        self._log_decision(
            work_id=work_id,
            decision_type=decision_type,
            title=decision_title,
            decision=decision_text,
            rationale=rationale,
            affected_object_refs=[work_id, chapter_id, draft["id"]],
            confirmed_by_user=False,
            extensions={
                "action": "draft_chapter",
                "chapterId": chapter_id,
                "draftId": draft["id"],
                "draftVersionNo": next_version,
                "rewriteMode": rewrite_mode,
                "instructionText": instruction_text,
            },
        )
        return self.open_workbench(work_id)

    def revise_draft(
        self,
        *,
        work_id: str,
        chapter_id: str,
        created_by: str = "system_stub",
        instruction_text: str = "",
        revise_mode: str = "revise_direct",
    ) -> JsonDict:
        work = self._require_work(work_id)
        chapter = self._require_chapter_for_work(work_id, chapter_id)
        latest_draft = self.repos.drafts.latest_for_chapter(chapter_id)
        if latest_draft is None:
            raise ValueError("base draft is required before revising")

        instruction_text = str(instruction_text or "").strip()
        revise_mode = str(revise_mode or "revise_direct").strip() or "revise_direct"
        next_version = int(latest_draft["version_no"]) + 1
        _revise_messages = prompts.build_revise_messages(
            work, chapter, latest_draft,
            instruction_text=instruction_text or "基于上一版做结构与表达修订",
            revise_mode=revise_mode,
        )
        print(f"--- Calling LLM: revise_draft for {chapter['title']} ---")
        draft_text = llm_client.chat(_revise_messages)
        _rev_mode = "llm_revision"

        draft = self._save_draft_record(
            work_id=work_id,
            chapter_id=chapter_id,
            version_no=next_version,
            source_type="llm_revision",
            text=draft_text,
            summary=chapter["summary"] or chapter["core_event"] or chapter["title"],
            status="REVISED",
            created_by=created_by,
            extensions={
                "generationMode": _rev_mode,
                "revisionMode": "draft_revision",
                "baseDraftId": latest_draft["id"],
                "baseVersionNo": latest_draft["version_no"],
                "instructionText": instruction_text,
                "rewriteMode": revise_mode,
            },
        )
        self.repos.chapters.save(
            {
                **chapter,
                "status": "DRAFTED",
                "extensions_json": self._merge_json_text(
                    chapter.get("extensions_json"),
                    {
                        "lastInstructionText": instruction_text,
                        "lastRewriteMode": revise_mode,
                        "lastDraftVersionNo": next_version,
                        "lastRevisedFromVersionNo": latest_draft["version_no"],
                    },
                ),
                "updated_at": now_ms(),
            }
        )
        self.repos.works.save(
            {
                **work,
                "stage": "REVISING",
                "active_chapter_id": chapter_id,
                "updated_at": now_ms(),
            }
        )
        decision_text = (
            f"已基于 {chapter['title']} 的 v{latest_draft['version_no']} 修订出 v{next_version}。"
            + (f" 修改要求：{instruction_text}。" if instruction_text else "")
        )
        rationale = (
            f"当前动作是基于已有草稿做修订，不再混用首次生成语义。执行模式：{revise_mode}。"
            f"来源版本：v{latest_draft['version_no']}。"
            + (f" 用户修改要求：{instruction_text}。" if instruction_text else "")
        )
        decision_type = "chapter_draft_revised"
        self._log_decision(
            work_id=work_id,
            decision_type=decision_type,
            title=f"修订正文草稿：{chapter['title']} v{latest_draft['version_no']} -> v{next_version}",
            decision=decision_text,
            rationale=rationale,
            affected_object_refs=[work_id, chapter_id, latest_draft["id"], draft["id"]],
            confirmed_by_user=False,
            extensions={
                "action": "revise_draft",
                "chapterId": chapter_id,
                "draftId": draft["id"],
                "draftVersionNo": next_version,
                "baseDraftId": latest_draft["id"],
                "baseVersionNo": latest_draft["version_no"],
                "rewriteMode": revise_mode,
                "instructionText": instruction_text,
            },
        )
        return self.open_workbench(work_id)

    def enter_read_mode(self, *, work_id: str) -> JsonDict:
        work = self._require_work(work_id)
        chapters = self.repos.chapters.list_by_work(work_id)
        latest_drafts_by_chapter = {
            chapter["id"]: self.repos.drafts.latest_for_chapter(chapter["id"])
            for chapter in chapters
        }
        toc = [
            {
                "chapterId": chapter["id"],
                "orderNo": chapter["order_no"],
                "title": chapter["title"],
                "status": chapter["status"],
                "hasDraft": latest_drafts_by_chapter[chapter["id"]] is not None,
            }
            for chapter in chapters
        ]
        chapters_projection = [
            {
                "chapterId": chapter["id"],
                "orderNo": chapter["order_no"],
                "title": chapter["title"],
                "summary": chapter["summary"],
                "draftVersionNo": latest_drafts_by_chapter[chapter["id"]]["version_no"]
                if latest_drafts_by_chapter[chapter["id"]]
                else None,
                "draftSourceType": latest_drafts_by_chapter[chapter["id"]]["source_type"]
                if latest_drafts_by_chapter[chapter["id"]]
                else None,
                "draftExtensionsJson": latest_drafts_by_chapter[chapter["id"]]["extensions_json"]
                if latest_drafts_by_chapter[chapter["id"]]
                else "{}",
                "text": latest_drafts_by_chapter[chapter["id"]]["text"]
                if latest_drafts_by_chapter[chapter["id"]]
                else "",
            }
            for chapter in chapters
        ]
        return {
            "work": work,
            "readingProjection": {
                "workId": work_id,
                "title": work["title"],
                "toc": toc,
                "chapters": chapters_projection,
                "generatedAt": now_ms(),
            },
        }

    def get_chapter(self, *, work_id: str, chapter_id: str) -> JsonDict:
        chapter = self._require_chapter_for_work(work_id, chapter_id)
        latest_draft = self.repos.drafts.latest_for_chapter(chapter_id)
        return {
            "work": self._require_work(work_id),
            "chapter": chapter,
            "latestDraft": latest_draft,
        }

    def open_workbench(self, work_id: str) -> JsonDict:
        work = self._require_work(work_id)
        volumes = self.repos.volumes.list_by_work(work_id)
        chapters = self.repos.chapters.list_by_work(work_id)
        characters = self.repos.characters.list_by_work(work_id)
        outline = self.repos.outlines.get_by_work(work_id)
        decisions = self.repos.decision_logs.list_by_work(work_id)
        latest_drafts = {
            chapter["id"]: self.repos.drafts.latest_for_chapter(chapter["id"]) for chapter in chapters
        }
        return {
            "work": work,
            "outline": outline,
            "volumes": volumes,
            "characters": characters,
            "chapters": [
                {
                    **chapter,
                    "latestDraft": latest_drafts[chapter["id"]],
                }
                for chapter in chapters
            ],
            "recentDecisions": decisions[:10],
        }

    def route_user_request(self, *, work_id: str | None = None, text: str) -> JsonDict:
        return self._route_user_request(work_id=work_id, text=text, persist=False)

    def _route_user_request(
        self,
        *,
        work_id: str | None = None,
        text: str,
        persist: bool,
    ) -> JsonDict:
        router_context = self.context_manager.build_router_context(work_id=work_id, text=text)
        raw_route_result = self.router.route(
            text,
            router_context=router_context,
        )
        route_result, autofilled_fields = apply_router_defaults(raw_route_result)
        validation_result = validate_router_result(route_result)
        validated_route_result = validation_result["validated_result"]

        status = "READY_FOR_EXECUTION"
        if not validation_result["is_valid"]:
            status = "FAILED"
        elif validated_route_result.get("intent") == OTHER:
            status = "ROUTED"
        elif validated_route_result.get("missing_fields"):
            status = "NEEDS_CLARIFICATION"

        packet = {
            "status": status,
            "routeResult": validated_route_result,
            "validationResult": validation_result,
            "autofilledFields": autofilled_fields,
        }
        if persist and work_id:
            interaction = self._save_interaction_log(
                work_id=work_id,
                user_input=text,
                route_result=validated_route_result,
                route_validation=validation_result,
                status=status,
            )
            packet["interactionId"] = interaction["id"]
        return packet

    def execute_router_result(
        self,
        *,
        work_id: str,
        route_result: JsonDict,
        interaction_id: str | None = None,
        user_input: str = "",
        persist: bool = False,
    ) -> JsonDict:
        validation_result = validate_router_result(route_result)
        validated_route_result = validation_result["validated_result"]
        status = "READY_FOR_EXECUTION"
        if not validation_result["is_valid"]:
            status = "FAILED"
        elif validated_route_result.get("intent") == OTHER:
            status = "ROUTED"
        elif validated_route_result.get("missing_fields"):
            status = "NEEDS_CLARIFICATION"

        packet: JsonDict = {
            "status": status,
            "routeResult": validated_route_result,
            "validationResult": validation_result,
        }
        if status != "READY_FOR_EXECUTION":
            if persist and interaction_id:
                self._save_interaction_log(
                    work_id=work_id,
                    user_input=user_input,
                    route_result=validated_route_result,
                    route_validation=validation_result,
                    status=status,
                    interaction_id=interaction_id,
                )
                packet["interactionId"] = interaction_id
            return packet

        execution_context = self.context_manager.build_executor_context(
            work_id=work_id,
            intent=validated_route_result["intent"],
            parameters=validated_route_result["parameters"],
        )
        execution_context["work_id"] = work_id
        execution_context["text"] = user_input
        execution_result = self.executor_registry.execute(
            validated_route_result["intent"],
            context=execution_context,
            parameters=validated_route_result["parameters"],
        )
        execution_validation = validate_executor_result(
            validated_route_result["intent"],
            execution_result,
        )
        execution_status = "COMPLETED" if execution_validation["is_valid"] else "FAILED"
        packet.update(
            {
                "status": execution_status,
                "executionResult": execution_result,
                "executionValidation": execution_validation,
            }
        )
        if persist:
            interaction = self._save_interaction_log(
                work_id=work_id,
                user_input=user_input,
                route_result=validated_route_result,
                route_validation=validation_result,
                execution_result=execution_result,
                execution_validation=execution_validation,
                status=execution_status,
                interaction_id=interaction_id,
            )
            packet["interactionId"] = interaction["id"]
        return packet

    def process_interaction(self, *, work_id: str, text: str) -> JsonDict:
        route_packet = self._route_user_request(work_id=work_id, text=text, persist=True)
        if route_packet["status"] != "READY_FOR_EXECUTION":
            return route_packet
        return self.execute_router_result(
            work_id=work_id,
            route_result=route_packet["routeResult"],
            interaction_id=route_packet.get("interactionId"),
            user_input=text,
            persist=True,
        )

    def list_interactions(self, *, work_id: str) -> list[JsonDict]:
        rows = self.repos.interaction_logs.list_by_work(work_id)
        result: list[JsonDict] = []
        for row in rows:
            result.append(
                {
                    "id": row["id"],
                    "workId": row["work_id"],
                    "userInput": row["user_input"],
                    "routeResult": self._parse_json_text(row["route_result_json"], default={}),
                    "routeValidation": self._parse_json_text(row["route_validation_json"], default={}),
                    "executionResult": self._parse_json_text(row["execution_result_json"], default={}),
                    "executionValidation": self._parse_json_text(row["execution_validation_json"], default={}),
                    "status": row["status"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                }
            )
        return result

    def chat_intent(self, *, work_id: str | None = None, text: str) -> JsonDict:
        if not work_id:
            return {
                "reply": "请先通过“创建立项底稿”建立作品，再发起创作对话。",
                "intent": OTHER,
                "actionResult": None,
                "routeResult": {
                    "intent": OTHER,
                    "parameters": {},
                    "missing_fields": [],
                    "confidence": 1.0,
                    "reply": "当前没有可供创作的作品上下文。",
                },
                "validationResult": None,
                "executionResult": None,
                "executionValidation": None,
                "status": "NEEDS_WORKBENCH",
                "interactionId": None,
                "autofilledFields": [],
            }
        packet = self.process_interaction(work_id=work_id, text=text)
        return self._chat_payload_from_packet(packet)

    def _chat_payload_from_packet(self, packet: JsonDict) -> JsonDict:
        route_result = packet.get("routeResult") or {}
        execution_result = packet.get("executionResult") or {}
        action_result = execution_result.get("actionResult")
        reply = str(route_result.get("reply") or "收到。")
        frontend_action_result = None

        if isinstance(action_result, dict):
            content = str(action_result.get("content") or "").strip()
            if content:
                reply = content
            if isinstance(action_result.get("workbench"), dict):
                frontend_action_result = action_result["workbench"]
            elif any(
                key in action_result
                for key in (
                    "work",
                    "outline",
                    "volumes",
                    "characters",
                    "chapters",
                    "recentDecisions",
                    "readingProjection",
                )
            ):
                frontend_action_result = action_result

        return {
            "reply": reply,
            "intent": route_result.get("intent", OTHER),
            "actionResult": frontend_action_result,
            "routeResult": route_result,
            "validationResult": packet.get("validationResult"),
            "executionResult": execution_result or None,
            "executionValidation": packet.get("executionValidation"),
            "status": packet.get("status"),
            "interactionId": packet.get("interactionId"),
            "autofilledFields": packet.get("autofilledFields", []),
        }

    def _build_executor_registry(self) -> ExecutorRegistry:
        registry = ExecutorRegistry()
        registry.register(CreateCharacterCandidatesExecutor())
        registry.register(RefineExistingCharacterExecutor(self.refine_character))
        registry.register(AdvancePlotExecutor())
        registry.register(SummarizeCurrentStateExecutor())
        return registry

    def _save_interaction_log(
        self,
        *,
        work_id: str,
        user_input: str,
        route_result: JsonDict,
        route_validation: JsonDict,
        status: str,
        execution_result: JsonDict | None = None,
        execution_validation: JsonDict | None = None,
        interaction_id: str | None = None,
    ) -> JsonDict:
        now = now_ms()
        existing = self.repos.interaction_logs.get(interaction_id) if interaction_id else None
        created_at = existing["created_at"] if existing else now
        return self.repos.interaction_logs.save(
            {
                "id": interaction_id or new_id("interaction"),
                "work_id": work_id,
                "user_input": user_input,
                "route_result_json": json_text(route_result, fallback={}),
                "route_validation_json": json_text(route_validation, fallback={}),
                "execution_result_json": json_text(execution_result or {}, fallback={}),
                "execution_validation_json": json_text(execution_validation or {}, fallback={}),
                "status": status,
                "created_at": created_at,
                "updated_at": now,
            }
        )

    def _parse_json_text(self, raw_json: str | None, *, default: Any) -> Any:
        if not raw_json:
            return default
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError:
            return default

    def _log_decision(
        self,
        *,
        work_id: str,
        decision_type: str,
        title: str,
        decision: str,
        rationale: str,
        affected_object_refs: list[str],
        confirmed_by_user: bool,
        extensions: JsonDict | None = None,
        notes: JsonDict | None = None,
    ) -> JsonDict:
        now = now_ms()
        return self.repos.decision_logs.save(
            {
                "id": new_id("decision"),
                "work_id": work_id,
                "decision_type": decision_type,
                "title": title,
                "decision": decision,
                "rationale": rationale,
                "affected_object_refs_json": json_text(affected_object_refs, fallback=[]),
                "confirmed_by_user": 1 if confirmed_by_user else 0,
                "extensions_json": json_text(extensions or {}, fallback={}),
                "notes_json": json_text(notes or {}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )

    def _render_stub_draft(
        self,
        work: JsonDict,
        chapter: JsonDict,
        *,
        instruction_text: str = "",
        rewrite_mode: str = "default",
        base_draft: JsonDict | None = None,
    ) -> str:
        summary = chapter["summary"] or chapter["core_event"] or "本章进入新的冲突。"
        conflict = chapter["conflict"] or "事情没有按预期推进。"
        hook = chapter["ending_hook"] or "新的问题被抛到台前。"
        paragraph_1 = (
            f"本章围绕“{summary}”展开。主角先确认当前目标，"
            "但很快发现局势并不允许他按最稳妥的方式行动。"
        )
        paragraph_2 = (
            f"随着推进，真正的阻力显形：{conflict}。"
            "人物必须在信息不足的情况下做出选择，于是剧情从试探转向硬碰硬。"
        )
        paragraph_3 = (
            "这一轮行动没有彻底解决问题，却把人物关系、外部压力和后续路径都推到了新的位置。"
            f"章末收束在一个明确钩子上：{hook}"
        )

        if instruction_text:
            paragraph_1 += f" 这一次的改写目标是：{instruction_text}。"
            if "狠" in instruction_text or "炸" in instruction_text:
                paragraph_2 = (
                    f"随着推进，阻力被进一步推高：{conflict}。"
                    "人物不再有从容试探的空间，行动更硬，代价也更直接地砸到眼前。"
                )
                paragraph_3 = (
                    "这一轮推进更强调压迫感和后果。"
                    f"章末不做缓冲，直接把人物推进更凶险的下一步：{hook}"
                )
            if "节奏" in instruction_text and ("快" in instruction_text or "紧" in instruction_text):
                paragraph_1 = (
                    f"本章开场就直接切入“{summary}”。"
                    "人物没有长时间铺垫，很快就被推入必须回应的问题中心。"
                )
                paragraph_2 = (
                    f"中段迅速抬高阻力：{conflict}。"
                    "信息与行动几乎同步推进，让局势在更短的空间内完成升级。"
                )
            if "重来" in instruction_text or "重写" in instruction_text or "重出" in instruction_text:
                paragraph_1 += " 这版会刻意换一种推进角度，让冲突更早显形。"

        meta_block = ""
        meta_parts = []
        if base_draft:
            meta_parts.append(f"【修订来源】v{base_draft['version_no']}")
        if instruction_text:
            meta_parts.append(f"【改写模式】{rewrite_mode}")
            meta_parts.append(f"【改写要求】{instruction_text}")
        if meta_parts:
            meta_block = "\n\n" + "\n".join(meta_parts)

        return "\n\n".join(
            [
                f"《{work['title']}》{chapter['title']}{meta_block}",
                paragraph_1,
                paragraph_2,
                paragraph_3,
            ]
        )

    def _save_draft_record(
        self,
        *,
        work_id: str,
        chapter_id: str,
        version_no: int,
        source_type: str,
        text: str,
        summary: str,
        status: str,
        created_by: str,
        extensions: JsonDict | None = None,
        notes: JsonDict | None = None,
    ) -> JsonDict:
        now = now_ms()
        return self.repos.drafts.save(
            {
                "id": new_id("draft"),
                "work_id": work_id,
                "chapter_id": chapter_id,
                "version_no": version_no,
                "source_type": source_type,
                "text": text,
                "word_count": estimate_cn_word_count(text),
                "summary": summary,
                "status": status,
                "created_by": created_by,
                "extensions_json": json_text(extensions or {}, fallback={}),
                "notes_json": json_text(notes or {}, fallback={}),
                "created_at": now,
                "updated_at": now,
            }
        )

    def _merge_json_text(self, raw_json: str | None, patch: JsonDict) -> str:
        current = {}
        if raw_json:
            try:
                parsed = json.loads(raw_json)
                if isinstance(parsed, dict):
                    current = parsed
            except json.JSONDecodeError:
                current = {}
        current.update(patch)
        return json_text(current, fallback={})

    def _require_work(self, work_id: str) -> JsonDict:
        work = self.repos.works.get(work_id)
        if work is None:
            raise KeyError(f"work not found: {work_id}")
        return work

    def _require_chapter(self, chapter_id: str) -> JsonDict:
        chapter = self.repos.chapters.get(chapter_id)
        if chapter is None:
            raise KeyError(f"chapter not found: {chapter_id}")
        return chapter

    def _require_chapter_for_work(self, work_id: str, chapter_id: str) -> JsonDict:
        chapter = self._require_chapter(chapter_id)
        if chapter["work_id"] != work_id:
            raise KeyError(f"chapter {chapter_id} does not belong to work {work_id}")
        return chapter
