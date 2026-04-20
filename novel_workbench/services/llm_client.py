"""Zero-dependency LLM client for OpenAI-compatible APIs (LM Studio, DeepSeek, etc.)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip() or default


def chat(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.8,
    max_tokens: int | None = None,
) -> str:
    """Send a chat completion request and return the assistant message text."""
    base_url = _env("AI_NOVEL_BASE_URL", "http://localhost:1234/v1").rstrip("/")
    api_key = _env("AI_NOVEL_API_KEY", "lm-studio")
    model = _env("AI_NOVEL_MODEL", "local")
    timeout = int(_env("AI_NOVEL_TIMEOUT", "300"))

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM API error {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"LLM API unreachable: {exc.reason}") from exc

    try:
        return result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"unexpected LLM response shape: {result}") from exc


def chat_json(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Like chat(), but parse the response as JSON. Strips markdown code fences if present."""
    text = chat(messages, temperature=temperature, max_tokens=max_tokens)
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # strip opening fence (```json or ```)
        lines = lines[1:]
        # strip closing fence
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned non-JSON: {text[:300]}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"LLM JSON is not an object: {text[:300]}")
    return parsed
