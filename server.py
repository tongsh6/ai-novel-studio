#!/usr/bin/env python3
"""Zero-dependency local server for the AI Novel Studio MVP."""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
from copy import deepcopy
from datetime import datetime
from html import unescape as html_unescape
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
REFERENCE_ANALYSIS_RUNNERS: dict[str, threading.Thread] = {}
KERNEL_COLLECTION_KEYS = (
    "spaces",
    "conversations",
    "objects",
    "candidate_change_sets",
    "memories",
    "reference_assets",
    "capability_features",
    "versions",
)


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def default_automation_state() -> dict:
    return {
        "runStatus": "idle",
        "currentRun": None,
    }


def default_reference_analysis_state() -> dict:
    return {
        "runStatus": "idle",
        "currentRun": None,
    }


def empty_kernel_collections() -> dict:
    return {key: [] for key in KERNEL_COLLECTION_KEYS}


def truncate_text(text: str, limit: int = 120) -> str:
    compact = re.sub(r"\s+", " ", str(text or "").strip())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def first_non_empty_line(text: str, fallback: str = "") -> str:
    for line in str(text or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return fallback


def split_keywords(*values: str) -> list[str]:
    parts: list[str] = []
    for value in values:
        for token in re.split(r"[、，,/|；;\s]+", str(value or "").strip()):
            token = token.strip()
            if token:
                parts.append(token)
    seen = set()
    deduped = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            deduped.append(part)
    return deduped[:8]


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


def default_system_settings_config() -> dict:
    return {
        "models": [],
        "taskRouting": {
            "free_ideation": {"primaryModelId": "", "fallbackModelId": ""},
            "reference_chunk_analysis": {"primaryModelId": "", "fallbackModelId": ""},
            "reference_aggregate_analysis": {"primaryModelId": "", "fallbackModelId": ""},
            "chapter_generation": {"primaryModelId": "", "fallbackModelId": ""},
            "quality_check": {"primaryModelId": "", "fallbackModelId": ""},
            "format_repair": {"primaryModelId": "", "fallbackModelId": ""},
        },
        "execution": {
            "timeoutSeconds": 300,
            "retryCount": 1,
            "chunkSize": 12000,
            "chunkOverlap": 600,
            "aggregateGroupSize": 8,
            "enableFormatRepairFallback": True,
        },
    }


def normalize_system_settings_config(config: dict) -> dict:
    default = default_system_settings_config()
    normalized = deepcopy(default)
    incoming = config if isinstance(config, dict) else {}
    raw_models = incoming.get("models", [])
    if not isinstance(raw_models, list):
        raw_models = []
    normalized["models"] = []
    for item in raw_models[:20]:
        if not isinstance(item, dict):
            continue
        usages = item.get("usageTags", [])
        if not isinstance(usages, list):
            usages = []
        normalized["models"].append(
            {
                "id": str(item.get("id", "")).strip() or f"model-{uuid.uuid4().hex[:8]}",
                "name": str(item.get("name", "")).strip(),
                "provider": str(item.get("provider", "")).strip(),
                "baseUrl": str(item.get("baseUrl", "")).strip(),
                "apiKeyRef": str(item.get("apiKeyRef", "")).strip(),
                "enabled": bool(item.get("enabled", False)),
                "usageTags": [str(tag).strip() for tag in usages if str(tag).strip()][:12],
                "notes": str(item.get("notes", "")).strip(),
            }
        )
    routing = incoming.get("taskRouting", {})
    if not isinstance(routing, dict):
        routing = {}
    for key in normalized["taskRouting"]:
        current = routing.get(key, {})
        if not isinstance(current, dict):
            current = {}
        normalized["taskRouting"][key] = {
            "primaryModelId": str(current.get("primaryModelId", "")).strip(),
            "fallbackModelId": str(current.get("fallbackModelId", "")).strip(),
        }
    execution = incoming.get("execution", {})
    if not isinstance(execution, dict):
        execution = {}
    normalized["execution"] = {
        "timeoutSeconds": int(execution.get("timeoutSeconds", default["execution"]["timeoutSeconds"])),
        "retryCount": int(execution.get("retryCount", default["execution"]["retryCount"])),
        "chunkSize": int(execution.get("chunkSize", default["execution"]["chunkSize"])),
        "chunkOverlap": int(execution.get("chunkOverlap", default["execution"]["chunkOverlap"])),
        "aggregateGroupSize": int(execution.get("aggregateGroupSize", default["execution"]["aggregateGroupSize"])),
        "enableFormatRepairFallback": bool(
            execution.get(
                "enableFormatRepairFallback",
                default["execution"]["enableFormatRepairFallback"],
            )
        ),
    }
    return normalized


def default_author_space_config() -> dict:
    return {
        "profile": {
            "penName": "",
            "displayName": "",
            "bio": "",
        },
        "contacts": {
            "email": "",
            "wechat": "",
            "phone": "",
            "other": "",
        },
        "publishing": {
            "platforms": "",
            "homepage": "",
            "writingGoals": "",
            "currentStage": "",
        },
        "styleNotes": {
            "styleTraits": "",
            "languagePreference": "",
            "pacePreference": "",
            "characterPreference": "",
            "worldPreference": "",
            "conflictPreference": "",
            "avoidance": "",
            "otherNotes": "",
        },
    }


def normalize_author_space_config(config: dict) -> dict:
    default = default_author_space_config()
    incoming = config if isinstance(config, dict) else {}
    normalized = deepcopy(default)
    for group in normalized:
        current = incoming.get(group, {})
        if not isinstance(current, dict):
            current = {}
        for key in normalized[group]:
            normalized[group][key] = str(current.get(key, normalized[group][key])).strip()
    return normalized


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


def system_settings_payload(payload: dict) -> dict:
    normalized = normalize_payload(payload)
    return {
        "systemSettings": deepcopy(normalized.get("system_settings", default_system_settings_config())),
        "systemFeatures": [
            deepcopy(item)
            for item in normalized.get("capability_features", [])
            if (item.get("originScope") or {}).get("level") == "system"
        ],
    }


def author_space_payload(payload: dict) -> dict:
    normalized = normalize_payload(payload)
    return {
        "authorSpace": deepcopy(normalized.get("author_space", default_author_space_config())),
        "authorFeatures": [
            deepcopy(item)
            for item in normalized.get("capability_features", [])
            if (item.get("originScope") or {}).get("level") == "author"
        ],
        "authorReferenceAssets": [
            deepcopy(item)
            for item in normalized.get("reference_assets", [])
            if (item.get("ownerScope") or {}).get("level") == "author"
        ],
    }


def save_system_settings_to_payload(payload: dict, config: dict) -> dict:
    payload["system_settings"] = normalize_system_settings_config(config)
    ensure_system_capability_features(payload)
    return system_settings_payload(payload)


def save_author_space_to_payload(payload: dict, config: dict) -> dict:
    payload["author_space"] = normalize_author_space_config(config)
    ensure_system_capability_features(payload)
    return author_space_payload(payload)


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
        "timeout": settings["timeout"],
        "message": settings["message"],
    }


def sanitize_json_like_text(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False

    for char in str(text or ""):
        if in_string:
            if escaped:
                result.append(char)
                escaped = False
                continue
            if char == "\\":
                result.append(char)
                escaped = True
                continue
            if char == '"':
                result.append(char)
                in_string = False
                continue
            if char == "\n":
                result.append("\\n")
                continue
            if char == "\r":
                result.append("\\r")
                continue
            if char == "\t":
                result.append("\\t")
                continue
            result.append(char)
            continue

        result.append(char)
        if char == '"':
            in_string = True

    return "".join(result)


def repair_common_json_issues(text: str) -> str:
    repaired = sanitize_json_like_text(text)
    previous = None
    while repaired != previous:
        previous = repaired
        repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
        repaired = re.sub(r'([}\]"])\s*(?=(?:\{|\[|"))', r"\1, ", repaired)
        repaired = re.sub(r"((?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))\s*(?=(?:\{|\[|\"))", r"\1, ", repaired)
    return repaired


def permissive_json_parse(text: str):
    source = str(text or "")
    length = len(source)
    index = 0

    def skip_ws() -> None:
        nonlocal index
        while index < length and source[index] in " \t\r\n":
            index += 1

    def parse_string() -> str:
        nonlocal index
        if index >= length or source[index] != '"':
            raise ValueError(f'expected \'"\' at position {index}')
        index += 1
        result: list[str] = []
        while index < length:
            char = source[index]
            if char == '"':
                index += 1
                return "".join(result)
            if char == "\\":
                index += 1
                if index >= length:
                    break
                escape = source[index]
                if escape == "n":
                    result.append("\n")
                elif escape == "r":
                    result.append("\r")
                elif escape == "t":
                    result.append("\t")
                elif escape == "b":
                    result.append("\b")
                elif escape == "f":
                    result.append("\f")
                elif escape == "u" and index + 4 < length:
                    hex_code = source[index + 1 : index + 5]
                    try:
                        result.append(chr(int(hex_code, 16)))
                        index += 4
                    except ValueError:
                        result.append("u" + hex_code)
                        index += 4
                else:
                    result.append(escape)
                index += 1
                continue
            result.append(char)
            index += 1
        raise ValueError("unterminated string")

    def parse_number():
        nonlocal index
        match = re.match(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", source[index:])
        if not match:
            raise ValueError(f"invalid number at position {index}")
        token = match.group(0)
        index += len(token)
        if any(char in token for char in ".eE"):
            return float(token)
        return int(token)

    def parse_literal(literal: str, value):
        nonlocal index
        if source.startswith(literal, index):
            index += len(literal)
            return value
        raise ValueError(f"invalid literal at position {index}")

    def parse_array():
        nonlocal index
        if source[index] != "[":
            raise ValueError(f"expected '[' at position {index}")
        index += 1
        items = []
        while True:
            skip_ws()
            while index < length and source[index] == ",":
                index += 1
                skip_ws()
            if index >= length:
                raise ValueError("unterminated array")
            if source[index] == "]":
                index += 1
                return items
            items.append(parse_value())
            skip_ws()
            if index < length and source[index] == ",":
                index += 1

    def parse_object():
        nonlocal index
        if source[index] != "{":
            raise ValueError(f"expected '{{' at position {index}")
        index += 1
        obj = {}
        while True:
            skip_ws()
            while index < length and source[index] == ",":
                index += 1
                skip_ws()
            if index >= length:
                raise ValueError("unterminated object")
            if source[index] == "}":
                index += 1
                return obj
            key = parse_string()
            skip_ws()
            if index >= length or source[index] != ":":
                raise ValueError(f"expected ':' after key at position {index}")
            index += 1
            skip_ws()
            obj[key] = parse_value()
            skip_ws()
            if index < length and source[index] == ",":
                index += 1

    def parse_value():
        nonlocal index
        skip_ws()
        if index >= length:
            raise ValueError("unexpected end of input")
        char = source[index]
        if char == '"':
            return parse_string()
        if char == "{":
            return parse_object()
        if char == "[":
            return parse_array()
        if char == "t":
            return parse_literal("true", True)
        if char == "f":
            return parse_literal("false", False)
        if char == "n":
            return parse_literal("null", None)
        if char in "-0123456789":
            return parse_number()
        raise ValueError(f"unexpected token at position {index}")

    parsed = parse_value()
    skip_ws()
    if index < length:
        raise ValueError(f"unexpected trailing content at position {index}")
    return parsed


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
        repaired = repair_common_json_issues(cleaned)
        if repaired != cleaned:
            try:
                parsed = json.loads(repaired)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        try:
            parsed = permissive_json_parse(cleaned)
            if isinstance(parsed, dict):
                return parsed
        except ValueError:
            pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        print(f"[extract_json_block] no JSON object found in response ({len(text)} chars):")
        print(text[:500])
        raise ValueError("model did not return a JSON object")
    candidate = cleaned[start : end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        repaired = repair_common_json_issues(candidate)
        if repaired != candidate:
            try:
                return json.loads(repaired)
            except json.JSONDecodeError:
                pass
        try:
            parsed = permissive_json_parse(candidate)
            if isinstance(parsed, dict):
                return parsed
        except ValueError:
            pass
        print(f"[extract_json_block] JSON parse failed: {exc}")
        print(f"[extract_json_block] extracted slice ({start}..{end+1}):")
        print(cleaned[start : start + 300])
        raise


def chat_completion(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.7,
    timeout_seconds: int | None = None,
) -> str:
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

    request_timeout = settings["timeout"] if timeout_seconds is None else max(5, int(timeout_seconds))

    try:
        with urllib_request.urlopen(request, timeout=request_timeout) as response:
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


def create_space_for_project(project: dict) -> dict:
    space_id = str(project.get("spaceId") or f"space-{project['id']}")
    return {
        "id": space_id,
        "projectId": project["id"],
        "title": project.get("title", "未命名新书"),
        "status": "ideation",
        "sourceMode": "original",
        "activeConversationId": None,
        "formalObjectIds": [],
        "candidateChangeSetIds": [],
        "memoryEntryIds": [],
        "referenceAssetIds": [],
        "enabledFeatureIds": [],
        "inheritedAuthorFeatureIds": [],
        "createdAt": now(),
        "updatedAt": now(),
    }


def normalize_space(space: dict) -> dict:
    normalized = deepcopy(space) if isinstance(space, dict) else {}
    normalized.setdefault("id", f"space-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("projectId", "")
    normalized.setdefault("title", "未命名新书")
    normalized.setdefault("status", "ideation")
    normalized.setdefault("sourceMode", "original")
    normalized.setdefault("activeConversationId", None)
    normalized.setdefault("formalObjectIds", [])
    normalized.setdefault("candidateChangeSetIds", [])
    normalized.setdefault("memoryEntryIds", [])
    normalized.setdefault("referenceAssetIds", [])
    normalized.setdefault("enabledFeatureIds", [])
    normalized.setdefault("inheritedAuthorFeatureIds", [])
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def normalize_conversation_message(message: dict) -> dict:
    normalized = deepcopy(message) if isinstance(message, dict) else {}
    normalized.setdefault("id", f"msg-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("role", "assistant")
    normalized.setdefault("content", "")
    normalized.setdefault("meta", {})
    normalized.setdefault("createdAt", now())
    return normalized


def normalize_conversation(conversation: dict) -> dict:
    normalized = deepcopy(conversation) if isinstance(conversation, dict) else {}
    normalized.setdefault("id", f"conv-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("spaceId", "")
    normalized.setdefault("title", "自由构思对话")
    normalized.setdefault("status", "active")
    source_messages = normalized.get("messages", [])
    if not isinstance(source_messages, list):
        source_messages = []
    normalized["messages"] = [
        normalize_conversation_message(message) for message in source_messages
    ]
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def normalize_story_object(obj: dict) -> dict:
    normalized = deepcopy(obj) if isinstance(obj, dict) else {}
    normalized.setdefault("id", f"obj-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("spaceId", "")
    normalized.setdefault("type", "novel_metadata")
    normalized.setdefault("subtype", "generic")
    normalized.setdefault("title", "未命名对象")
    normalized.setdefault("content", {"summary": ""})
    normalized.setdefault("status", "candidate")
    normalized.setdefault("source", {"kind": "manual", "refId": ""})
    normalized.setdefault(
        "effectiveScope",
        {
            "level": "novel",
            "fromVolume": None,
            "fromChapter": None,
        },
    )
    normalized.setdefault("versionRef", None)
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def normalize_candidate_change_set(change_set: dict) -> dict:
    normalized = deepcopy(change_set) if isinstance(change_set, dict) else {}
    normalized.setdefault("id", f"ccs-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("spaceId", "")
    normalized.setdefault("title", "未命名候选变更")
    normalized.setdefault("origin", {"conversationId": "", "trigger": "manual"})
    normalized.setdefault("objectIds", [])
    normalized.setdefault("status", "open")
    normalized.setdefault("visibility", "soft_visible")
    normalized.setdefault(
        "releasePlan",
        {
            "mode": "future_only",
            "volumeNumber": None,
            "chapterNumber": None,
        },
    )
    normalized.setdefault("notes", "")
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def normalize_memory_entry(memory: dict) -> dict:
    normalized = deepcopy(memory) if isinstance(memory, dict) else {}
    normalized.setdefault("id", f"mem-{uuid.uuid4().hex[:8]}")
    normalized.setdefault(
        "scope",
        {
            "level": "novel",
            "spaceId": "",
            "volumeNumber": None,
            "chapterNumber": None,
        },
    )
    normalized.setdefault("type", "fact")
    normalized.setdefault("priority", 50)
    normalized.setdefault("summary", "")
    normalized.setdefault("linkedObjectIds", [])
    normalized.setdefault("linkedVersionRef", None)
    normalized.setdefault("status", "active")
    normalized.setdefault("createdAt", now())
    return normalized


def normalize_reference_asset(asset: dict) -> dict:
    normalized = deepcopy(asset) if isinstance(asset, dict) else {}
    normalized.setdefault("id", f"ref-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("mode", "independent_analysis")
    normalized.setdefault("ownerScope", {"level": "author", "spaceId": None})
    normalized.setdefault(
        "sourceWork",
        {
            "title": "",
            "role": "parallel",
            "sourceType": "local_file",
            "sourceLabel": "",
        },
    )
    normalized.setdefault("summary", "")
    raw_analysis = normalized.get("rawAnalysis", {})
    if not isinstance(raw_analysis, dict):
        raw_analysis = {}
    normalized["rawAnalysis"] = {
        "format": str(raw_analysis.get("format", "text")),
        "content": str(raw_analysis.get("content", "")),
    }
    draft_analysis = normalized.get("draftAnalysis", {})
    if not isinstance(draft_analysis, dict):
        draft_analysis = {}
    draft_insights = draft_analysis.get("insights", [])
    if not isinstance(draft_insights, list):
        draft_insights = []
    draft_reusable_objects = draft_analysis.get("reusableObjects", [])
    if not isinstance(draft_reusable_objects, list):
        draft_reusable_objects = []
    normalized["draftAnalysis"] = {
        "summary": str(draft_analysis.get("summary", "")),
        "insights": [
            {
                "title": str(item.get("title", "未命名初步结论")),
                "summary": str(item.get("summary", "")),
            }
            for item in draft_insights
            if isinstance(item, dict)
        ],
        "reusableObjects": draft_reusable_objects,
    }
    insights = normalized.get("insights", [])
    if not isinstance(insights, list):
        insights = []
    normalized["insights"] = [
        {
            "title": str(item.get("title", "未命名结论")),
            "summary": str(item.get("summary", "")),
        }
        for item in insights
        if isinstance(item, dict)
    ]
    reusable_objects = normalized.get("reusableObjects", [])
    if not isinstance(reusable_objects, list):
        reusable_objects = []
    normalized["reusableObjects"] = reusable_objects
    normalized.setdefault("outputs", {"insightIds": [], "reusableObjectIds": []})
    normalized.setdefault("upgradeStatus", "local_only")
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def normalize_capability_feature(feature: dict) -> dict:
    normalized = deepcopy(feature) if isinstance(feature, dict) else {}
    normalized.setdefault("id", f"feat-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("name", "unnamed_feature")
    normalized.setdefault("featureType", "metadata_extension")
    normalized.setdefault("description", "")
    normalized.setdefault("originScope", {"level": "novel", "spaceId": ""})
    normalized.setdefault("status", "local_trial")
    normalized.setdefault("suggestedBy", "ai")
    normalized.setdefault("activationMode", "suggested_not_default")
    normalized.setdefault("sourceRef", {"kind": "manual", "refId": ""})
    normalized.setdefault("promotedFeatureId", None)
    normalized.setdefault("createdAt", now())
    normalized.setdefault("updatedAt", now())
    return normalized


def ensure_system_capability_features(payload: dict) -> None:
    for item in payload["capability_features"]:
        origin_scope = item.get("originScope") or {}
        if origin_scope.get("level") == "system" and item.get("name") == "系统设定":
            item["name"] = "系统设置"
            item["description"] = "管理全局模型接入、任务路由、长文本处理参数和执行策略。"

    system_features = [
        {
            "name": "系统设置",
            "featureType": "system_capability",
            "description": "管理全局模型接入、任务路由、长文本处理参数和执行策略。",
            "originScope": {"level": "system", "spaceId": None},
            "status": "system_active",
            "suggestedBy": "system",
            "activationMode": "always_on",
            "sourceRef": {"kind": "system_seed", "refId": "system-settings"},
        },
        {
            "name": "作者空间",
            "featureType": "system_capability",
            "description": "管理作者层共享资产、作者通用参考资产、作者特性库和跨书复用能力。",
            "originScope": {"level": "system", "spaceId": None},
            "status": "system_active",
            "suggestedBy": "system",
            "activationMode": "always_on",
            "sourceRef": {"kind": "system_seed", "refId": "author-space"},
        },
    ]
    for feature in system_features:
        exists = next(
            (
                item
                for item in payload["capability_features"]
                if item.get("name") == feature["name"]
                and (item.get("originScope") or {}).get("level") == "system"
            ),
            None,
        )
        if exists is None:
            payload["capability_features"].append(normalize_capability_feature(feature))


def normalize_version(version: dict) -> dict:
    normalized = deepcopy(version) if isinstance(version, dict) else {}
    normalized.setdefault("id", f"ver-{uuid.uuid4().hex[:8]}")
    normalized.setdefault("spaceId", "")
    normalized.setdefault("kind", "formal_snapshot")
    normalized.setdefault("summary", "")
    normalized.setdefault("sourceChangeSetIds", [])
    normalized.setdefault("createdAt", now())
    return normalized


def find_item(items: list[dict], item_id: str, label: str) -> dict:
    for item in items:
        if str(item.get("id")) == str(item_id):
            return item
    raise KeyError(f"{label} not found")


def ensure_project_space(payload: dict, project: dict) -> None:
    if not str(project.get("spaceId") or "").strip():
        project["spaceId"] = f"space-{project['id']}"
    space_id = project["spaceId"]
    existing = next((space for space in payload["spaces"] if space.get("id") == space_id), None)
    if existing:
        if not existing.get("projectId"):
            existing["projectId"] = project["id"]
        if not existing.get("title"):
            existing["title"] = project.get("title", "未命名新书")
        return

    payload["spaces"].append(create_space_for_project(project))


def refresh_space_indexes(payload: dict, space_id: str) -> None:
    space = find_item(payload["spaces"], space_id, "space")
    space["formalObjectIds"] = [
        obj["id"]
        for obj in payload["objects"]
        if obj.get("spaceId") == space_id and obj.get("status") == "formal"
    ]
    space["candidateChangeSetIds"] = [
        item["id"]
        for item in payload["candidate_change_sets"]
        if item.get("spaceId") == space_id
    ]
    space["memoryEntryIds"] = [
        item["id"]
        for item in payload["memories"]
        if (item.get("scope") or {}).get("spaceId") == space_id
    ]
    space["referenceAssetIds"] = [
        item["id"]
        for item in payload["reference_assets"]
        if (item.get("ownerScope") or {}).get("spaceId") == space_id
    ]
    space["enabledFeatureIds"] = [
        item["id"]
        for item in payload["capability_features"]
        if (item.get("originScope") or {}).get("spaceId") == space_id
    ]
    formal_count = len(space["formalObjectIds"])
    candidate_count = sum(
        1
        for item in payload["candidate_change_sets"]
        if item.get("spaceId") == space_id and item.get("status") in {"open", "partially_accepted"}
    )
    if formal_count == 0 and candidate_count == 0:
        space["status"] = "ideation"
    elif formal_count == 0:
        space["status"] = "structuring"
    elif candidate_count > 0:
        space["status"] = "stabilizing"
    else:
        space["status"] = "writing_ready"
    space["updatedAt"] = now()


def normalize_payload(payload: dict) -> dict:
    normalized = {
        "projects": [normalize_project(project) for project in payload.get("projects", [])],
        "system_settings": normalize_system_settings_config(payload.get("system_settings", {})),
        "author_space": normalize_author_space_config(payload.get("author_space", {})),
    }
    for key in KERNEL_COLLECTION_KEYS:
        source_items = payload.get(key, [])
        if not isinstance(source_items, list):
            source_items = []
        if key == "spaces":
            normalized[key] = [normalize_space(item) for item in source_items]
        elif key == "conversations":
            normalized[key] = [normalize_conversation(item) for item in source_items]
        elif key == "objects":
            normalized[key] = [normalize_story_object(item) for item in source_items]
        elif key == "candidate_change_sets":
            normalized[key] = [normalize_candidate_change_set(item) for item in source_items]
        elif key == "memories":
            normalized[key] = [normalize_memory_entry(item) for item in source_items]
        elif key == "reference_assets":
            normalized[key] = [normalize_reference_asset(item) for item in source_items]
        elif key == "capability_features":
            normalized[key] = [normalize_capability_feature(item) for item in source_items]
        elif key == "versions":
            normalized[key] = [normalize_version(item) for item in source_items]

    ensure_system_capability_features(normalized)
    for project in normalized["projects"]:
        ensure_project_space(normalized, project)
    for space in normalized["spaces"]:
        refresh_space_indexes(normalized, space["id"])
    return normalized


def build_kernel_bundle(payload: dict, project: dict) -> dict:
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    active_conversation = None
    if space.get("activeConversationId"):
        active_conversation = next(
            (
                item
                for item in payload["conversations"]
                if item.get("id") == space.get("activeConversationId")
                and item.get("spaceId") == space["id"]
            ),
            None,
        )
    if active_conversation is None:
        active_conversation = next(
            (
                item
                for item in payload["conversations"]
                if item.get("spaceId") == space["id"] and item.get("status") == "active"
            ),
            None,
        )
    objects = [obj for obj in payload["objects"] if obj.get("spaceId") == space["id"]]
    change_sets = [
        item for item in payload["candidate_change_sets"] if item.get("spaceId") == space["id"]
    ]
    memories = [
        item for item in payload["memories"] if (item.get("scope") or {}).get("spaceId") == space["id"]
    ]
    references = [
        item
        for item in payload["reference_assets"]
        if (item.get("ownerScope") or {}).get("spaceId") == space["id"]
    ]
    author_references = [
        item
        for item in payload["reference_assets"]
        if (item.get("ownerScope") or {}).get("level") == "author"
    ]
    features = [
        item
        for item in payload["capability_features"]
        if (item.get("originScope") or {}).get("spaceId") == space["id"]
    ]
    author_features = [
        item
        for item in payload["capability_features"]
        if (item.get("originScope") or {}).get("level") == "author"
    ]
    inherited_author_feature_ids = set(space.get("inheritedAuthorFeatureIds") or [])
    enabled_author_features = [
        item for item in author_features if item.get("id") in inherited_author_feature_ids
    ]
    suggested_features = suggested_author_features(payload, project, space)
    versions = [item for item in payload["versions"] if item.get("spaceId") == space["id"]]

    return {
        "space": deepcopy(space),
        "activeConversation": deepcopy(active_conversation) if active_conversation else None,
        "formalObjects": [deepcopy(obj) for obj in objects if obj.get("status") == "formal"],
        "candidateObjects": [deepcopy(obj) for obj in objects if obj.get("status") == "candidate"],
        "candidateChangeSets": [deepcopy(item) for item in change_sets],
        "memories": [deepcopy(item) for item in memories],
        "referenceAssets": [deepcopy(item) for item in references],
        "authorReferenceAssets": [deepcopy(item) for item in author_references],
        "capabilityFeatures": [deepcopy(item) for item in features],
        "authorCapabilityFeatures": [deepcopy(item) for item in author_features],
        "enabledAuthorCapabilityFeatures": [deepcopy(item) for item in enabled_author_features],
        "suggestedAuthorCapabilityFeatures": suggested_features,
        "versions": [deepcopy(item) for item in versions],
        "summary": {
            "formalObjectCount": len(space.get("formalObjectIds", [])),
            "candidateChangeSetCount": sum(
                1 for item in change_sets if item.get("status") in {"open", "partially_accepted"}
            ),
            "memoryCount": len(memories),
            "versionCount": len(versions),
            "referenceAssetCount": len(references),
            "authorReferenceAssetCount": len(author_references),
            "featureCount": len(features),
            "authorFeatureCount": len(author_features),
            "enabledAuthorFeatureCount": len(enabled_author_features),
            "suggestedAuthorFeatureCount": len(suggested_features),
        },
    }


def attach_kernel_summary(project: dict, payload: dict) -> dict:
    hydrated = deepcopy(project)
    bundle = build_kernel_bundle(payload, project)
    hydrated["kernelSummary"] = bundle["summary"]
    return hydrated


def attach_kernel_bundle(project: dict, payload: dict) -> dict:
    hydrated = deepcopy(project)
    hydrated["kernel"] = build_kernel_bundle(payload, project)
    hydrated["kernelSummary"] = hydrated["kernel"]["summary"]
    return hydrated


def release_scope_from_plan(plan: dict) -> dict:
    mode = str((plan or {}).get("mode") or "future_only")
    volume_number = plan.get("volumeNumber")
    chapter_number = plan.get("chapterNumber")
    if mode == "from_volume":
        return {"level": "volume", "fromVolume": volume_number, "fromChapter": None}
    if mode == "from_chapter":
        return {"level": "chapter", "fromVolume": volume_number, "fromChapter": chapter_number}
    if mode == "global_redefine":
        return {"level": "global", "fromVolume": None, "fromChapter": None}
    return {"level": "future", "fromVolume": None, "fromChapter": None}


def fallback_kernel_blueprints(project: dict, message: str) -> list[dict]:
    cleaned = str(message or "").strip()
    first_line = first_non_empty_line(cleaned, project.get("hook", "") or project.get("title", ""))
    tags = split_keywords(project.get("genre", ""), project.get("audience", ""))
    objects = [
        {
            "type": "novel_metadata",
            "subtype": "hook",
            "title": "核心卖点候选",
            "content": {
                "summary": truncate_text(first_line or project.get("hook", project.get("title", "未命名新书")), 90),
                "tags": tags[:5],
                "confidence": "medium",
            },
        },
        {
            "type": "novel_metadata",
            "subtype": "theme",
            "title": "主题表达候选",
            "content": {
                "summary": truncate_text(cleaned or project.get("hook", ""), 140),
                "tags": ["构思阶段", "待确认"],
                "confidence": "low",
            },
        },
        {
            "type": "worldbuilding",
            "subtype": "world_seed",
            "title": "世界观种子候选",
            "content": {
                "summary": truncate_text(
                    cleaned or project.get("settings", {}).get("world", "") or project.get("genre", ""),
                    160,
                ),
                "tags": split_keywords(project.get("genre", ""), "世界观", "设定"),
                "confidence": "low",
            },
        },
    ]
    if any(keyword in cleaned for keyword in ["主角", "男主", "女主", "人物", "角色"]):
        objects.append(
            {
                "type": "character_relation",
                "subtype": "character_seed",
                "title": "角色关系候选",
                "content": {
                    "summary": truncate_text(cleaned, 140),
                    "tags": ["角色", "关系"],
                    "confidence": "low",
                },
            }
        )
    else:
        objects.append(
            {
                "type": "story_direction",
                "subtype": "direction_seed",
                "title": "故事方向候选",
                "content": {
                    "summary": truncate_text(cleaned, 140),
                    "tags": ["故事方向", "待推演"],
                    "confidence": "low",
                },
            }
        )
    return objects[:4]


def llm_kernel_blueprints(project: dict, message: str) -> list[dict]:
    system_prompt = (
        "你是小说构思结构化助手。请把用户的模糊构思提炼为少量结构化对象。"
        "输出必须是一个 JSON 对象，字段为 objects。"
        "objects 是数组，每项必须包含 type、subtype、title、content。"
        "type 只允许 novel_metadata、worldbuilding、character_relation、story_direction。"
        "content 至少包含 summary，可选 tags、confidence。"
        "优先提炼小说元信息和世界观，不要输出 markdown。"
    )
    user_prompt = (
        "请根据以下小说项目信息和本轮自由构思，提炼 3 到 6 个候选结构化对象。\n\n"
        f"项目标题：{project.get('title', '未命名')}\n"
        f"项目题材：{project.get('genre', '待补充')}\n"
        f"已有卖点：{project.get('hook', '待补充')}\n"
        f"本轮自由构思：{message}\n\n"
        "输出格式示例：\n"
        "{\n"
        '  "objects": [\n'
        '    {\n'
        '      "type": "novel_metadata",\n'
        '      "subtype": "hook",\n'
        '      "title": "核心卖点候选",\n'
        '      "content": {\n'
        '        "summary": "一句精炼总结",\n'
        '        "tags": ["题材", "卖点"],\n'
        '        "confidence": "medium"\n'
        "      }\n"
        "    }\n"
        "  ]\n"
        "}"
    )
    raw = chat_completion(system_prompt, user_prompt, temperature=0.4)
    payload = extract_json_block(raw)
    objects = payload.get("objects", [])
    if not isinstance(objects, list) or not objects:
        raise ValueError("kernel ideation response missing objects")
    return objects


def extract_kernel_blueprints(project: dict, message: str) -> list[dict]:
    try:
        if llm_settings().get("configured"):
            return llm_kernel_blueprints(project, message)
    except Exception as exc:
        print(f"[kernel ideation] fallback to heuristic extraction: {exc}")
    return fallback_kernel_blueprints(project, message)


def normalize_reference_source(
    source_type: str,
    source_path: str,
    source_text: str,
    source_label: str,
    source_url: str,
    source_title: str,
) -> dict:
    normalized_type = source_type if source_type in {"local_file", "url"} else "local_file"
    path = str(source_path or "").strip()
    text = str(source_text or "")
    label = str(source_label or "").strip()
    url = str(source_url or "").strip()
    title = str(source_title or "").strip()
    if normalized_type == "local_file":
        if not path and not text.strip():
            raise ValueError("sourcePath or sourceText is required when sourceType=local_file")
        return {
            "sourceType": normalized_type,
            "title": title or label or (Path(path).name if path else "未命名本地文件"),
            "sourceLabel": label or path,
            "sourcePath": path,
            "sourceText": text,
            "sourceUrl": "",
        }
    if not url:
        raise ValueError("sourceUrl is required when sourceType=url")
    return {
        "sourceType": normalized_type,
        "title": title or url,
        "sourceLabel": url,
        "sourcePath": "",
        "sourceText": "",
        "sourceUrl": url,
    }


def strip_html_to_text(html: str) -> str:
    cleaned = re.sub(r"(?is)<script.*?>.*?</script>", " ", str(html or ""))
    cleaned = re.sub(r"(?is)<style.*?>.*?</style>", " ", cleaned)
    cleaned = re.sub(r"(?s)<[^>]+>", " ", cleaned)
    return compact_text(html_unescape(cleaned))


def load_reference_source_text(source: dict) -> str:
    source_type = source.get("sourceType")
    if source_type == "local_file":
        direct_text = str(source.get("sourceText", "") or "")
        if direct_text.strip():
            return direct_text
        source_path = Path(str(source.get("sourcePath", "")).strip()).expanduser()
        if not source_path.exists() or not source_path.is_file():
            raise ValueError(f"本地文件不存在：{source_path}")
        try:
            return source_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                return source_path.read_text(encoding="gb18030")
            except UnicodeDecodeError as exc:
                raise ValueError(f"本地文件编码无法识别：{source_path}") from exc
    url = str(source.get("sourceUrl", "")).strip()
    if not url:
        raise ValueError("参考网址为空。")
    req = urllib_request.Request(
        url,
        headers={"User-Agent": "AI-Novel-Studio/0.1"},
    )
    try:
        with urllib_request.urlopen(req, timeout=12) as response:
            body = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
    except urllib_error.URLError as exc:
        raise ValueError(f"无法读取参考网址：{exc}") from exc
    text = body.decode(charset, errors="ignore")
    extracted = strip_html_to_text(text)
    if not extracted:
        raise ValueError("参考网址读取成功，但未提取到可用正文。")
    return extracted


def reference_excerpt(source_text: str, limit: int = 12000) -> str:
    cleaned = compact_text(source_text)
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit]


def split_reference_text_into_chunks(
    source_text: str,
    target_size: int = 12000,
    overlap: int = 600,
) -> list[dict]:
    text = str(source_text or "")
    if not text:
        return [{"index": 1, "start": 0, "end": 0, "text": ""}]

    normalized_target = max(2000, int(target_size or 12000))
    normalized_overlap = max(0, min(int(overlap or 0), normalized_target // 3))
    chunks: list[dict] = []
    start = 0
    total_length = len(text)
    chunk_index = 1

    while start < total_length:
        end = min(start + normalized_target, total_length)
        if end < total_length:
            split_at = text.rfind("\n", start + normalized_target // 2, end)
            if split_at != -1 and split_at > start:
                end = split_at + 1
        if end <= start:
            end = min(start + normalized_target, total_length)
        chunk_text = text[start:end]
        chunks.append(
            {
                "index": chunk_index,
                "start": start,
                "end": end,
                "text": chunk_text,
            }
        )
        if end >= total_length:
            break
        start = max(end - normalized_overlap, start + 1)
        chunk_index += 1

    return chunks


def reference_analysis_execution(payload: dict | None = None) -> dict:
    root = payload if isinstance(payload, dict) else {}
    system_settings = normalize_system_settings_config(root.get("system_settings", {}))
    execution = system_settings.get("execution", {})
    chunk_size = max(4000, min(int(execution.get("chunkSize", 12000) or 12000), 24000))
    chunk_overlap = max(0, min(int(execution.get("chunkOverlap", 600) or 600), chunk_size // 3))
    aggregate_group_size = max(4, min(int(execution.get("aggregateGroupSize", 8) or 8), 12))
    timeout_seconds = max(20, min(int(execution.get("timeoutSeconds", 300) or 300), 60))
    raw_chunk_budget = int(os.getenv("AI_NOVEL_REFERENCE_MAX_CHUNKS", "0") or 0)
    max_chunk_budget = 0 if raw_chunk_budget <= 0 else max(3, min(raw_chunk_budget, 2000))
    return {
        "chunkSize": chunk_size,
        "chunkOverlap": chunk_overlap,
        "aggregateGroupSize": aggregate_group_size,
        "timeoutSeconds": timeout_seconds,
        "maxChunkBudget": max_chunk_budget,
    }


def reference_job_dir(project_id: str, job_id: str) -> Path:
    return DATA_DIR / "reference_jobs" / str(project_id) / str(job_id)


def persist_reference_job_source(project_id: str, job_id: str, source: dict) -> dict:
    normalized = deepcopy(source) if isinstance(source, dict) else {}
    if normalized.get("sourceType") != "local_file":
        normalized["sourceText"] = ""
        return normalized
    direct_text = str(normalized.get("sourceText", "") or "")
    if not direct_text.strip():
        normalized["sourceText"] = ""
        return normalized
    job_dir = reference_job_dir(project_id, job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    label = str(normalized.get("sourceLabel", "") or normalized.get("title", "") or "source.txt")
    suffix = Path(label).suffix or ".txt"
    temp_path = job_dir / f"source{suffix}"
    temp_path.write_text(direct_text, encoding="utf-8")
    normalized["sourcePath"] = str(temp_path.resolve())
    normalized["sourceText"] = ""
    return normalized


def select_reference_chunks(chunks: list[dict], max_chunks: int) -> tuple[list[dict], dict]:
    total_chunks = len(chunks)
    if int(max_chunks or 0) <= 0:
        return list(chunks), {
            "totalChunks": total_chunks,
            "selectedChunks": total_chunks,
            "sampled": False,
        }
    normalized_budget = max(1, int(max_chunks or total_chunks or 1))
    if total_chunks <= normalized_budget:
        return list(chunks), {
            "totalChunks": total_chunks,
            "selectedChunks": total_chunks,
            "sampled": False,
        }

    selected_indices = {
        round(index * (total_chunks - 1) / max(normalized_budget - 1, 1))
        for index in range(normalized_budget)
    }
    selected = [chunks[index] for index in sorted(selected_indices)]
    return selected, {
        "totalChunks": total_chunks,
        "selectedChunks": len(selected),
        "sampled": True,
    }


def serialize_reference_chunk_result(chunk_result: dict) -> str:
    insights = chunk_result.get("draftInsights", [])
    reusable_signals = chunk_result.get("reusableSignals", [])
    insight_lines = []
    for item in insights[:4]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "未命名观察")).strip() or "未命名观察"
        summary = truncate_text(str(item.get("summary", "")).strip(), 180)
        insight_lines.append(f"- {title}：{summary}")
    signal_lines = []
    for signal in reusable_signals[:4]:
        signal_text = truncate_text(str(signal or "").strip(), 120)
        if signal_text:
            signal_lines.append(f"- {signal_text}")
    return (
        f"片段 {chunk_result.get('index', '?')}（字符 {chunk_result.get('start', 0)}..{chunk_result.get('end', 0)}）\n"
        f"摘要：{truncate_text(str(chunk_result.get('summary', '')).strip(), 200)}\n"
        f"观察：\n{chr(10).join(insight_lines) if insight_lines else '- 无'}\n"
        f"可复用信号：\n{chr(10).join(signal_lines) if signal_lines else '- 无'}"
    )


def protocol_sections(text: str, allowed_markers: set[str]) -> list[tuple[str, str]]:
    source = str(text or "").strip()
    pattern = re.compile(r"(?m)^\[([A-Z_]+)\]\s*$")
    matches = [match for match in pattern.finditer(source) if match.group(1) in allowed_markers]
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        marker = match.group(1)
        body = source[start:end].strip()
        sections.append((marker, body))
    return sections


def parse_protocol_fields(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    current_key = ""
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer, current_key
        if current_key:
            fields[current_key] = "\n".join(buffer).strip()
        buffer = []

    for raw_line in str(body or "").splitlines():
        line = raw_line.rstrip()
        match = re.match(r"^([A-Z_]+):\s*(.*)$", line)
        if match:
            flush()
            current_key = match.group(1)
            buffer = [match.group(2)]
            continue
        buffer.append(line)
    flush()
    return fields


def parse_reference_chunk_protocol(text: str) -> dict:
    sections = protocol_sections(text, {"SUMMARY", "INSIGHT", "SIGNAL"})
    summary = ""
    insights = []
    signals = []
    for marker, body in sections:
        if marker == "SUMMARY" and not summary:
            summary = body.strip()
            continue
        if marker == "INSIGHT":
            fields = parse_protocol_fields(body)
            title = str(fields.get("TITLE", "")).strip()
            insight_summary = str(fields.get("SUMMARY", "")).strip()
            if title and insight_summary:
                insights.append({"title": title, "summary": insight_summary})
            continue
        if marker == "SIGNAL":
            signal_text = body.strip()
            if signal_text:
                signals.append(signal_text)
    if not insights:
        raise ValueError("reference chunk protocol missing insights")
    return {
        "summary": summary,
        "draftInsights": insights[:4],
        "reusableSignals": signals[:4],
    }


def parse_reference_aggregate_protocol(text: str) -> dict:
    sections = protocol_sections(text, {"SUMMARY", "INSIGHT", "OBJECT"})
    summary = ""
    insights = []
    reusable_objects = []
    allowed_types = {"novel_metadata", "worldbuilding", "character_relation", "story_direction"}
    for marker, body in sections:
        if marker == "SUMMARY" and not summary:
            summary = body.strip()
            continue
        if marker == "INSIGHT":
            fields = parse_protocol_fields(body)
            title = str(fields.get("TITLE", "")).strip()
            insight_summary = str(fields.get("SUMMARY", "")).strip()
            if title and insight_summary:
                insights.append({"title": title, "summary": insight_summary})
            continue
        if marker == "OBJECT":
            fields = parse_protocol_fields(body)
            object_type = str(fields.get("TYPE", "")).strip()
            subtype = str(fields.get("SUBTYPE", "")).strip()
            title = str(fields.get("TITLE", "")).strip()
            object_summary = str(fields.get("SUMMARY", "")).strip()
            if object_type not in allowed_types or not subtype or not title or not object_summary:
                continue
            tags = split_keywords(str(fields.get("TAGS", "")).replace("|", " "))
            confidence = str(fields.get("CONFIDENCE", "")).strip().lower() or "medium"
            reusable_objects.append(
                {
                    "type": object_type,
                    "subtype": subtype,
                    "title": title,
                    "content": {
                        "summary": object_summary,
                        "tags": tags[:8],
                        "confidence": confidence if confidence in {"low", "medium", "high"} else "medium",
                    },
                }
            )
    if not insights:
        raise ValueError("reference aggregate protocol missing insights")
    if not reusable_objects:
        raise ValueError("reference aggregate protocol missing reusable objects")
    return {
        "summary": summary,
        "draftInsights": insights[:6],
        "reusableObjects": reusable_objects[:4],
    }


def llm_reference_chunk_blueprint(
    project: dict,
    source: dict,
    notes: str,
    chunk: dict,
    total_chunks: int,
    timeout_seconds: int | None = None,
) -> dict:
    system_prompt = (
        "你是小说拆解助手。你当前只分析参考作品的一个正文片段。"
        "不要输出 JSON。"
        "必须严格使用以下文本块协议：\n"
        "[SUMMARY]\n"
        "一句片段摘要\n\n"
        "[INSIGHT]\n"
        "TITLE: 观察标题\n"
        "SUMMARY: 观察内容\n\n"
        "[INSIGHT]\n"
        "TITLE: 观察标题\n"
        "SUMMARY: 观察内容\n\n"
        "[SIGNAL]\n"
        "一条可迁移信号\n"
        "输出 2 到 4 个 INSIGHT，2 到 4 个 SIGNAL。"
        "不要做整本书结论，只描述这个片段透露出的结构特征。"
    )
    user_prompt = (
        f"当前小说：{project.get('title', '未命名新书')}\n"
        f"当前小说题材：{project.get('genre', '待定题材')}\n"
        f"参考作品：{source.get('title', '未命名参考作品')}\n"
        f"拆解意图：{notes or '请提炼其结构可迁移部分'}\n"
        f"当前片段：第 {chunk.get('index', 1)} / {total_chunks} 段\n"
        f"字符范围：{chunk.get('start', 0)}..{chunk.get('end', 0)}\n\n"
        f"正文片段：\n{chunk.get('text', '').strip()}\n\n"
        "请严格按协议输出。"
    )
    raw = chat_completion(
        system_prompt,
        user_prompt,
        temperature=0.3,
        timeout_seconds=timeout_seconds,
    )
    payload = parse_reference_chunk_protocol(raw)
    draft_insights = payload.get("draftInsights", [])
    reusable_signals = payload.get("reusableSignals", [])
    return {
        "index": chunk.get("index", 1),
        "start": chunk.get("start", 0),
        "end": chunk.get("end", 0),
        "summary": str(payload.get("summary", "")).strip(),
        "draftInsights": [
            {
                "title": str(item.get("title", "未命名观察")).strip() or "未命名观察",
                "summary": str(item.get("summary", "")).strip(),
            }
            for item in draft_insights
            if isinstance(item, dict)
        ][:4],
        "reusableSignals": [
            str(item).strip()
            for item in reusable_signals
            if str(item).strip()
        ][:4],
        "raw": raw,
    }


def llm_reference_aggregate_blueprints(
    project: dict,
    source: dict,
    notes: str,
    chunk_results: list[dict],
    total_chars: int,
    aggregate_group_size: int = 8,
    timeout_seconds: int | None = None,
) -> dict:
    working_results = list(chunk_results)
    group_round = 1
    group_size = max(4, int(aggregate_group_size or 8))
    while True:
        serialized_probe = "\n\n".join(
            serialize_reference_chunk_result(item) for item in working_results
        )
        if len(serialized_probe) <= 50000 or len(working_results) <= group_size:
            break
        next_level_results = []
        for offset in range(0, len(working_results), group_size):
            group_items = working_results[offset : offset + group_size]
            group_serialized = "\n\n".join(
                serialize_reference_chunk_result(item) for item in group_items
            )
            system_prompt = (
                "你是小说拆解助手。你将收到若干正文片段分析结果。"
                "请把这些结果压缩成一个更高层的组摘要。"
                "不要输出 JSON。"
                "必须严格使用以下文本块协议：\n"
                "[SUMMARY]\n"
                "一句组摘要\n\n"
                "[INSIGHT]\n"
                "TITLE: 观察标题\n"
                "SUMMARY: 观察内容\n\n"
                "[SIGNAL]\n"
                "一条可迁移信号\n"
                "输出 2 到 4 个 INSIGHT，2 到 4 个 SIGNAL。"
            )
            user_prompt = (
                f"参考作品：{source.get('title', '未命名参考作品')}\n"
                f"拆解意图：{notes or '请提炼其结构可迁移部分'}\n"
                f"当前汇总轮次：{group_round}\n"
                f"当前组序号：{offset // group_size + 1}\n\n"
                f"组内分析结果：\n{group_serialized}\n\n"
                "请严格按协议输出。"
            )
            raw = chat_completion(
                system_prompt,
                user_prompt,
                temperature=0.25,
                timeout_seconds=timeout_seconds,
            )
            payload = parse_reference_chunk_protocol(raw)
            group_insights = payload.get("draftInsights", [])
            group_signals = payload.get("reusableSignals", [])
            next_level_results.append(
                {
                    "index": f"R{group_round}-G{offset // group_size + 1}",
                    "start": group_items[0].get("start", 0),
                    "end": group_items[-1].get("end", 0),
                    "summary": str(payload.get("summary", "")).strip(),
                    "draftInsights": [
                        {
                            "title": str(item.get("title", "未命名观察")).strip() or "未命名观察",
                            "summary": str(item.get("summary", "")).strip(),
                        }
                        for item in group_insights
                        if isinstance(item, dict)
                    ][:4],
                    "reusableSignals": [
                        str(item).strip()
                        for item in group_signals
                        if str(item).strip()
                    ][:4],
                    "raw": raw,
                }
            )
        working_results = next_level_results
        group_round += 1

    system_prompt = (
        "你是小说拆解助手。你将收到整本参考作品按片段分析后的结果。"
        "这些片段已经覆盖全文，请基于它们输出整本作品的结构化拆解。"
        "不要输出 JSON。"
        "必须严格使用以下文本块协议：\n"
        "[SUMMARY]\n"
        "整本摘要\n\n"
        "[INSIGHT]\n"
        "TITLE: 标题\n"
        "SUMMARY: 内容\n\n"
        "[OBJECT]\n"
        "TYPE: novel_metadata|worldbuilding|character_relation|story_direction\n"
        "SUBTYPE: 任意合法子类名\n"
        "TITLE: 对象标题\n"
        "SUMMARY: 对象摘要\n"
        "TAGS: 标签1 | 标签2 | 标签3\n"
        "CONFIDENCE: low|medium|high\n"
        "输出 3 到 6 个 INSIGHT，2 到 4 个 OBJECT。"
        "重点提炼可迁移结构，不要写长篇文学评论。"
    )
    serialized_chunks = "\n\n".join(
        serialize_reference_chunk_result(item) for item in working_results
    )
    user_prompt = (
        f"当前小说：{project.get('title', '未命名新书')}\n"
        f"当前小说题材：{project.get('genre', '待定题材')}\n"
        f"参考作品：{source.get('title', '未命名参考作品')}\n"
        f"来源类型：{source.get('sourceType', 'local_file')}\n"
        f"来源标识：{source.get('sourceLabel', '')}\n"
        f"拆解意图：{notes or '请提炼其结构可迁移部分'}\n"
        f"全文长度：{total_chars} 字符\n"
        f"全文分块数：{len(chunk_results)}\n"
        f"当前汇总输入块数：{len(working_results)}\n\n"
        f"以下是覆盖全文的分块分析结果：\n{serialized_chunks}\n\n"
        "请严格按协议输出。"
    )
    raw = chat_completion(
        system_prompt,
        user_prompt,
        temperature=0.35,
        timeout_seconds=timeout_seconds,
    )
    payload = parse_reference_aggregate_protocol(raw)
    draft_insights = payload.get("draftInsights", [])
    reusable_objects = payload.get("reusableObjects", [])
    return {
        "summary": str(payload.get("summary", "")).strip(),
        "raw": raw,
        "draftInsights": draft_insights,
        "reusableObjects": reusable_objects,
    }


def reference_insight_titles() -> list[str]:
    return [
        "题材切口",
        "卖点组织",
        "节奏推进",
        "角色功能",
        "世界规则支撑",
        "可迁移方法",
    ]


def normalize_reference_insights(raw_insights: list, title: str, source_text: str, notes: str) -> list[dict]:
    fallback_seed = truncate_text(notes or source_text, 120)
    normalized_items = []
    source_items = raw_insights if isinstance(raw_insights, list) else []
    for index, standard_title in enumerate(reference_insight_titles()):
        source_item = source_items[index] if index < len(source_items) and isinstance(source_items[index], dict) else {}
        summary = str(source_item.get("summary", "")).strip()
        if not summary:
            if standard_title == "题材切口":
                summary = f"《{title}》最先成立的是它的题材切口，以及读者进入这部作品时最先抓住的识别点。"
            elif standard_title == "卖点组织":
                summary = f"《{title}》如何把核心卖点持续展开，而不是只停留在一句概念上。"
            elif standard_title == "节奏推进":
                summary = f"《{title}》如何分配阶段目标、冲突升级和信息揭示节奏。"
            elif standard_title == "角色功能":
                summary = f"《{title}》里的主角、对手和辅助角色分别承担什么推进功能。"
            elif standard_title == "世界规则支撑":
                summary = f"《{title}》的世界规则、设定限制或力量代价如何支撑剧情。"
            else:
                summary = f"从《{title}》里最值得迁移到新小说的方法论是：{fallback_seed or '待人工补充'}。"
        normalized_items.append(
            {
                "title": standard_title,
                "summary": truncate_text(summary, 160),
            }
        )
    return normalized_items


def fallback_reference_asset_blueprints(
    project: dict,
    source: dict,
    notes: str,
    source_text: str,
) -> dict:
    cleaned = str(notes or "").strip()
    title = str(source.get("title") or "未命名参考作品").strip() or "未命名参考作品"
    source_excerpt = truncate_text(source_text, 220)
    summary = truncate_text(
        cleaned or f"拆解《{title}》的题材切口、节奏组织、角色功能和设定支撑方式。",
        180,
    )
    draft_insights = [
        {
            "title": "题材与切口",
            "summary": f"《{title}》最值得拆的是它如何用明确切口建立题材识别度。文本线索：{source_excerpt}",
        },
        {
            "title": "卖点与钩子",
            "summary": cleaned or f"《{title}》如何把最核心的爽点、钩子或持续吸引力组织成长期可推进的卖点。",
        },
        {
            "title": "推进与冲突",
            "summary": f"《{title}》的推进方式可作为节奏与冲突升级样本。",
        },
        {
            "title": "角色与规则",
            "summary": f"优先拆《{title}》里主角功能、对手功能，以及规则和代价层如何支撑主线推进。",
        },
    ]
    reusable_objects = [
        {
            "type": "novel_metadata",
            "subtype": "reference_hook_method",
            "title": f"{title} 的卖点组织方式",
            "content": {
                "summary": truncate_text(
                    cleaned or f"参考《{title}》如何把题材切口、核心人物与持续钩子压成一句高识别卖点。",
                    140,
                ),
                "tags": split_keywords(title, "卖点", "结构"),
                "confidence": "medium",
            },
        },
        {
            "type": "story_direction",
            "subtype": "reference_conflict_pattern",
            "title": f"{title} 的冲突升级模式",
            "content": {
                "summary": truncate_text(
                    cleaned or f"参考《{title}》如何组织阶段目标、持续矛盾和升级节点。",
                    140,
                ),
                "tags": split_keywords(title, "冲突", "节奏"),
                "confidence": "medium",
            },
        },
    ]
    if any(keyword in cleaned for keyword in ["世界", "设定", "规则", "体系", "力量"]):
        reusable_objects.append(
            {
                "type": "worldbuilding",
                "subtype": "reference_world_method",
                "title": f"{title} 的设定支撑方式",
                "content": {
                    "summary": truncate_text(cleaned, 140),
                    "tags": split_keywords(title, "设定", "世界"),
                    "confidence": "medium",
                },
            }
        )
    else:
        reusable_objects.append(
            {
                "type": "character_relation",
                "subtype": "reference_role_pattern",
                "title": f"{title} 的角色功能分配",
                "content": {
                    "summary": truncate_text(
                        cleaned or f"参考《{title}》如何给主角、对手、辅助角色分配功能。",
                        140,
                    ),
                    "tags": split_keywords(title, "角色", "功能"),
                    "confidence": "medium",
                },
            }
        )
    return {
        "summary": summary,
        "rawAnalysis": {
            "format": "json",
            "content": json_text(
                {
                    "summary": summary,
                    "draftInsights": draft_insights,
                    "reusableObjects": reusable_objects[:4],
                }
            ),
        },
        "draftAnalysis": {
            "summary": summary,
            "insights": draft_insights,
            "reusableObjects": reusable_objects[:4],
        },
        "insights": normalize_reference_insights(
            draft_insights,
            title,
            source_text,
            notes,
        ),
        "reusableObjects": reusable_objects[:4],
    }


def llm_reference_asset_blueprints(
    project: dict,
    source: dict,
    notes: str,
    source_text: str,
    execution: dict | None = None,
    progress_callback=None,
) -> dict:
    execution_config = execution if isinstance(execution, dict) else reference_analysis_execution()
    chunks = split_reference_text_into_chunks(
        source_text,
        target_size=execution_config["chunkSize"],
        overlap=execution_config["chunkOverlap"],
    )
    selected_chunks, coverage = select_reference_chunks(
        chunks,
        execution_config["maxChunkBudget"],
    )
    if callable(progress_callback):
        progress_callback(
            {
                "phase": "chunk_analysis",
                "message": f"准备拆解，共 {coverage.get('selectedChunks', len(selected_chunks))} / {coverage.get('totalChunks', len(chunks))} 段需要分析。",
                "totalChunks": coverage.get("totalChunks", len(chunks)),
                "analyzedChunkCount": coverage.get("selectedChunks", len(selected_chunks)),
                "completedChunks": 0,
                "currentChunkIndex": None,
            }
        )
    chunk_results = []
    for index, chunk in enumerate(selected_chunks, start=1):
        if callable(progress_callback):
            progress_callback(
                {
                    "phase": "chunk_analysis",
                    "message": f"正在拆解第 {index} / {len(selected_chunks)} 段。",
                    "totalChunks": coverage.get("totalChunks", len(chunks)),
                    "analyzedChunkCount": coverage.get("selectedChunks", len(selected_chunks)),
                    "completedChunks": index - 1,
                    "currentChunkIndex": index,
                }
            )
        chunk_results.append(
            llm_reference_chunk_blueprint(
                project,
                source,
                notes,
                chunk,
                len(chunks),
                timeout_seconds=execution_config["timeoutSeconds"],
            )
        )
        if callable(progress_callback):
            progress_callback(
                {
                    "phase": "chunk_analysis",
                    "message": f"已完成第 {index} / {len(selected_chunks)} 段。",
                    "totalChunks": coverage.get("totalChunks", len(chunks)),
                    "analyzedChunkCount": coverage.get("selectedChunks", len(selected_chunks)),
                    "completedChunks": index,
                    "currentChunkIndex": index,
                }
            )
    if callable(progress_callback):
        progress_callback(
            {
                "phase": "aggregate",
                "message": "分块完成，正在汇总整本结构。",
                "totalChunks": coverage.get("totalChunks", len(chunks)),
                "analyzedChunkCount": coverage.get("selectedChunks", len(selected_chunks)),
                "completedChunks": len(selected_chunks),
                "currentChunkIndex": None,
            }
        )
    aggregate = llm_reference_aggregate_blueprints(
        project,
        source,
        notes,
        chunk_results,
        len(str(source_text or "")),
        aggregate_group_size=execution_config["aggregateGroupSize"],
        timeout_seconds=execution_config["timeoutSeconds"],
    )
    draft_insights = aggregate.get("draftInsights", [])
    reusable_objects = aggregate.get("reusableObjects", [])
    sampled = bool(coverage.get("sampled"))
    total_chunks = int(coverage.get("totalChunks", len(chunks)))
    analyzed_chunks = int(coverage.get("selectedChunks", len(selected_chunks)))
    summary_suffix = (
        f"（原文共 {total_chunks} 段，本次抽样分析 {analyzed_chunks} 段）"
        if sampled
        else f"（已按全文 {analyzed_chunks} 段完成分块分析）"
    )
    return {
        "summary": str(aggregate.get("summary", "")).strip(),
        "rawAnalysis": {
            "format": "json",
            "content": json_text(
                {
                    "analysisMode": "full_text_sampled" if sampled else "full_text_chunked",
                    "chunkCount": len(chunks),
                    "analyzedChunkCount": analyzed_chunks,
                    "totalCharacters": len(str(source_text or "")),
                    "chunks": [
                        {
                            "index": item.get("index"),
                            "start": item.get("start"),
                            "end": item.get("end"),
                            "summary": item.get("summary", ""),
                            "draftInsights": item.get("draftInsights", []),
                            "reusableSignals": item.get("reusableSignals", []),
                            "raw": item.get("raw", ""),
                        }
                        for item in chunk_results
                    ],
                    "aggregateRaw": aggregate.get("raw", ""),
                }
            ),
        },
        "draftAnalysis": {
            "summary": f"{str(aggregate.get('summary', '')).strip()}{summary_suffix}",
            "insights": draft_insights,
            "reusableObjects": reusable_objects,
        },
        "insights": normalize_reference_insights(
            draft_insights,
            str(source.get("title", "未命名参考作品")),
            source_text,
            notes,
        ),
        "reusableObjects": reusable_objects,
    }


def extract_reference_asset_blueprints(
    project: dict,
    source: dict,
    notes: str,
    source_text: str,
    execution: dict | None = None,
    progress_callback=None,
) -> dict:
    try:
        if llm_settings().get("configured"):
            return llm_reference_asset_blueprints(
                project,
                source,
                notes,
                source_text,
                execution=execution,
                progress_callback=progress_callback,
            )
    except Exception as exc:
        print(f"[reference analysis] fallback to heuristic extraction: {exc}")
    return fallback_reference_asset_blueprints(project, source, notes, source_text)


def fallback_capability_feature_blueprints(text: str) -> list[dict]:
    cleaned = str(text or "").strip()
    features = []
    keyword_rules = [
        (
            ("风格", "语感", "对白", "对话", "节奏"),
            {
                "name": "style_dimension_dialogue_density",
                "featureType": "style_dimension",
                "description": "将风格拆出对白密度、叙事节奏等可单独讨论的维度。",
            },
        ),
        (
            ("势力", "阵营", "组织", "派系"),
            {
                "name": "relationship_type_faction_alignment",
                "featureType": "relationship_type",
                "description": "补充势力立场、组织关系等结构化关系类型。",
            },
        ),
        (
            ("规则", "设定", "体系", "世界", "力量"),
            {
                "name": "worldbuilding_subtype_rule_layer",
                "featureType": "object_subtype",
                "description": "为世界设定补充规则层、代价层、支撑层等 subtype。",
            },
        ),
        (
            ("记忆", "版本", "回看", "追因"),
            {
                "name": "memory_type_decision_recall",
                "featureType": "memory_type",
                "description": "补充面向版本回看与追因的决策记忆类型。",
            },
        ),
    ]
    for keywords, blueprint in keyword_rules:
        if any(keyword in cleaned for keyword in keywords):
            features.append(blueprint)
    return features


def extract_capability_feature_blueprints(text: str) -> list[dict]:
    blueprints = fallback_capability_feature_blueprints(text)
    deduped = []
    seen = set()
    for blueprint in blueprints:
        name = blueprint["name"]
        if name in seen:
            continue
        seen.add(name)
        deduped.append(blueprint)
    return deduped[:4]


def create_conversation(space_id: str, title: str = "自由构思对话") -> dict:
    return normalize_conversation(
        {
            "id": f"conv-{uuid.uuid4().hex[:8]}",
            "spaceId": space_id,
            "title": title,
            "status": "active",
            "messages": [],
        }
    )


def ensure_active_conversation(payload: dict, space: dict) -> dict:
    active_id = str(space.get("activeConversationId") or "").strip()
    if active_id:
        existing = next(
            (
                item
                for item in payload["conversations"]
                if item.get("id") == active_id and item.get("spaceId") == space["id"]
            ),
            None,
        )
        if existing:
            return existing

    existing = next(
        (
            item
            for item in payload["conversations"]
            if item.get("spaceId") == space["id"] and item.get("status") == "active"
        ),
        None,
    )
    if existing is None:
        existing = create_conversation(space["id"])
        payload["conversations"].append(existing)
    space["activeConversationId"] = existing["id"]
    space["updatedAt"] = now()
    return existing


def append_conversation_message(
    conversation: dict,
    role: str,
    content: str,
    meta: dict | None = None,
) -> dict:
    message = normalize_conversation_message(
        {
            "role": role,
            "content": str(content or "").strip(),
            "meta": meta or {},
        }
    )
    conversation["messages"].append(message)
    conversation["updatedAt"] = now()
    return message


def capability_feature_exists(
    payload: dict,
    name: str,
    scope_level: str,
    space_id: str | None = None,
) -> bool:
    for item in payload["capability_features"]:
        origin_scope = item.get("originScope") or {}
        if item.get("name") != name:
            continue
        if origin_scope.get("level") != scope_level:
            continue
        if scope_level == "novel" and origin_scope.get("spaceId") != space_id:
            continue
        return True
    return False


def author_feature_suggestion_score(project: dict, space: dict, feature: dict) -> int:
    text = " ".join(
        [
            str(project.get("genre", "")),
            str(project.get("hook", "")),
            str(project.get("audience", "")),
            str((project.get("settings") or {}).get("world", "")),
            str((project.get("settings") or {}).get("powerSystem", "")),
            str((project.get("settings") or {}).get("factions", "")),
        ]
    )
    score = 0
    name = str(feature.get("name", ""))
    feature_type = str(feature.get("featureType", ""))
    description = str(feature.get("description", ""))
    combined = " ".join([name, feature_type, description])

    if "style" in combined and any(keyword in text for keyword in ["悬疑", "言情", "文艺", "风格", "语感", "对白"]):
        score += 3
    if any(token in combined for token in ["world", "rule", "设定", "规则", "体系"]) and any(
        keyword in text for keyword in ["玄幻", "仙侠", "科幻", "世界", "设定", "力量"]
    ):
        score += 3
    if any(token in combined for token in ["relationship", "faction", "势力", "关系"]) and any(
        keyword in text for keyword in ["朝堂", "悬疑", "权谋", "势力", "阵营", "组织"]
    ):
        score += 3
    if any(token in combined for token in ["memory", "version", "追因", "回看"]):
        score += 1
    if space.get("sourceMode") == "assisted_by_references":
        score += 1
    return score


def suggested_author_features(payload: dict, project: dict, space: dict) -> list[dict]:
    inherited_ids = set(space.get("inheritedAuthorFeatureIds") or [])
    author_features = [
        item
        for item in payload["capability_features"]
        if (item.get("originScope") or {}).get("level") == "author"
    ]
    scored = []
    for feature in author_features:
        if feature.get("id") in inherited_ids:
            continue
        score = author_feature_suggestion_score(project, space, feature)
        if score <= 0:
            continue
        scored.append((score, feature))
    scored.sort(key=lambda item: (-item[0], item[1].get("createdAt", ""), item[1].get("name", "")))
    return [deepcopy(feature) for _, feature in scored[:6]]


def add_local_capability_features(
    payload: dict,
    space_id: str,
    text: str,
    source_kind: str,
    ref_id: str,
) -> list[dict]:
    created = []
    for blueprint in extract_capability_feature_blueprints(text):
        if capability_feature_exists(payload, blueprint["name"], "novel", space_id):
            continue
        feature = normalize_capability_feature(
            {
                "id": f"feat-{uuid.uuid4().hex[:8]}",
                "name": blueprint["name"],
                "featureType": blueprint.get("featureType", "metadata_extension"),
                "description": blueprint.get("description", ""),
                "originScope": {"level": "novel", "spaceId": space_id},
                "status": "local_trial",
                "suggestedBy": "ai",
                "activationMode": "suggested_not_default",
                "sourceRef": {"kind": source_kind, "refId": ref_id},
            }
        )
        payload["capability_features"].append(feature)
        created.append(feature)
    return created


def fallback_chat_reply(project: dict, user_message: str, objects: list[dict]) -> str:
    lines = ["我先把这轮构思里的可沉淀部分挂成候选对象了。"]
    if objects:
        lines.append("这次我先抓到的重点是：")
        for obj in objects[:3]:
            lines.append(
                f"- {obj.get('title', '未命名对象')}：{truncate_text((obj.get('content') or {}).get('summary', ''), 60)}"
            )
    lines.append("你可以继续往下聊，不用先整理格式。")
    if not any(keyword in user_message for keyword in ["主角", "角色", "人物"]):
        lines.append("下一步我更想确认主角切口和人物驱动力。")
    elif not any(keyword in user_message for keyword in ["世界", "规则", "设定", "力量"]):
        lines.append("下一步可以把世界规则或核心设定再压实一点。")
    else:
        lines.append("如果你愿意，我可以继续往下推冲突方向和卷级发展。")
    return "\n".join(lines)


def llm_chat_reply(project: dict, user_message: str, objects: list[dict]) -> str:
    system_prompt = (
        "你是小说构思共创助手。"
        "现在请基于用户刚说的话，以及已经提炼出的候选对象，给出一段简洁、自然、继续推进式的中文回复。"
        "要求像对话，不要输出 JSON，不要写 markdown 标题，不要太长。"
        "回复应包含：你抓到的重点、你准备如何继续推进、以及一个最值得继续聊的问题。"
    )
    user_prompt = (
        f"项目标题：{project.get('title', '未命名')}\n"
        f"项目题材：{project.get('genre', '待定题材')}\n"
        f"用户本轮输入：{user_message}\n"
        f"本轮已提炼出的候选对象：{json_text(objects[:4])}\n"
        "请直接给出助手回复。"
    )
    reply = chat_completion(system_prompt, user_prompt, temperature=0.7).strip()
    if not reply:
        raise ValueError("empty chat reply")
    return reply


def generate_chat_reply(project: dict, user_message: str, objects: list[dict]) -> str:
    try:
        if llm_settings().get("configured"):
            return llm_chat_reply(project, user_message, objects)
    except Exception as exc:
        print(f"[kernel chat] fallback to heuristic reply: {exc}")
    return fallback_chat_reply(project, user_message, objects)


def story_object_from_blueprint(space_id: str, conversation_id: str, blueprint: dict) -> dict:
    allowed_types = {"novel_metadata", "worldbuilding", "character_relation", "story_direction"}
    object_type = str(blueprint.get("type") or "novel_metadata")
    if object_type not in allowed_types:
        object_type = "novel_metadata"
    content = blueprint.get("content") if isinstance(blueprint.get("content"), dict) else {}
    tags = content.get("tags")
    if not isinstance(tags, list):
        tags = split_keywords(*([content.get("summary", "")] if content.get("summary") else []))
    return normalize_story_object(
        {
            "id": f"obj-{uuid.uuid4().hex[:8]}",
            "spaceId": space_id,
            "type": object_type,
            "subtype": str(blueprint.get("subtype") or "generic"),
            "title": str(blueprint.get("title") or "未命名候选对象"),
            "content": {
                "summary": truncate_text(content.get("summary", ""), 220),
                "tags": tags[:6],
                "confidence": str(content.get("confidence") or "medium"),
            },
            "status": "candidate",
            "source": {
                "kind": "conversation",
                "refId": conversation_id,
            },
        }
    )


def create_memory_from_object(space_id: str, obj: dict, version_id: str) -> dict:
    memory_type = "fact"
    if obj.get("type") == "story_direction":
        memory_type = "decision_reason"
    elif obj.get("type") == "novel_metadata" and obj.get("subtype") in {"audience", "style_profile", "constraint"}:
        memory_type = "preference"
    return normalize_memory_entry(
        {
            "scope": {
                "level": "novel",
                "spaceId": space_id,
                "volumeNumber": None,
                "chapterNumber": None,
            },
            "type": memory_type,
            "priority": 80,
            "summary": truncate_text(obj.get("content", {}).get("summary", obj.get("title", "")), 180),
            "linkedObjectIds": [obj["id"]],
            "linkedVersionRef": version_id,
        }
    )


def apply_formal_object_to_project(project: dict, obj: dict) -> None:
    subtype = obj.get("subtype")
    summary = str((obj.get("content") or {}).get("summary") or "").strip()
    if not summary:
        return
    if obj.get("type") == "novel_metadata":
        if subtype == "hook":
            project["hook"] = summary
        elif subtype == "theme":
            project["settings"]["theme"] = summary
        elif subtype == "audience":
            project["audience"] = summary
    elif obj.get("type") == "worldbuilding":
        if subtype in {"world_seed", "world_rule"}:
            project["settings"]["world"] = summary
        elif subtype == "power_system":
            project["settings"]["powerSystem"] = summary
        elif subtype == "faction_structure":
            project["settings"]["factions"] = summary


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
        "spaceId": "",
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
    return normalize_payload(payload)


def save_payload(payload: dict) -> None:
    normalized = normalize_payload(payload)
    DATA_PATH.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
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
    normalized.pop("kernel", None)
    normalized.pop("kernelSummary", None)
    normalized.setdefault("platform", "起点中文网")
    normalized.setdefault("audience", "偏剧情向的男频读者")
    normalized.setdefault("hook", "")
    normalized.setdefault("spaceId", "")
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
    normalized.setdefault("referenceAnalysis", default_reference_analysis_state())
    normalized["referenceAnalysis"].setdefault("runStatus", "idle")
    normalized["referenceAnalysis"].setdefault("currentRun", None)
    if isinstance(normalized["referenceAnalysis"].get("currentRun"), dict):
        normalized["referenceAnalysis"]["currentRun"].setdefault("options", {})

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


def active_reference_analysis_runner_exists(project_id: str) -> bool:
    with RUNNER_LOCK:
        thread = REFERENCE_ANALYSIS_RUNNERS.get(project_id)
        if thread and thread.is_alive():
            return True
        REFERENCE_ANALYSIS_RUNNERS.pop(project_id, None)
        return False


def register_reference_analysis_runner(project_id: str, thread: threading.Thread) -> None:
    with RUNNER_LOCK:
        REFERENCE_ANALYSIS_RUNNERS[project_id] = thread


def unregister_reference_analysis_runner(project_id: str) -> None:
    with RUNNER_LOCK:
        REFERENCE_ANALYSIS_RUNNERS.pop(project_id, None)


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


def update_reference_analysis_state(
    project: dict,
    run_status: str,
    *,
    job_id: str | None = None,
    phase: str | None = None,
    message: str = "",
    error: str = "",
    source_title: str | None = None,
    mode: str | None = None,
    role: str | None = None,
    total_chunks: int | None = None,
    analyzed_chunks: int | None = None,
    completed_chunks: int | None = None,
    current_chunk_index: int | None = None,
    asset_id: str | None = None,
    options: dict | None = None,
) -> None:
    project.setdefault("referenceAnalysis", default_reference_analysis_state())
    project["referenceAnalysis"]["runStatus"] = run_status
    if run_status == "idle":
        project["referenceAnalysis"]["currentRun"] = None
        return

    current_run = project["referenceAnalysis"].get("currentRun") or {}
    started_at = current_run.get("startedAt") or now()
    project["referenceAnalysis"]["currentRun"] = {
        "jobId": job_id or current_run.get("jobId"),
        "phase": phase or current_run.get("phase"),
        "message": message or current_run.get("message", ""),
        "error": error or current_run.get("error", ""),
        "sourceTitle": source_title or current_run.get("sourceTitle", ""),
        "mode": mode or current_run.get("mode", "project_assisted_analysis"),
        "role": role or current_run.get("role", "parallel"),
        "totalChunks": total_chunks if total_chunks is not None else current_run.get("totalChunks"),
        "analyzedChunkCount": analyzed_chunks if analyzed_chunks is not None else current_run.get("analyzedChunkCount"),
        "completedChunks": completed_chunks if completed_chunks is not None else current_run.get("completedChunks", 0),
        "currentChunkIndex": current_chunk_index if current_chunk_index is not None else current_run.get("currentChunkIndex"),
        "assetId": asset_id or current_run.get("assetId"),
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
        payload = load_payload()
        return [attach_kernel_summary(project, payload) for project in payload["projects"]]


def get_project_automation(project_id: str) -> dict:
    project = get_project(project_id)
    return deepcopy(project.get("automation", default_automation_state()))


def get_project(project_id: str) -> dict:
    with LOCK:
        payload = load_payload()
        for project in payload["projects"]:
            if project["id"] == project_id:
                return attach_kernel_bundle(project, payload)
    raise KeyError("project not found")


def mutate_payload(mutator):
    with LOCK:
        payload = load_payload()
        result = mutator(payload)
        save_payload(payload)
        return result


def mutate_projects(mutator):
    def apply(payload: dict):
        return mutator(payload["projects"])

    return mutate_payload(apply)


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


def find_project_in_payload(payload: dict, project_id: str) -> dict:
    for project in payload["projects"]:
        if str(project.get("id")) == str(project_id):
            return project
    raise KeyError("project not found")


def kernel_bundle_for_project(payload: dict, project_id: str) -> dict:
    project = find_project_in_payload(payload, project_id)
    return build_kernel_bundle(payload, project)


def ideate_project_kernel(payload: dict, project_id: str, message: str) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    conversation = ensure_active_conversation(payload, space)
    conversation_id = conversation["id"]
    blueprints = extract_kernel_blueprints(project, message)
    objects = [
        story_object_from_blueprint(space["id"], conversation_id, blueprint)
        for blueprint in blueprints[:6]
    ]
    payload["objects"].extend(objects)
    change_set = normalize_candidate_change_set(
        {
            "id": f"ccs-{uuid.uuid4().hex[:8]}",
            "spaceId": space["id"],
            "title": f"构思候选 {now()}",
            "origin": {
                "conversationId": conversation_id,
                "trigger": "ai_extracted",
            },
            "objectIds": [obj["id"] for obj in objects],
            "notes": truncate_text(message, 180),
        }
    )
    payload["candidate_change_sets"].append(change_set)
    refresh_space_indexes(payload, space["id"])
    project["updatedAt"] = now()
    return build_kernel_bundle(payload, project)


def chat_project_kernel(payload: dict, project_id: str, message: str) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    conversation = ensure_active_conversation(payload, space)
    append_conversation_message(conversation, "user", message)
    kernel = ideate_project_kernel(payload, project_id, message)
    candidate_objects = kernel.get("candidateObjects", [])
    latest_change_set = next(
        (
            item
            for item in reversed(kernel.get("candidateChangeSets", []))
            if (item.get("origin") or {}).get("conversationId") == conversation["id"]
        ),
        None,
    )
    current_objects = candidate_objects
    if latest_change_set:
        object_id_set = set(latest_change_set.get("objectIds") or [])
        current_objects = [obj for obj in candidate_objects if obj.get("id") in object_id_set]
    add_local_capability_features(payload, space["id"], message, "conversation", conversation["id"])
    reply = generate_chat_reply(project, message, current_objects)
    append_conversation_message(
        conversation,
        "assistant",
        reply,
        {
            "changeSetId": latest_change_set.get("id") if latest_change_set else None,
            "candidateObjectIds": [obj.get("id") for obj in current_objects],
        },
    )
    project["updatedAt"] = now()
    return build_kernel_bundle(payload, project)


def commit_reference_asset_analysis(
    payload: dict,
    project_id: str,
    source: dict,
    notes: str,
    mode: str,
    role: str,
    analysis: dict,
    *,
    job_id: str | None = None,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    normalized_mode = mode if mode in {"independent_analysis", "project_assisted_analysis"} else "project_assisted_analysis"
    normalized_role = role if role in {"primary", "supporting", "parallel"} else "parallel"
    owner_scope = {"level": "author", "spaceId": None}
    if normalized_mode == "project_assisted_analysis":
        owner_scope = {"level": "novel", "spaceId": space["id"]}
        space["sourceMode"] = "assisted_by_references"
        space["updatedAt"] = now()

    asset = normalize_reference_asset(
        {
            "id": f"ref-{uuid.uuid4().hex[:8]}",
            "mode": normalized_mode,
            "ownerScope": owner_scope,
            "sourceWork": {
                "title": source["title"],
                "role": normalized_role,
                "sourceType": source["sourceType"],
                "sourceLabel": source["sourceLabel"],
            },
            "summary": analysis.get("summary", ""),
            "rawAnalysis": analysis.get("rawAnalysis", {}),
            "draftAnalysis": analysis.get("draftAnalysis", {}),
            "insights": analysis.get("insights", []),
            "reusableObjects": analysis.get("reusableObjects", []),
            "outputs": {"insightIds": [], "reusableObjectIds": []},
            "upgradeStatus": "local_only" if normalized_mode == "project_assisted_analysis" else "author_level",
        }
    )
    payload["reference_assets"].append(asset)
    combined_feature_text = "\n".join(
        [notes, analysis.get("summary", "")]
        + [item.get("summary", "") for item in analysis.get("insights", [])]
    )

    if normalized_mode == "project_assisted_analysis":
        objects = []
        for blueprint in analysis.get("reusableObjects", [])[:6]:
            obj = story_object_from_blueprint(space["id"], asset["id"], blueprint)
            obj["source"] = {"kind": "reference", "refId": asset["id"]}
            objects.append(obj)
        payload["objects"].extend(objects)
        asset["outputs"]["reusableObjectIds"] = [obj["id"] for obj in objects]
        if objects:
            payload["candidate_change_sets"].append(
                normalize_candidate_change_set(
                    {
                        "id": f"ccs-{uuid.uuid4().hex[:8]}",
                        "spaceId": space["id"],
                        "title": f"参考拆解候选 {source['title']}",
                        "origin": {"conversationId": asset["id"], "trigger": "reference_analysis"},
                        "objectIds": [obj["id"] for obj in objects],
                        "notes": truncate_text(
                            f"来自参考作品《{source['title']}》的结构结论与可复用对象。",
                            180,
                        ),
                    }
                )
            )
        add_local_capability_features(
            payload,
            space["id"],
            combined_feature_text,
            "reference_asset",
            asset["id"],
        )

    refresh_space_indexes(payload, space["id"])
    if job_id:
        current_run = (project.get("referenceAnalysis") or {}).get("currentRun") or {}
        update_reference_analysis_state(
            project,
            "completed",
            job_id=job_id,
            phase="completed",
            message="参考作品拆解完成。",
            error="",
            source_title=source.get("title", ""),
            mode=normalized_mode,
            role=normalized_role,
            total_chunks=current_run.get("totalChunks"),
            analyzed_chunks=current_run.get("analyzedChunkCount"),
            completed_chunks=current_run.get("completedChunks"),
            current_chunk_index=None,
            asset_id=asset["id"],
            options={"jobId": job_id},
        )
    project["updatedAt"] = now()
    return build_kernel_bundle(payload, project)


def analyze_reference_asset(
    payload: dict,
    project_id: str,
    source_type: str,
    source_path: str,
    source_text: str,
    source_label: str,
    source_url: str,
    source_title: str,
    notes: str,
    mode: str,
    role: str,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    execution = reference_analysis_execution(payload)
    source = normalize_reference_source(source_type, source_path, source_text, source_label, source_url, source_title)
    loaded_source_text = load_reference_source_text(source)
    normalized_mode = mode if mode in {"independent_analysis", "project_assisted_analysis"} else "project_assisted_analysis"
    normalized_role = role if role in {"primary", "supporting", "parallel"} else "parallel"
    analysis = extract_reference_asset_blueprints(project, source, notes, loaded_source_text, execution=execution)
    return commit_reference_asset_analysis(
        payload,
        project_id,
        source,
        notes,
        normalized_mode,
        normalized_role,
        analysis,
    )


def enqueue_reference_asset_analysis(
    payload: dict,
    project_id: str,
    source_type: str,
    source_path: str,
    source_text: str,
    source_label: str,
    source_url: str,
    source_title: str,
    notes: str,
    mode: str,
    role: str,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    current_state = project.get("referenceAnalysis", default_reference_analysis_state())
    current_status = str(current_state.get("runStatus", "idle"))
    if current_status == "running" and active_reference_analysis_runner_exists(project_id):
        raise ValueError("当前已有参考作品拆解任务在运行。")
    if current_status == "running":
        update_reference_analysis_state(
            project,
            "failed",
            phase="failed",
            message="检测到上一次拆解任务未正常结束，状态已重置。",
            error="后台线程不存在，请重新发起。",
            options={},
        )

    normalized_mode = mode if mode in {"independent_analysis", "project_assisted_analysis"} else "project_assisted_analysis"
    normalized_role = role if role in {"primary", "supporting", "parallel"} else "parallel"
    job_id = f"refjob-{uuid.uuid4().hex[:8]}"
    source = normalize_reference_source(source_type, source_path, source_text, source_label, source_url, source_title)
    persisted_source = persist_reference_job_source(project_id, job_id, source)
    options = {
        "jobId": job_id,
        "source": persisted_source,
        "notes": str(notes or "").strip(),
        "mode": normalized_mode,
        "role": normalized_role,
    }
    update_reference_analysis_state(
        project,
        "running",
        job_id=job_id,
        phase="queued",
        message="任务已创建，等待后台开始。",
        source_title=persisted_source.get("title", ""),
        mode=normalized_mode,
        role=normalized_role,
        completed_chunks=0,
        current_chunk_index=None,
        options=options,
    )
    project["updatedAt"] = now()
    return build_kernel_bundle(payload, project)


def promote_capability_feature_to_author(
    payload: dict,
    project_id: str,
    feature_id: str,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    feature = find_item(payload["capability_features"], feature_id, "capability feature")
    origin_scope = feature.get("originScope") or {}
    if origin_scope.get("level") != "novel" or origin_scope.get("spaceId") != space["id"]:
        raise ValueError("该能力特性不属于当前小说空间。")
    if feature.get("promotedFeatureId"):
        return build_kernel_bundle(payload, project)

    existing_author = next(
        (
            item
            for item in payload["capability_features"]
            if item.get("name") == feature.get("name")
            and (item.get("originScope") or {}).get("level") == "author"
        ),
        None,
    )
    if existing_author is None:
        existing_author = normalize_capability_feature(
            {
                "id": f"feat-{uuid.uuid4().hex[:8]}",
                "name": feature.get("name"),
                "featureType": feature.get("featureType", "metadata_extension"),
                "description": feature.get("description", ""),
                "originScope": {"level": "author", "spaceId": None},
                "status": "promoted_to_author",
                "suggestedBy": feature.get("suggestedBy", "ai"),
                "activationMode": feature.get("activationMode", "suggested_not_default"),
                "sourceRef": {"kind": "promoted_from_novel", "refId": feature["id"]},
            }
        )
        payload["capability_features"].append(existing_author)

    feature["status"] = "promoted_to_author"
    feature["promotedFeatureId"] = existing_author["id"]
    feature["updatedAt"] = now()
    project["updatedAt"] = now()
    refresh_space_indexes(payload, space["id"])
    return build_kernel_bundle(payload, project)


def enable_author_capability_feature(
    payload: dict,
    project_id: str,
    feature_id: str,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    feature = find_item(payload["capability_features"], feature_id, "capability feature")
    origin_scope = feature.get("originScope") or {}
    if origin_scope.get("level") != "author":
        raise ValueError("只能启用作者级能力特性。")

    inherited_ids = list(space.get("inheritedAuthorFeatureIds") or [])
    if feature_id not in inherited_ids:
        inherited_ids.append(feature_id)
    space["inheritedAuthorFeatureIds"] = inherited_ids
    space["updatedAt"] = now()
    project["updatedAt"] = now()
    refresh_space_indexes(payload, space["id"])
    return build_kernel_bundle(payload, project)


def accept_project_kernel_candidates(
    payload: dict,
    project_id: str,
    change_set_id: str,
    object_ids: list[str] | None,
    release_plan: dict | None,
) -> dict:
    project = find_project_in_payload(payload, project_id)
    ensure_project_space(payload, project)
    space = find_item(payload["spaces"], project["spaceId"], "space")
    change_set = find_item(payload["candidate_change_sets"], change_set_id, "candidate change set")
    if change_set.get("spaceId") != space["id"]:
        raise ValueError("候选变更不属于当前小说空间。")

    selected_ids = [str(item) for item in (object_ids or change_set.get("objectIds") or [])]
    if not selected_ids:
        raise ValueError("请至少选择一个候选对象。")

    plan = {
        "mode": str((release_plan or {}).get("mode") or "future_only"),
        "volumeNumber": (release_plan or {}).get("volumeNumber"),
        "chapterNumber": (release_plan or {}).get("chapterNumber"),
    }
    version = normalize_version(
        {
            "id": f"ver-{uuid.uuid4().hex[:8]}",
            "spaceId": space["id"],
            "kind": "formal_snapshot",
            "summary": f"确认候选变更 {change_set_id}",
            "sourceChangeSetIds": [change_set_id],
        }
    )
    payload["versions"].append(version)

    accepted = 0
    selected_set = set(selected_ids)
    for obj in payload["objects"]:
        if obj.get("spaceId") != space["id"] or obj.get("id") not in selected_set:
            continue
        if obj.get("status") != "candidate":
            continue
        obj["status"] = "formal"
        obj["effectiveScope"] = release_scope_from_plan(plan)
        obj["versionRef"] = version["id"]
        obj["updatedAt"] = now()
        payload["memories"].append(create_memory_from_object(space["id"], obj, version["id"]))
        apply_formal_object_to_project(project, obj)
        accepted += 1

    if accepted == 0:
        raise ValueError("所选候选对象没有可确认的新增内容。")

    remaining = 0
    for object_id in change_set.get("objectIds", []):
        try:
            obj = find_item(payload["objects"], object_id, "story object")
        except KeyError:
            continue
        if obj.get("status") == "candidate":
            remaining += 1

    change_set["releasePlan"] = plan
    change_set["status"] = "accepted" if remaining == 0 else "partially_accepted"
    change_set["updatedAt"] = now()
    project["updatedAt"] = now()
    refresh_space_indexes(payload, space["id"])
    return build_kernel_bundle(payload, project)


def delete_project_with_kernel(payload: dict, project_id: str) -> dict:
    project = find_project_in_payload(payload, project_id)
    space_id = project.get("spaceId") or f"space-{project_id}"
    removed = delete_project(payload["projects"], project_id)
    payload["spaces"] = [item for item in payload["spaces"] if item.get("id") != space_id]
    payload["conversations"] = [
        item for item in payload["conversations"] if item.get("spaceId") != space_id
    ]
    payload["objects"] = [item for item in payload["objects"] if item.get("spaceId") != space_id]
    payload["candidate_change_sets"] = [
        item for item in payload["candidate_change_sets"] if item.get("spaceId") != space_id
    ]
    payload["versions"] = [item for item in payload["versions"] if item.get("spaceId") != space_id]
    payload["memories"] = [
        item for item in payload["memories"] if (item.get("scope") or {}).get("spaceId") != space_id
    ]
    payload["reference_assets"] = [
        item for item in payload["reference_assets"] if (item.get("ownerScope") or {}).get("spaceId") != space_id
    ]
    payload["capability_features"] = [
        item
        for item in payload["capability_features"]
        if (item.get("originScope") or {}).get("spaceId") != space_id
    ]
    return removed


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


def run_reference_analysis(project_id: str) -> None:
    job_id = ""
    source: dict = {}
    mode = "project_assisted_analysis"
    role = "parallel"
    try:
        with LOCK:
            payload = load_payload()
            project = find_project_in_payload(payload, project_id)
            current_run = deepcopy((project.get("referenceAnalysis") or {}).get("currentRun") or {})
            execution = reference_analysis_execution(payload)
            project_snapshot = deepcopy(project)

        options = current_run.get("options") or {}
        job_id = str(current_run.get("jobId") or options.get("jobId") or "").strip()
        source = deepcopy(options.get("source") or {})
        notes = str(options.get("notes", "")).strip()
        mode = str(options.get("mode", "project_assisted_analysis")).strip()
        role = str(options.get("role", "parallel")).strip()
        if not source:
            raise ValueError("参考拆解任务缺少来源信息。")

        def push_progress(progress: dict) -> None:
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda item: update_reference_analysis_state(
                        item,
                        "running",
                        job_id=job_id,
                        phase=str(progress.get("phase") or "chunk_analysis"),
                        message=str(progress.get("message") or ""),
                        source_title=source.get("title", ""),
                        mode=mode,
                        role=role,
                        total_chunks=(
                            int(progress["totalChunks"])
                            if progress.get("totalChunks") is not None
                            else None
                        ),
                        analyzed_chunks=(
                            int(progress["analyzedChunkCount"])
                            if progress.get("analyzedChunkCount") is not None
                            else None
                        ),
                        completed_chunks=(
                            int(progress["completedChunks"])
                            if progress.get("completedChunks") is not None
                            else None
                        ),
                        current_chunk_index=(
                            int(progress["currentChunkIndex"])
                            if progress.get("currentChunkIndex") is not None
                            else None
                        ),
                        options={"jobId": job_id},
                    ),
                )
            )

        push_progress({"phase": "loading_source", "message": "正在读取正文..."})
        loaded_source_text = load_reference_source_text(source)
        analysis = extract_reference_asset_blueprints(
            project_snapshot,
            source,
            notes,
            loaded_source_text,
            execution=execution,
            progress_callback=push_progress,
        )
        mutate_payload(
            lambda data: commit_reference_asset_analysis(
                data,
                project_id,
                source,
                notes,
                mode,
                role,
                analysis,
                job_id=job_id,
            )
        )
    except Exception as exc:
        print(f"[reference analysis] background job failed: {exc}")
        try:
            mutate_projects(
                lambda projects: mutate_one_project(
                    projects,
                    project_id,
                    lambda item: update_reference_analysis_state(
                        item,
                        "failed",
                        job_id=job_id or None,
                        phase="failed",
                        message="参考作品拆解失败。",
                        error=str(exc),
                        source_title=source.get("title", ""),
                        mode=mode,
                        role=role,
                        current_chunk_index=None,
                        options={"jobId": job_id} if job_id else {},
                    ),
                )
            )
        except Exception as state_exc:
            print(f"[reference analysis] failed to persist failure state: {state_exc}")
    finally:
        unregister_reference_analysis_runner(project_id)
        if job_id:
            shutil.rmtree(reference_job_dir(project_id, job_id), ignore_errors=True)


def ensure_reference_analysis_runner(project_id: str) -> None:
    if active_reference_analysis_runner_exists(project_id):
        return
    worker = threading.Thread(
        target=run_reference_analysis,
        args=(project_id,),
        daemon=True,
        name=f"reference-analysis-{project_id}",
    )
    register_reference_analysis_runner(project_id, worker)
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

        if path == "/api/system-settings":
            self.send_json(system_settings_payload(load_payload()))
            return

        if path == "/api/author-space":
            self.send_json(author_space_payload(load_payload()))
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
                if len(parts) == 4 and parts[3] == "kernel":
                    payload = load_payload()
                    self.send_json({"kernel": kernel_bundle_for_project(payload, project_id)})
                    return
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
            genre = payload.get("genre", "").strip() or "待定题材"
            hook = payload.get("hook", "").strip() or "待构思卖点"
            if not title:
                self.send_json(
                    {"error": "title is required"},
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

                # Route: POST /api/projects/{id}/kernel/ideate
                if len(parts) == 5 and parts[3] == "kernel" and parts[4] == "ideate":
                    payload = self.read_json()
                    message = str(payload.get("message", "")).strip()
                    if not message:
                        self.send_json({"error": "message is required"}, HTTPStatus.BAD_REQUEST)
                        return
                    kernel = mutate_payload(
                        lambda data: ideate_project_kernel(data, project_id, message)
                    )
                    self.send_json({"kernel": kernel})
                    return

                # Route: POST /api/projects/{id}/kernel/chat
                if len(parts) == 5 and parts[3] == "kernel" and parts[4] == "chat":
                    payload = self.read_json()
                    message = str(payload.get("message", "")).strip()
                    if not message:
                        self.send_json({"error": "message is required"}, HTTPStatus.BAD_REQUEST)
                        return
                    kernel = mutate_payload(
                        lambda data: chat_project_kernel(data, project_id, message)
                    )
                    self.send_json({"kernel": kernel, "project": get_project(project_id)})
                    return

                # Route: POST /api/projects/{id}/kernel/reference-assets/analyze
                if len(parts) == 6 and parts[3] == "kernel" and parts[4] == "reference-assets" and parts[5] == "analyze":
                    payload = self.read_json()
                    mutate_payload(
                        lambda data: enqueue_reference_asset_analysis(
                            data,
                            project_id,
                            str(payload.get("sourceType", "local_file")).strip(),
                            str(payload.get("sourcePath", "")).strip(),
                            str(payload.get("sourceText", "")),
                            str(payload.get("sourceLabel", "")).strip(),
                            str(payload.get("sourceUrl", "")).strip(),
                            str(payload.get("sourceTitle", "")).strip(),
                            str(payload.get("notes", "")).strip(),
                            str(payload.get("mode", "project_assisted_analysis")).strip(),
                            str(payload.get("role", "parallel")).strip(),
                        )
                    )
                    ensure_reference_analysis_runner(project_id)
                    project = get_project(project_id)
                    kernel = project.get("kernel") if isinstance(project, dict) else None
                    self.send_json({"kernel": kernel, "project": project})
                    return

                # Route: POST /api/projects/{id}/kernel/capability-features/{feat_id}/promote
                if len(parts) == 7 and parts[3] == "kernel" and parts[4] == "capability-features" and parts[6] == "promote":
                    feature_id = parts[5]
                    kernel = mutate_payload(
                        lambda data: promote_capability_feature_to_author(
                            data,
                            project_id,
                            feature_id,
                        )
                    )
                    self.send_json({"kernel": kernel, "project": get_project(project_id)})
                    return

                # Route: POST /api/projects/{id}/kernel/author-capability-features/{feat_id}/enable
                if len(parts) == 7 and parts[3] == "kernel" and parts[4] == "author-capability-features" and parts[6] == "enable":
                    feature_id = parts[5]
                    kernel = mutate_payload(
                        lambda data: enable_author_capability_feature(
                            data,
                            project_id,
                            feature_id,
                        )
                    )
                    self.send_json({"kernel": kernel, "project": get_project(project_id)})
                    return

                # Route: POST /api/projects/{id}/kernel/candidate-change-sets/{ccs_id}/accept
                if len(parts) == 7 and parts[3] == "kernel" and parts[4] == "candidate-change-sets" and parts[6] == "accept":
                    change_set_id = parts[5]
                    payload = self.read_json()
                    object_ids = payload.get("objectIds")
                    if object_ids is not None and not isinstance(object_ids, list):
                        self.send_json({"error": "objectIds must be a list"}, HTTPStatus.BAD_REQUEST)
                        return
                    kernel = mutate_payload(
                        lambda data: accept_project_kernel_candidates(
                            data,
                            project_id,
                            change_set_id,
                            object_ids,
                            payload.get("releasePlan"),
                        )
                    )
                    self.send_json({"kernel": kernel, "project": get_project(project_id)})
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

        if path == "/api/system-settings":
            try:
                incoming = self.read_json()
                payload = mutate_payload(
                    lambda current: save_system_settings_to_payload(current, incoming)
                )
                self.send_json(payload)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/author-space":
            try:
                incoming = self.read_json()
                payload = mutate_payload(
                    lambda current: save_author_space_to_payload(current, incoming)
                )
                self.send_json(payload)
            except ValueError as exc:
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
            project = mutate_payload(
                lambda payload: delete_project_with_kernel(payload, project_id)
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
