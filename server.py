#!/usr/bin/env python3
"""Zero-dependency local server for the AI Novel Studio MVP."""

from __future__ import annotations

import json
import os
import threading
import uuid
from copy import deepcopy
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib import error as urllib_error
from urllib import request as urllib_request


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_PATH = DATA_DIR / "projects.json"
PROMPTS_DIR = ROOT / "prompts"
DEFAULT_PROMPTS_PATH = PROMPTS_DIR / "default_prompts.json"

LOCK = threading.Lock()
RUNNER_LOCK = threading.Lock()
AUTO_RUNNERS: dict[str, threading.Thread] = {}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def default_automation_state() -> dict:
    return {
        "runStatus": "idle",
        "currentRun": None,
    }


def prompt_config_path() -> Path:
    configured_path = os.getenv("AI_NOVEL_PROMPTS_PATH", "").strip()
    if configured_path:
        return Path(configured_path).expanduser()
    return DEFAULT_PROMPTS_PATH


def load_prompt_config() -> dict:
    path = prompt_config_path()
    if not path.exists():
        raise RuntimeError(f"prompt config not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def prompt_status_payload() -> dict:
    path = prompt_config_path()
    return {
        "path": str(path),
        "exists": path.exists(),
    }


def default_prompt_config() -> dict:
    return {
        "full_outline": {
            "temperature": 0.9,
            "system": "",
            "user": "",
        },
        "volume_goal": {
            "temperature": 0.8,
            "system": "",
            "user": "",
        },
        "volume_chapters": {
            "temperature": 0.8,
            "system": "",
            "user": "",
        },
        "chapter_outline": {
            "temperature": 0.8,
            "system": "",
            "user": "",
        },
        "chapter_draft": {
            "temperature": 0.9,
            "system": "",
            "user": "",
        },
    }


def normalize_prompt_config(config: dict) -> dict:
    normalized = default_prompt_config()
    for key, default_item in normalized.items():
        incoming_item = {}
        if isinstance(config, dict):
            incoming_item = config.get(key, {})
            if key == "full_outline" and not isinstance(incoming_item, dict):
                incoming_item = config.get("outline", {})
        if not isinstance(incoming_item, dict):
            incoming_item = {}
        normalized[key] = {
            "temperature": float(incoming_item.get("temperature", default_item["temperature"])),
            "system": str(incoming_item.get("system", default_item["system"])),
            "user": str(incoming_item.get("user", default_item["user"])),
        }
    return normalized


def save_prompt_config(config: dict) -> dict:
    normalized = normalize_prompt_config(config)
    path = prompt_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return normalized


def json_text(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def get_preset_categories(genre: str) -> list[dict]:
    genre_l = genre.lower()
    presets = []
    if "历史" in genre_l:
        presets = ["历史事件", "历史人物", "参考书籍", "地理与地图", "制度与官职"]
    elif any(kw in genre_l for kw in ["玄幻", "仙侠", "修真"]):
        presets = ["功法体系", "灵兽图鉴", "秘境副本", "丹药/法宝", "宗门势力"]
    elif any(kw in genre_l for kw in ["都市", "行业", "职场"]):
        presets = ["公司/组织", "行业知识", "地点场景", "社会关系"]
    elif any(kw in genre_l for kw in ["科幻", "赛博", "星际"]):
        presets = ["科技设定", "星球/空间站", "种族文明", "武器装备"]
    elif any(kw in genre_l for kw in ["悬疑", "侦探", "推理"]):
        presets = ["案件档案", "线索物证", "时间线", "地点平面图"]
    else:
        presets = ["通用参考", "灵感记录"]

    return [
        {"id": uuid.uuid4().hex[:8], "name": name, "entries": []}
        for name in presets
    ]


def project_prompt_context(project: dict) -> dict:
    volumes = project.get("volumes", [])
    volume_goals = [
        str(volume.get("goal", "")).strip()
        for volume in volumes
        if isinstance(volume, dict) and str(volume.get("goal", "")).strip()
    ]
    outline_goal = "\n".join(
        f"第{index}卷：{goal}" for index, goal in enumerate(volume_goals, start=1)
    ) or "待补充"

    return {
        "project_title": project["title"],
        "project_genre": project["genre"],
        "project_hook": project["hook"],
        "settings_theme": project["settings"]["theme"] or "待补充",
        "settings_world": project["settings"]["world"] or "待补充",
        "settings_power_system": project["settings"]["powerSystem"] or "待补充",
        "settings_factions": project["settings"]["factions"] or "待补充",
        "outline_premise": project["outline"]["premise"] or "待补充",
        "outline_volume_goal": outline_goal,
        "characters_json": json_text(project["characters"]),
        "project_library_json": json_text(project.get("library", [])),
    }


def previous_chapters_summary(project: dict, chapter_number: int) -> str:
    summaries = []
    for n in range(1, chapter_number):
        prev_ch = chapter_by_number(project, n)
        title = prev_ch["title"] or f"第{n}章"
        outline = prev_ch["outline"].strip() or "（无细纲）"
        summaries.append(f"- 第{n}章《{title}》：{outline}")
    return "\n".join(summaries) if summaries else "无（这是第一章）"


def chapter_prompt_context(project: dict, chapter_number: int) -> dict:
    chapter = chapter_by_number(project, chapter_number)
    plan = plan_by_number(project, chapter_number)
    context = project_prompt_context(project)

    volume_number = chapter.get("volumeNumber", 1)
    volume = next((v for v in project.get("volumes", []) if v["number"] == volume_number), {})

    context.update(
        {
            "chapter_number": chapter_number,
            "chapter_title": chapter["title"] or f"第{chapter_number}章",
            "chapter_outline": chapter["outline"] or "待补充",
            "chapter_foreshadow_json": json_text(chapter["foreshadow"]),
            "chapter_plan_json": json_text(plan),
            "previous_chapters_summary": previous_chapters_summary(project, chapter_number),
            "volume_number": volume_number,
            "volume_title": volume.get("title", f"第{volume_number}卷"),
            "volume_goal": volume.get("goal", ""),
        }
    )
    return context


def volume_prompt_context(project: dict, volume_number: int) -> dict:
    context = project_prompt_context(project)
    volume = next((v for v in project.get("volumes", []) if v["number"] == volume_number), None)
    if not volume:
        raise ValueError(f"Volume {volume_number} not found")
    context.update(
        {
            "volume_number": volume_number,
            "volume_title": volume.get("title", f"第{volume_number}卷"),
            "volume_goal": volume.get("goal", ""),
        }
    )
    return context


def render_prompt_config(prompt_name: str, context: dict) -> dict:
    config = load_prompt_config()
    prompt = config.get(prompt_name)
    if not isinstance(prompt, dict):
        raise RuntimeError(f"prompt '{prompt_name}' not found in config")

    try:
        system_prompt = str(prompt["system"]).format(**context)
        user_prompt = str(prompt["user"]).format(**context)
    except KeyError as exc:
        raise RuntimeError(f"prompt '{prompt_name}' missing context key: {exc.args[0]}") from exc

    return {
        "system": system_prompt,
        "user": user_prompt,
        "temperature": float(prompt.get("temperature", 0.7)),
    }


def llm_settings() -> dict:
    api_key = (
        os.getenv("AI_NOVEL_API_KEY")
        or os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    base_url = (
        os.getenv("AI_NOVEL_BASE_URL")
        or os.getenv("DEEPSEEK_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.deepseek.com"
    ).rstrip("/")
    model = (
        os.getenv("AI_NOVEL_MODEL")
        or os.getenv("DEEPSEEK_MODEL")
        or os.getenv("OPENAI_MODEL")
        or "deepseek-chat"
    )
    mode = (os.getenv("AI_NOVEL_LLM_MODE") or "auto").strip().lower()
    timeout = int(os.getenv("AI_NOVEL_TIMEOUT", "300"))
    configured = bool(api_key and model and mode != "stub")

    if mode == "stub":
        message = "已强制使用规则模板"
    elif configured:
        message = f"真实模型已启用：{model}"
    else:
        message = "未配置模型，当前使用规则模板"

    return {
        "mode": mode,
        "configured": configured,
        "provider": "deepseek-compatible",
        "model": model,
        "baseUrl": base_url,
        "timeout": timeout,
        "message": message,
    }


def llm_status_payload() -> dict:
    settings = llm_settings()
    return {
        "configured": settings["configured"],
        "mode": settings["mode"],
        "provider": settings["provider"],
        "model": settings["model"],
        "baseUrl": settings["baseUrl"],
        "message": settings["message"],
    }


def extract_json_block(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            closing = cleaned.rfind("```", first_newline)
            if closing > first_newline:
                cleaned = cleaned[first_newline + 1 : closing].strip()
            else:
                cleaned = cleaned[first_newline + 1 :].strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        print(f"[extract_json_block] no JSON object found in response ({len(text)} chars):")
        print(text[:500])
        raise ValueError("model did not return a JSON object")
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        print(f"[extract_json_block] JSON parse failed: {exc}")
        print(f"[extract_json_block] extracted slice ({start}..{end+1}):")
        print(cleaned[start : start + 300])
        raise


def chat_completion(system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
    settings = llm_settings()
    if not settings["configured"]:
        raise RuntimeError("llm not configured")

    api_key = (
        os.getenv("AI_NOVEL_API_KEY")
        or os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    payload = {
        "model": settings["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }
    request = urllib_request.Request(
        url=f"{settings['baseUrl']}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib_request.urlopen(request, timeout=settings["timeout"]) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"llm http error {exc.code}: {detail[:240]}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"llm request failed: {exc.reason}") from exc

    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("llm response has no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    raise RuntimeError("llm response content is empty")


def create_empty_plan(number: int, volume_number: int = 1) -> dict:
    return {"chapterNumber": number, "volumeNumber": volume_number, "focus": "", "hook": ""}


def create_empty_chapter(number: int, volume_number: int = 1) -> dict:
    return {
        "number": number,
        "volumeNumber": volume_number,
        "title": f"第{number}章",
        "outline": "",
        "content": "",
        "status": "not_started",
        "characters": [],
        "foreshadow": [],
        "checkResult": None,
        "reviewMode": "manual",
        "updatedAt": now(),
    }


def create_empty_volume(number: int) -> dict:
    titles = {1: "第一卷", 2: "第二卷", 3: "第三卷", 4: "第四卷", 5: "第五卷"}
    return {
        "number": number,
        "title": titles.get(number, f"第{number}卷"),
        "goal": "",
        "status": "not_started",
    }


def recalculate_project_status(project: dict) -> None:
    chapters = project.get("chapters", [])
    total_chapters = len(chapters)
    approved_count = sum(1 for chapter in chapters if chapter["status"] == "approved")
    drafted_count = sum(
        1 for chapter in chapters if chapter["status"] in {"drafted", "system_passed", "approved"}
    )
    outlined_count = sum(
        1 for chapter in chapters if chapter["status"] != "not_started"
    )
    has_settings = bool(project["settings"]["theme"] and project["settings"]["world"])
    has_outline = any(plan["focus"].strip() for plan in project["outline"]["chapterPlans"])
    automation = project.get("automation", default_automation_state())
    run_status = automation.get("runStatus", "idle")
    current_run = automation.get("currentRun") or {}

    for volume in project.get("volumes", []):
        volume_number = volume.get("number", 1)
        volume_chapters = [chapter for chapter in chapters if chapter.get("volumeNumber") == volume_number]
        if volume_chapters and all(chapter["status"] == "approved" for chapter in volume_chapters):
            volume["status"] = "human_passed"
        elif volume_chapters and all(
            chapter["status"] in {"system_passed", "approved"} for chapter in volume_chapters
        ):
            volume["status"] = "system_passed"
        elif any(chapter["status"] in {"outlined", "drafted"} for chapter in volume_chapters):
            volume["status"] = "drafting"
        elif volume.get("goal", "").strip() or any(
            plan.get("volumeNumber") == volume_number and plan.get("focus", "").strip()
            for plan in project["outline"]["chapterPlans"]
        ):
            volume["status"] = "planned"
        else:
            volume["status"] = "not_started"

    if run_status == "running":
        project["status"] = "自动推进中"
        project["nextAction"] = current_run.get("message", "自动任务执行中")
        return
    if run_status == "paused":
        project["status"] = "自动推进暂停"
        project["nextAction"] = current_run.get("message", "等待继续自动推进")
        return
    if run_status == "failed":
        project["status"] = "自动推进失败"
        project["nextAction"] = current_run.get("error", "请检查自动任务错误")
        return

    if total_chapters > 0 and approved_count == total_chapters:
        if total_chapters == 3:
            project["status"] = "前三章已完成"
        else:
            project["status"] = f"前 {total_chapters} 章已完成"
        project["nextAction"] = f"决定是否推进第 {total_chapters + 1} 章"
    elif drafted_count > 0:
        project["status"] = "章节推进中"
        next_to_draft = 1
        for ch in chapters:
            if ch["status"] not in {"drafted", "approved"}:
                next_to_draft = ch["number"]
                break
        else:
            next_to_draft = total_chapters
        project["nextAction"] = f"继续处理第 {next_to_draft} 章"
    elif has_outline or outlined_count > 0:
        project["status"] = "章节推进中"
        project["nextAction"] = "生成第 1 章草稿"
    elif has_settings:
        project["status"] = "大纲中"
        project["nextAction"] = "创建第一章并补全大纲"
    else:
        project["status"] = "设定中"
        project["nextAction"] = "补全最小设定"


def create_project(title: str, genre: str, hook: str) -> dict:
    project = {
        "id": f"novel-{uuid.uuid4().hex[:10]}",
        "title": title,
        "genre": genre,
        "hook": hook,
        "platform": "起点中文网",
        "audience": "偏剧情向的男频读者",
        "status": "设定中",
        "nextAction": "补全最小设定",
        "updatedAt": now(),
        "settings": {
            "theme": "",
            "world": "",
            "powerSystem": "",
            "factions": "",
        },
        "characters": [
            {"name": "主角", "role": "主角", "goal": ""},
            {"name": "对手", "role": "反派", "goal": ""},
        ],
        "volumes": [create_empty_volume(1)],
        "outline": {
            "premise": "",
            "chapterPlans": [create_empty_plan(1, 1)],
        },
        "chapters": [create_empty_chapter(1, 1)],
        "library": get_preset_categories(genre),
        "generationRecords": [],
    }
    recalculate_project_status(project)
    return project


def seed_projects() -> list[dict]:
    return [
        create_project(
            title="赤潮学院",
            genre="学院流 / 玄幻",
            hook="落榜少年靠禁书图鉴，逆向解构精英学院的秩序。",
        ),
        create_project(
            title="霜港遗民",
            genre="末世 / 经营",
            hook="极夜海港的最后一名维修官，要把废弃港口变成幸存者之城。",
        ),
    ]


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_PATH.exists():
        DATA_PATH.write_text(
            json.dumps({"projects": seed_projects()}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def load_payload() -> dict:
    ensure_storage()
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return {
        "projects": [normalize_project(project) for project in payload.get("projects", [])]
    }


def save_payload(payload: dict) -> None:
    DATA_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def chapter_by_number(project: dict, number: int) -> dict:
    for chapter in project["chapters"]:
        if chapter["number"] == number:
            return chapter
    raise KeyError(f"chapter {number} not found")


def plan_by_number(project: dict, number: int) -> dict:
    for plan in project["outline"]["chapterPlans"]:
        if plan["chapterNumber"] == number:
            return plan
    raise KeyError(f"chapter plan {number} not found")


def normalize_project(project: dict) -> dict:
    normalized = deepcopy(project)
    normalized.setdefault("platform", "起点中文网")
    normalized.setdefault("audience", "偏剧情向的男频读者")
    normalized.setdefault("hook", "")
    normalized.setdefault("settings", {})
    normalized["settings"].setdefault("theme", "")
    normalized["settings"].setdefault("world", "")
    normalized["settings"].setdefault("powerSystem", "")
    normalized["settings"].setdefault("factions", "")
    normalized.setdefault("characters", [])
    normalized.setdefault("outline", {})
    normalized["outline"].setdefault("premise", "")
    normalized["outline"].setdefault("chapterPlans", [])
    normalized.setdefault("chapters", [])
    normalized.setdefault("library", [])
    normalized.setdefault("generationRecords", [])
    normalized.setdefault("automation", default_automation_state())
    normalized["automation"].setdefault("runStatus", "idle")
    normalized["automation"].setdefault("currentRun", None)
    if isinstance(normalized["automation"].get("currentRun"), dict):
        normalized["automation"]["currentRun"].setdefault("options", {})

    # Migrate old volumeGoal to volumes
    old_volume_goal = normalized["outline"].pop("volumeGoal", "")
    if "volumes" not in normalized or not normalized["volumes"]:
        normalized["volumes"] = [
            {
                "number": 1,
                "title": "第一卷",
                "goal": old_volume_goal,
            }
        ]
    else:
        for vol in normalized["volumes"]:
            vol.setdefault("number", 1)
            vol.setdefault("title", f"第{vol['number']}卷")
            vol.setdefault("goal", "")
            vol.setdefault("status", "not_started")

    # Determine max chapter number to preserve all existing data
    existing_nums = {
        p.get("chapterNumber") for p in normalized["outline"]["chapterPlans"]
        if isinstance(p, dict) and isinstance(p.get("chapterNumber"), int)
    } | {
        c.get("number") for c in normalized["chapters"]
        if isinstance(c, dict) and isinstance(c.get("number"), int)
    }
    # For a newly created project or one where we want dynamic growth, 
    # we only force a minimum of 1 if everything is empty.
    max_num = max(existing_nums) if existing_nums else 0
    chapter_range = range(1, max_num + 1)

    plans_by_number = {
        plan.get("chapterNumber"): plan
        for plan in normalized["outline"]["chapterPlans"]
        if isinstance(plan, dict) and isinstance(plan.get("chapterNumber"), int)
    }
    new_plans = []
    for num in chapter_range:
        plan = plans_by_number.get(num, create_empty_plan(num))
        plan.setdefault("volumeNumber", 1)
        new_plans.append(plan)
    normalized["outline"]["chapterPlans"] = new_plans

    chapters_by_number = {
        chapter.get("number"): chapter
        for chapter in normalized["chapters"]
        if isinstance(chapter, dict) and isinstance(chapter.get("number"), int)
    }
    merged_chapters = []
    for number in chapter_range:
        chapter = create_empty_chapter(number)
        chapter.update(chapters_by_number.get(number, {}))
        chapter["number"] = number
        chapter.setdefault("volumeNumber", 1)
        chapter.setdefault("characters", [])
        chapter.setdefault("foreshadow", [])
        chapter.setdefault("checkResult", None)
        chapter.setdefault("reviewMode", "manual")
        chapter.setdefault("updatedAt", now())
        if chapter["status"] not in {"not_started", "outlined", "drafted", "system_passed", "approved"}:
            chapter["status"] = "not_started"
        merged_chapters.append(chapter)
    normalized["chapters"] = merged_chapters

    normalized.setdefault("updatedAt", now())
    recalculate_project_status(normalized)
    return normalized


def append_record(project: dict, record_type: str, chapter_number: int, summary: str) -> None:
    project["generationRecords"].append(
        {
            "type": record_type,
            "chapterNumber": chapter_number,
            "summary": summary,
            "createdAt": now(),
        }
    )


def active_runner_exists(project_id: str) -> bool:
    with RUNNER_LOCK:
        thread = AUTO_RUNNERS.get(project_id)
        if thread and thread.is_alive():
            return True
        AUTO_RUNNERS.pop(project_id, None)
        return False


def register_runner(project_id: str, thread: threading.Thread) -> None:
    with RUNNER_LOCK:
        AUTO_RUNNERS[project_id] = thread


def unregister_runner(project_id: str) -> None:
    with RUNNER_LOCK:
        AUTO_RUNNERS.pop(project_id, None)


def system_pass_chapter(project: dict, chapter_number: int) -> None:
    chapter = chapter_by_number(project, chapter_number)
    check_result = chapter.get("checkResult")
    if not isinstance(check_result, dict) or not check_result.get("ok"):
        raise ValueError("chapter check must pass before system approval")
    if chapter["status"] != "approved":
        chapter["status"] = "system_passed"
    chapter["reviewMode"] = "automatic"
    chapter["updatedAt"] = now()
    append_record(project, "系统审核通过", chapter_number, f"第 {chapter_number} 章已通过系统审核。")


def update_automation_state(
    project: dict,
    run_status: str,
    *,
    scope: str = "volume",
    volume_number: int | None = None,
    step: str | None = None,
    chapter_number: int | None = None,
    message: str = "",
    error: str = "",
    options: dict | None = None,
) -> None:
    project.setdefault("automation", default_automation_state())
    project["automation"]["runStatus"] = run_status
    if run_status == "idle":
        project["automation"]["currentRun"] = None
        return

    current_run = project["automation"].get("currentRun") or {}
    started_at = current_run.get("startedAt") or now()
    project["automation"]["currentRun"] = {
        "scope": scope,
        "volumeNumber": volume_number,
        "step": step,
        "chapterNumber": chapter_number,
        "message": message,
        "error": error,
        "options": deepcopy(options) if options is not None else deepcopy(current_run.get("options") or {}),
        "startedAt": started_at,
        "updatedAt": now(),
    }


def normalize_book_auto_options(project: dict, options: dict | None) -> dict:
    volume_numbers = sorted(
        volume.get("number")
        for volume in project.get("volumes", [])
        if isinstance(volume, dict) and isinstance(volume.get("number"), int)
    )
    if not volume_numbers:
        raise ValueError("当前项目没有可推进的卷。")

    incoming = options if isinstance(options, dict) else {}
    start_volume = int(incoming.get("startVolumeNumber", volume_numbers[0]))
    end_volume = int(incoming.get("endVolumeNumber", volume_numbers[-1]))
    available = set(volume_numbers)
    if start_volume not in available:
        raise ValueError(f"起始卷不存在：第 {start_volume} 卷。")
    if end_volume not in available:
        raise ValueError(f"结束卷不存在：第 {end_volume} 卷。")
    if start_volume > end_volume:
        raise ValueError("起始卷不能大于结束卷。")

    selected = [number for number in volume_numbers if start_volume <= number <= end_volume]
    if not selected:
        raise ValueError("当前范围内没有可推进的卷。")

    return {
        "startVolumeNumber": start_volume,
        "endVolumeNumber": end_volume,
        "skipSystemPassedChapters": bool(incoming.get("skipSystemPassedChapters", True)),
    }


def describe_book_auto_options(options: dict) -> str:
    start_volume = options.get("startVolumeNumber", "-")
    end_volume = options.get("endVolumeNumber", "-")
    skip_text = "跳过已系统通过章节" if options.get("skipSystemPassedChapters", True) else "重跑已系统通过章节"
    if start_volume == end_volume:
        volume_text = f"第 {start_volume} 卷"
    else:
        volume_text = f"第 {start_volume} 卷到第 {end_volume} 卷"
    return f"{volume_text}，{skip_text}"


def generate_chapter_hook(chapter_number: int) -> str:
    hooks = {
        1: "主角为什么会被卷入这场秩序失衡？",
        2: "第一次主动出手会暴露什么代价？",
        3: "阶段性胜利背后隐藏着更大的真相吗？",
    }
    return hooks[chapter_number]


def first_line(text: str, fallback: str = "") -> str:
    for line in text.strip().splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return fallback


def generate_single_outline(project: dict, chapter_number: int) -> str:
    lead = project["characters"][0]["name"] if project["characters"] else "主角"
    rival = project["characters"][1]["name"] if len(project["characters"]) > 1 else "对手"
    theme = first_line(project["settings"]["theme"], "生存与改写命运")
    world = first_line(project["settings"]["world"], f"{project['genre']}世界")

    templates = {
        1: f'{lead}在{world}中被迫出场，故事核心冲突第一次显形，主题指向“{theme}”。',
        2: f'{lead}试图利用自身优势反制局面，{rival}开始施加更直接的压力，同时抛出中程悬念。',
        3: f'{lead}完成第一次阶段性破局，但代价与更大阴影同时显现，为第 4 章留出跃迁空间。',
    }
    return templates[chapter_number]



def generate_chapter_outline(project: dict, chapter_number: int) -> None:

    plan = plan_by_number(project, chapter_number)
    chapter = chapter_by_number(project, chapter_number)
    prompts = render_prompt_config(
        "chapter_outline",
        chapter_prompt_context(project, chapter_number),
    )
    payload = extract_json_block(
        chat_completion(prompts["system"], prompts["user"], prompts["temperature"])
    )
    plan["focus"] = str(payload.get("outline", "")).strip() or plan["focus"]
    foreshadow_items = [
        item.strip()
        for item in payload.get("foreshadow", [])
        if isinstance(item, str) and item.strip()
    ]
    plan["hook"] = foreshadow_items[0] if foreshadow_items else plan["hook"]
    chapter["outline"] = plan["focus"]
    chapter["title"] = str(payload.get("title", "")).strip() or chapter["title"] or f"第{chapter_number}章"
    chapter["characters"] = [
        item.strip()
        for item in payload.get("characters", [])
        if isinstance(item, str) and item.strip()
    ] or [item["name"] for item in project["characters"][:3] if item["name"].strip()]
    chapter["foreshadow"] = foreshadow_items or [f"第{chapter_number}章核心钩子"]
    chapter["status"] = "drafted" if chapter["content"].strip() else "outlined"
    chapter["updatedAt"] = now()
    append_record(
        project,
        "单章细纲生成",
        chapter_number,
        f"通过真实模型为第 {chapter_number} 章生成了细纲。",
    )



def generate_chapter_draft(project: dict, chapter_number: int) -> None:
    chapter = chapter_by_number(project, chapter_number)
    if not chapter["outline"].strip():
        generate_chapter_outline(project, chapter_number)

    prompts = render_prompt_config(
        "chapter_draft",
        chapter_prompt_context(project, chapter_number),
    )
    chapter["content"] = chat_completion(
        prompts["system"],
        prompts["user"],
        prompts["temperature"],
    ).strip()
    if not chapter["content"]:
        raise ValueError("draft content is empty")
    chapter["status"] = "drafted"
    chapter["updatedAt"] = now()
    append_record(
        project,
        "章节草稿生成",
        chapter_number,
        f"通过真实模型为第 {chapter_number} 章生成了草稿。",
    )



def generate_full_outline(project: dict) -> None:
    prompts = render_prompt_config(
        "full_outline",
        project_prompt_context(project),
    )
    # The full outline generation can be large, so we ensure extracting JSON from potential reasoning text
    payload = extract_json_block(
        chat_completion(prompts["system"], prompts["user"], prompts["temperature"])
    )

    reasoning = str(payload.get("reasoning", "未提供评估理由")).strip()
    new_volumes = payload.get("volumes", [])
    new_chapters = payload.get("chapters", [])

    if not isinstance(new_volumes, list) or not new_volumes:
        raise ValueError("AI 未生成有效的卷纲数据")
    if not isinstance(new_chapters, list) or not new_chapters:
        raise ValueError("AI 未生成有效的章节计划数据")

    # Limit boundaries to prevent token/memory overflow
    if len(new_volumes) > 20:
        new_volumes = new_volumes[:20]
    if len(new_chapters) > 200:
        new_chapters = new_chapters[:200]

    # Update project volumes
    project["volumes"] = []
    for vol in new_volumes:
        project["volumes"].append({
            "number": int(vol.get("number", 1)),
            "title": str(vol.get("title", f"第{vol.get('number', 1)}卷")).strip(),
            "goal": str(vol.get("goal", "")).strip(),
        })

    # Update project chapter plans and chapters
    project["outline"]["chapterPlans"] = []
    project["chapters"] = []
    
    for ch in new_chapters:
        num = int(ch.get("number", 1))
        vol_num = int(ch.get("volumeNumber", 1))
        
        # Add to chapter plans
        project["outline"]["chapterPlans"].append({
            "chapterNumber": num,
            "volumeNumber": vol_num,
            "focus": str(ch.get("focus", "")).strip(),
            "hook": str(ch.get("hook", "")).strip(),
        })
        
        # Create empty chapter object
        chapter_obj = create_empty_chapter(num, vol_num)
        chapter_obj["title"] = str(ch.get("title", f"第{num}章")).strip()
        project["chapters"].append(chapter_obj)

    project["status"] = "大纲中"
    append_record(
        project, 
        "全书大纲生成", 
        0, 
        f"AI 智能推演完成。评估理由：{reasoning}。共生成 {len(project['volumes'])} 卷，{len(project['chapters'])} 章。"
    )


def generate_volume_goal(project: dict, volume_number: int) -> None:
    volume = next((v for v in project.get("volumes", []) if v["number"] == volume_number), None)
    if not volume:
        raise ValueError(f"Volume {volume_number} not found")

    prompts = render_prompt_config("volume_goal", volume_prompt_context(project, volume_number))

    payload = extract_json_block(
        chat_completion(prompts["system"], prompts["user"], prompts["temperature"])
    )

    volume["title"] = str(payload.get("title", volume["title"])).strip()
    volume["goal"] = str(payload.get("goal", "")).strip()
    
    append_record(
        project,
        "卷目标生成",
        0,
        f"为第 {volume_number} 卷生成了核心目标：{volume['title']}",
    )


def generate_volume_chapters(project: dict, volume_number: int) -> None:
    volume = next((v for v in project.get("volumes", []) if v["number"] == volume_number), None)
    if not volume:
        raise ValueError(f"Volume {volume_number} not found")
    
    if not volume.get("goal", "").strip():
        generate_volume_goal(project, volume_number)

    prompts = render_prompt_config("volume_chapters", volume_prompt_context(project, volume_number))
    payload = extract_json_block(
        chat_completion(prompts["system"], prompts["user"], prompts["temperature"])
    )

    new_chapters = payload.get("chapters", [])
    if not isinstance(new_chapters, list) or not new_chapters:
        raise ValueError("AI 未生成有效的章节计划数据")

    existing_volume_plans = {
        plan["chapterNumber"]: plan
        for plan in project["outline"]["chapterPlans"]
        if plan.get("volumeNumber") == volume_number
    }

    # Replace only the selected volume's chapter plans.
    project["outline"]["chapterPlans"] = [p for p in project["outline"]["chapterPlans"] if p.get("volumeNumber") != volume_number]

    # Reuse the current volume's chapter slots first, then allocate new global chapter
    # numbers to avoid collisions with other volumes.
    existing_chapters = {c["number"]: c for c in project["chapters"]}
    existing_volume_numbers = sorted(
        c["number"] for c in project["chapters"] if c.get("volumeNumber") == volume_number
    )
    used_numbers: set[int] = set(existing_chapters)
    next_number = max(used_numbers, default=0) + 1

    assigned_numbers: list[int] = []
    for index, _ in enumerate(new_chapters):
        if index < len(existing_volume_numbers):
            assigned_numbers.append(existing_volume_numbers[index])
            continue
        while next_number in used_numbers:
            next_number += 1
        assigned_numbers.append(next_number)
        used_numbers.add(next_number)
        next_number += 1

    for assigned_number, ch in zip(assigned_numbers, new_chapters):
        project["outline"]["chapterPlans"].append({
            "chapterNumber": assigned_number,
            "volumeNumber": volume_number,
            "focus": str(ch.get("focus", "")).strip(),
            "hook": str(ch.get("hook", "")).strip(),
        })

        if assigned_number in existing_chapters:
            chapter = existing_chapters[assigned_number]
            chapter["volumeNumber"] = volume_number
            if chapter["status"] == "not_started":
                chapter["title"] = str(ch.get("title", f"第{assigned_number}章")).strip()
        else:
            chapter_obj = create_empty_chapter(assigned_number, volume_number)
            chapter_obj["title"] = str(ch.get("title", f"第{assigned_number}章")).strip()
            project["chapters"].append(chapter_obj)

    reused_numbers = set(assigned_numbers)
    preserved_plan_numbers = {
        chapter["number"]
        for chapter in project["chapters"]
        if chapter.get("volumeNumber") == volume_number
        and chapter.get("number") not in reused_numbers
        and chapter.get("status") != "not_started"
    }
    for chapter_number in sorted(preserved_plan_numbers):
        plan = existing_volume_plans.get(chapter_number)
        if plan:
            project["outline"]["chapterPlans"].append(plan)

    project["chapters"] = [
        chapter
        for chapter in project["chapters"]
        if chapter.get("volumeNumber") != volume_number
        or chapter.get("number") in reused_numbers
        or chapter.get("status") != "not_started"
    ]

    project["chapters"].sort(key=lambda c: c["number"])
    project["outline"]["chapterPlans"].sort(key=lambda p: p["chapterNumber"])

    append_record(
        project,
        "卷章节计划生成",
        0,
        f"为第 {volume_number} 卷生成了 {len(new_chapters)} 个章节计划。",
    )


def run_chapter_check(project: dict, chapter_number: int) -> dict:
    chapter = chapter_by_number(project, chapter_number)
    messages: list[str] = []

    if not project["title"].strip():
        messages.append("项目书名为空。")
    if not project["settings"]["theme"].strip():
        messages.append("项目主题为空。")
    if not project["settings"]["world"].strip():
        messages.append("世界观为空。")
    if not chapter["title"].strip():
        messages.append("章节标题为空。")
    if not chapter["outline"].strip():
        messages.append("章节细纲为空。")
    if not chapter["content"].strip():
        messages.append("章节正文为空。")
    if not chapter["characters"]:
        messages.append("章节未绑定角色。")

    known_characters = {item["name"] for item in project["characters"] if item["name"].strip()}
    missing = [name for name in chapter["characters"] if name not in known_characters]
    if missing:
        messages.append(f"章节角色未在设定中登记：{'、'.join(missing)}")

    result = {
        "ok": len(messages) == 0,
        "messages": messages
        if messages
        else ["标题、设定、细纲、正文与角色引用均通过基础检查。"],
    }
    chapter["checkResult"] = result
    chapter["updatedAt"] = now()
    append_record(project, "章节检查", chapter_number, "章节检查通过。" if result["ok"] else "章节检查发现待补项。")
    return result


def approve_chapter(project: dict, chapter_number: int) -> None:
    chapter = chapter_by_number(project, chapter_number)
    check_result = chapter.get("checkResult")
    if not isinstance(check_result, dict) or not check_result.get("ok"):
        raise ValueError("请先让当前章节通过基础检查，再执行批准。")
    chapter["status"] = "approved"
    chapter["updatedAt"] = now()
    append_record(project, "人工批准", chapter_number, f"第 {chapter_number} 章已被人工批准。")


def list_projects() -> list[dict]:
    with LOCK:
        return load_payload()["projects"]


def get_project_automation(project_id: str) -> dict:
    project = get_project(project_id)
    return deepcopy(project.get("automation", default_automation_state()))


def get_project(project_id: str) -> dict:
    for project in list_projects():
        if project["id"] == project_id:
            return project
    raise KeyError("project not found")


def mutate_projects(mutator):
    with LOCK:
        payload = load_payload()
        projects = payload["projects"]
        result = mutator(projects)
        save_payload({"projects": projects})
        return result


def replace_project(projects: list[dict], project_id: str, incoming: dict) -> dict:
    for index, project in enumerate(projects):
        if project["id"] == project_id:
            incoming["id"] = project_id
            incoming["generationRecords"] = incoming.get("generationRecords", project["generationRecords"])
            recalculate_project_status(incoming)
            projects[index] = incoming
            return incoming
    raise KeyError("project not found")


def delete_project(projects: list[dict], project_id: str) -> dict:
    for index, project in enumerate(projects):
        if project["id"] == project_id:
            removed = projects.pop(index)
            return removed
    raise KeyError("project not found")


def mutate_one_project(projects: list[dict], project_id: str, action) -> dict:
    pid = project_id.strip()
    for project in projects:
        if str(project.get("id", "")).strip() == pid:
            action(project)
            project["updatedAt"] = now()
            recalculate_project_status(project)
            return project
    
    available_ids = [str(p.get("id", "")) for p in projects]
    abs_path = str(DATA_PATH.resolve())
    raise KeyError(f"Project '{pid}' not found (loading from {abs_path}). Available IDs: {available_ids}")


def mutate_chapter_action(projects: list[dict], project_id: str, chapter_number: int, action: str) -> dict:
    def apply(project: dict) -> None:
        if action == "generate-outline":
            generate_chapter_outline(project, chapter_number)
        elif action == "generate-draft":
            generate_chapter_draft(project, chapter_number)
        elif action == "check":
            run_chapter_check(project, chapter_number)
        elif action == "approve":
            approve_chapter(project, chapter_number)
        else:
            raise ValueError("unsupported chapter action")

    return mutate_one_project(projects, project_id, apply)


def set_volume_auto_run_state(projects: list[dict], project_id: str, volume_number: int, action: str) -> dict:
    def apply(project: dict) -> None:
        current = project.get("automation", default_automation_state())
        current_run = current.get("currentRun") or {}
        current_volume = current_run.get("volumeNumber")
        current_scope = current_run.get("scope")

        if action == "start":
            if current.get("runStatus") in {"running", "paused"}:
                raise ValueError("已有自动任务进行中，请先继续或等待完成。")
            if not project["settings"]["theme"].strip() or not project["settings"]["world"].strip():
                raise ValueError("请先补全主题和世界观，再启动自动推进。")
            update_automation_state(
                project,
                "running",
                scope="volume",
                volume_number=volume_number,
                step="volume_goal",
                message=f"准备自动推进第 {volume_number} 卷。",
            )
            append_record(project, "自动推进", 0, f"已启动第 {volume_number} 卷自动推进。")
            return

        if current_scope != "volume" or current_volume != volume_number:
            raise ValueError(f"当前没有第 {volume_number} 卷的自动任务。")

        if action == "pause":
            if current.get("runStatus") != "running":
                raise ValueError("当前自动任务不在运行中。")
            update_automation_state(
                project,
                "paused",
                scope="volume",
                volume_number=volume_number,
                step=current_run.get("step"),
                chapter_number=current_run.get("chapterNumber"),
                message=f"第 {volume_number} 卷自动推进已暂停。",
            )
            append_record(project, "自动推进", 0, f"已暂停第 {volume_number} 卷自动推进。")
            return

        if action == "resume":
            if current.get("runStatus") != "paused":
                raise ValueError("当前自动任务不在暂停状态。")
            update_automation_state(
                project,
                "running",
                scope="volume",
                volume_number=volume_number,
                step=current_run.get("step") or "volume_goal",
                chapter_number=current_run.get("chapterNumber"),
                message=f"继续自动推进第 {volume_number} 卷。",
            )
            append_record(project, "自动推进", 0, f"已继续第 {volume_number} 卷自动推进。")
            return

        raise ValueError("unsupported automation action")

    return mutate_one_project(projects, project_id, apply)


def set_book_auto_run_state(
    projects: list[dict],
    project_id: str,
    action: str,
    options: dict | None = None,
) -> dict:
    def apply(project: dict) -> None:
        current = project.get("automation", default_automation_state())
        current_run = current.get("currentRun") or {}
        current_scope = current_run.get("scope")

        if action == "start":
            if current.get("runStatus") in {"running", "paused"}:
                raise ValueError("已有自动任务进行中，请先继续或等待完成。")
            if not project["settings"]["theme"].strip() or not project["settings"]["world"].strip():
                raise ValueError("请先补全主题和世界观，再启动自动推进。")
            normalized_options = normalize_book_auto_options(project, options)
            scope_summary = describe_book_auto_options(normalized_options)
            update_automation_state(
                project,
                "running",
                scope="book",
                step="volume_goal",
                message=f"准备自动推进全书，范围：{scope_summary}。",
                options=normalized_options,
            )
            append_record(project, "自动推进", 0, f"已启动全书自动推进，范围：{scope_summary}。")
            return

        if current_scope != "book":
            raise ValueError("当前没有全书自动任务。")

        if action == "pause":
            if current.get("runStatus") != "running":
                raise ValueError("当前自动任务不在运行中。")
            update_automation_state(
                project,
                "paused",
                scope="book",
                volume_number=current_run.get("volumeNumber"),
                step=current_run.get("step"),
                chapter_number=current_run.get("chapterNumber"),
                message="全书自动推进已暂停。",
                options=current_run.get("options"),
            )
            append_record(project, "自动推进", 0, "已暂停全书自动推进。")
            return

        if action == "resume":
            if current.get("runStatus") != "paused":
                raise ValueError("当前自动任务不在暂停状态。")
            update_automation_state(
                project,
                "running",
                scope="book",
                volume_number=current_run.get("volumeNumber"),
                step=current_run.get("step") or "volume_goal",
                chapter_number=current_run.get("chapterNumber"),
                message="继续自动推进全书。",
                options=current_run.get("options"),
            )
            append_record(project, "自动推进", 0, "已继续全书自动推进。")
            return

        raise ValueError("unsupported automation action")

    return mutate_one_project(projects, project_id, apply)


def should_continue_run(project_id: str, scope: str, volume_number: int | None = None) -> bool:
    automation = get_project_automation(project_id)
    if automation.get("runStatus") != "running":
        return False
    current_run = automation.get("currentRun") or {}
    if current_run.get("scope") != scope:
        return False
    if volume_number is None:
        return True
    return current_run.get("volumeNumber") == volume_number


def run_volume_pipeline(
    project_id: str,
    volume_number: int,
    scope: str,
    options: dict | None = None,
) -> None:
    if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
        return

    mutate_projects(
        lambda projects: mutate_one_project(
            projects,
            project_id,
            lambda project: update_automation_state(
                project,
                "running",
                scope=scope,
                volume_number=volume_number,
                step="volume_goal",
                message=f"正在推演第 {volume_number} 卷目标。",
            ),
        )
    )
    if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
        return
    mutate_projects(
        lambda projects: mutate_one_project(
            projects,
            project_id,
            lambda project: generate_volume_goal(project, volume_number),
        )
    )

    if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
        return
    mutate_projects(
        lambda projects: mutate_one_project(
            projects,
            project_id,
            lambda project: update_automation_state(
                project,
                "running",
                scope=scope,
                volume_number=volume_number,
                step="volume_chapters",
                message=f"正在规划第 {volume_number} 卷章节。",
            ),
        )
    )
    if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
        return
    mutate_projects(
        lambda projects: mutate_one_project(
            projects,
            project_id,
            lambda project: generate_volume_chapters(project, volume_number),
        )
    )

    project = get_project(project_id)
    chapter_numbers = sorted(
        chapter["number"]
        for chapter in project.get("chapters", [])
        if chapter.get("volumeNumber") == volume_number
    )
    for chapter_number in chapter_numbers:
        if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
            return
        project = get_project(project_id)
        chapter = chapter_by_number(project, chapter_number)
        if chapter["status"] == "approved":
            continue
        rerun_system_passed = (
            chapter["status"] == "system_passed"
            and not bool((options or {}).get("skipSystemPassedChapters", True))
        )
        if chapter["status"] == "system_passed" and not rerun_system_passed:
            continue

        if rerun_system_passed or not chapter["outline"].strip():
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda project: update_automation_state(
                        project,
                        "running",
                        scope=scope,
                        volume_number=volume_number,
                        step="chapter_outline",
                        chapter_number=chapter_number,
                        message=f"正在生成第 {chapter_number} 章细纲。",
                    ),
                )
            )
            if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
                return
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda project: generate_chapter_outline(project, chapter_number),
                )
            )

        project = get_project(project_id)
        chapter = chapter_by_number(project, chapter_number)
        if rerun_system_passed or not chapter["content"].strip():
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda project: update_automation_state(
                        project,
                        "running",
                        scope=scope,
                        volume_number=volume_number,
                        step="chapter_draft",
                        chapter_number=chapter_number,
                        message=f"正在生成第 {chapter_number} 章正文。",
                    ),
                )
            )
            if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
                return
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda project: generate_chapter_draft(project, chapter_number),
                )
            )

        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: update_automation_state(
                    project,
                    "running",
                    scope=scope,
                    volume_number=volume_number,
                    step="chapter_check",
                    chapter_number=chapter_number,
                    message=f"正在检查第 {chapter_number} 章。",
                ),
            )
        )
        if not should_continue_run(project_id, scope, volume_number if scope == "volume" else None):
            return

        def run_check_and_pass(project: dict) -> None:
            result = run_chapter_check(project, chapter_number)
            if not result.get("ok"):
                raise ValueError(f"第 {chapter_number} 章未通过基础检查。")
            system_pass_chapter(project, chapter_number)

        mutate_projects(
            lambda projects: mutate_one_project(projects, project_id, run_check_and_pass)
        )


def run_volume_automation(project_id: str, volume_number: int) -> None:
    try:
        run_volume_pipeline(project_id, volume_number, "volume")

        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: update_automation_state(
                    project,
                    "completed",
                    scope="volume",
                    volume_number=volume_number,
                    step="completed",
                    message=f"第 {volume_number} 卷自动推进完成，等待人工复核。",
                ),
            )
        )
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: append_record(
                    project,
                    "自动推进",
                    0,
                    f"第 {volume_number} 卷已自动推进完成，章节已进入系统审核通过状态。",
                ),
            )
        )
    except Exception as exc:
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: update_automation_state(
                    project,
                    "failed",
                    scope="volume",
                    volume_number=volume_number,
                    step="failed",
                    message=f"第 {volume_number} 卷自动推进失败。",
                    error=str(exc),
                ),
            )
        )
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: append_record(
                    project,
                    "自动推进失败",
                    0,
                    f"第 {volume_number} 卷自动推进失败：{exc}",
                ),
            )
        )
    finally:
        unregister_runner(project_id)


def run_book_automation(project_id: str) -> None:
    try:
        if not should_continue_run(project_id, "book"):
            return
        project = get_project(project_id)
        current_run = project.get("automation", {}).get("currentRun") or {}
        options = normalize_book_auto_options(project, current_run.get("options"))
        volume_numbers = [
            volume["number"]
            for volume in sorted(project.get("volumes", []), key=lambda item: item["number"])
            if options["startVolumeNumber"] <= volume["number"] <= options["endVolumeNumber"]
        ]
        if not volume_numbers:
            raise ValueError("当前项目没有可推进的卷。")

        for volume_number in volume_numbers:
            if not should_continue_run(project_id, "book"):
                return
            run_volume_pipeline(project_id, volume_number, "book", options)

        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: update_automation_state(
                    project,
                    "completed",
                    scope="book",
                    step="completed",
                    message="全书自动推进完成，等待人工复核。",
                    options=(project.get("automation", {}).get("currentRun") or {}).get("options"),
                ),
            )
        )
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: append_record(
                    project,
                    "自动推进",
                    0,
                    "全书已自动推进完成，章节已进入系统审核通过状态。",
                ),
            )
        )
    except Exception as exc:
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: update_automation_state(
                    project,
                    "failed",
                    scope="book",
                    volume_number=(project.get("automation", {}).get("currentRun") or {}).get("volumeNumber"),
                    step="failed",
                    message="全书自动推进失败。",
                    error=str(exc),
                    options=(project.get("automation", {}).get("currentRun") or {}).get("options"),
                ),
            )
        )
        mutate_projects(
            lambda projects: mutate_one_project(
                projects,
                project_id,
                lambda project: append_record(
                    project,
                    "自动推进失败",
                    0,
                    f"全书自动推进失败：{exc}",
                ),
            )
        )
    finally:
        unregister_runner(project_id)


def ensure_volume_runner(project_id: str, volume_number: int) -> None:
    if active_runner_exists(project_id):
        return
    worker = threading.Thread(
        target=run_volume_automation,
        args=(project_id, volume_number),
        daemon=True,
        name=f"volume-auto-{project_id}-{volume_number}",
    )
    register_runner(project_id, worker)
    worker.start()


def ensure_book_runner(project_id: str) -> None:
    if active_runner_exists(project_id):
        return
    worker = threading.Thread(
        target=run_book_automation,
        args=(project_id,),
        daemon=True,
        name=f"book-auto-{project_id}",
    )
    register_runner(project_id, worker)
    worker.start()


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        return

    def send_json(self, payload: dict | list, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/web/")
            self.end_headers()
            return

        if path == "/api/health":
            self.send_json(
                {
                    "ok": True,
                    "llm": llm_status_payload(),
                    "prompts": prompt_status_payload(),
                }
            )
            return

        if path == "/api/prompts":
            self.send_json(
                {
                    "prompts": normalize_prompt_config(load_prompt_config()),
                    "status": prompt_status_payload(),
                }
            )
            return

        if path == "/api/projects":
            self.send_json({"projects": list_projects()})
            return

        if path.startswith("/api/projects/"):
            parts = [p for p in path.split("/") if p]
            if len(parts) < 3:
                self.send_json({"error": "invalid route"}, HTTPStatus.NOT_FOUND)
                return
            project_id = parts[2]
            try:
                self.send_json({"project": get_project(project_id)})
            except KeyError:
                self.send_json({"error": f"project '{project_id}' not found"}, HTTPStatus.NOT_FOUND)
            return

        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/projects":
            payload = self.read_json()
            title = payload.get("title", "").strip()
            genre = payload.get("genre", "").strip()
            hook = payload.get("hook", "").strip()
            if not title or not genre or not hook:
                self.send_json(
                    {"error": "title, genre and hook are required"},
                    HTTPStatus.BAD_REQUEST,
                )
                return

            project = create_project(title=title, genre=genre, hook=hook)

            def create_mutation(projects: list[dict]):
                projects.insert(0, project)
                return project

            created = mutate_projects(create_mutation)
            self.send_json({"project": created}, HTTPStatus.CREATED)
            return

        if path.startswith("/api/projects/"):
            # Robustly extract ID and action from /api/projects/{id}/{action} or /api/projects/{id}/chapters/{num}/{action}
            parts = [p for p in path.split("/") if p]
            if len(parts) < 3:
                self.send_json({"error": "invalid route"}, HTTPStatus.NOT_FOUND)
                return

            project_id = parts[2]
            try:
                # Route: POST /api/projects/{id}/generate-full-outline
                if len(parts) == 4 and parts[3] == "generate-full-outline":
                    project = mutate_projects(
                        lambda projects: mutate_one_project(
                            projects,
                            project_id,
                            generate_full_outline,
                        )
                    )
                    self.send_json({"project": project})
                    return

                # Route: POST /api/projects/{id}/auto-run/{action}
                if len(parts) == 5 and parts[3] == "auto-run":
                    action = parts[4]
                    payload = self.read_json() if action == "start" else {}
                    project = mutate_projects(
                        lambda projects: set_book_auto_run_state(
                            projects,
                            project_id,
                            action,
                            payload,
                        )
                    )
                    if action in {"start", "resume"}:
                        ensure_book_runner(project_id)
                    self.send_json({"project": project})
                    return

                # Route: POST /api/projects/{id}/chapters/{number}/{action}
                if len(parts) == 6 and parts[3] == "chapters":
                    chapter_number = int(parts[4])
                    action = parts[5]
                    project = mutate_projects(
                        lambda projects: mutate_chapter_action(
                            projects,
                            project_id,
                            chapter_number,
                            action,
                        )
                    )
                    self.send_json({"project": project})
                    return

                # Route: POST /api/projects/{id}/volumes/{number}/{action}
                if len(parts) == 6 and parts[3] == "volumes":
                    volume_number = int(parts[4])
                    action = parts[5]
                    
                    def volume_mutation(projects: list[dict]):
                        def apply_vol(p: dict):
                            if action == "generate-goal":
                                generate_volume_goal(p, volume_number)
                            elif action == "generate-chapters":
                                generate_volume_chapters(p, volume_number)
                            else:
                                raise ValueError("unsupported volume action")
                        return mutate_one_project(projects, project_id, apply_vol)

                    project = mutate_projects(volume_mutation)
                    self.send_json({"project": project})
                    return

                # Route: POST /api/projects/{id}/volumes/{number}/auto-run/{action}
                if len(parts) == 7 and parts[3] == "volumes" and parts[5] == "auto-run":
                    volume_number = int(parts[4])
                    action = parts[6]
                    project = mutate_projects(
                        lambda projects: set_volume_auto_run_state(
                            projects,
                            project_id,
                            volume_number,
                            action,
                        )
                    )
                    if action in {"start", "resume"}:
                        ensure_volume_runner(project_id, volume_number)
                    self.send_json({"project": project})
                    return
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
                return
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except Exception as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return

        self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/prompts":
            try:
                config = save_prompt_config(self.read_json())
                self.send_json({"prompts": config, "status": prompt_status_payload()})
            except (ValueError, RuntimeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if not path.startswith("/api/projects/"):
            self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return

        parts = [p for p in path.split("/") if p]
        if len(parts) < 3:
            self.send_json({"error": "invalid route"}, HTTPStatus.NOT_FOUND)
            return
        project_id = parts[2]
        incoming = normalize_project(self.read_json())

        try:
            project = mutate_projects(
                lambda projects: replace_project(projects, project_id, incoming)
            )
            self.send_json({"project": project})
        except KeyError:
            self.send_json({"error": f"project '{project_id}' not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if not path.startswith("/api/projects/"):
            self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return

        parts = [p for p in path.split("/") if p]
        if len(parts) < 3:
            self.send_json({"error": "invalid route"}, HTTPStatus.NOT_FOUND)
            return
        project_id = parts[2]

        try:
            project = mutate_projects(
                lambda projects: delete_project(projects, project_id)
            )
            self.send_json({"deleted": True, "project": {"id": project["id"], "title": project["title"]}})
        except KeyError:
            self.send_json({"error": f"project '{project_id}' not found"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    ensure_storage()
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    try:
        server = ThreadingHTTPServer((host, port), AppHandler)
    except OSError as exc:
        if exc.errno == 48:
            print(
                f"Port {port} is already in use. "
                f"Stop the existing process or run with PORT={port + 1} python3 server.py"
            )
            raise SystemExit(1) from exc
        raise

    print(f"AI Novel Studio running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
