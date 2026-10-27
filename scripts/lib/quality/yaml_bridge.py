#!/usr/bin/env python3
"""Standard-YAML bridge for quality acceptance manifests (B41 CP1).

Single responsibility: parse YAML files with a *standard* parser (PyYAML) and
emit a JSON bundle for the Node-side semantic validator. It deliberately does
no project-specific validation, so the Node module
(``scripts/lib/quality/manifest.mjs``) stays the single source of manifest
rules while YAML syntax/duplicate-key semantics come from a real parser.

Protocol
--------
stdin  : {"root": "<project root>", "paths": ["quality/acceptance/scenarios.yml", ...]}
stdout : {"ok": bool, "python": "3.x", "pyyaml": "6.0.3", "files": [
            {"path": "...", "ok": true, "sha256": "...", "data": <JSON value>},
            {"path": "...", "ok": false, "sha256": "...", "error": "...", "line": 12, "column": 5}
         ]}
exit   : 0 when the bundle was produced (per-file failures are data);
         2 when the request or the Python/PyYAML environment is unusable.

Duplicate keys are rejected (PyYAML's SafeLoader silently keeps the last
one), including duplicates introduced through merge keys, because a manifest
with two ``tier:`` keys is ambiguous evidence.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - environment failure path
    sys.stderr.write(
        "PyYAML is required for quality manifest parsing. "
        "Install with: python3 -m pip install 'pyyaml==6.0.3'\n"
    )
    sys.exit(2)


class StrictSafeLoader(yaml.SafeLoader):
    """SafeLoader that rejects duplicate mapping keys."""


def _construct_mapping(loader: "StrictSafeLoader", node, deep: bool = False) -> dict:
    loader.flatten_mapping(node)
    mapping: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            hash(key)
        except TypeError:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found unhashable key",
                key_node.start_mark,
            )
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping
)


def _jsonable(value, seen: set) -> object:
    """Convert YAML values into JSON-safe values without losing information."""
    if isinstance(value, dict):
        marker = id(value)
        if marker in seen:
            raise ValueError("YAML alias cycle cannot be represented as JSON")
        seen.add(marker)
        try:
            return {str(k): _jsonable(v, seen) for k, v in value.items()}
        finally:
            seen.discard(marker)
    if isinstance(value, (list, tuple)):
        marker = id(value)
        if marker in seen:
            raise ValueError("YAML alias cycle cannot be represented as JSON")
        seen.add(marker)
        try:
            return [_jsonable(item, seen) for item in value]
        finally:
            seen.discard(marker)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float, str)):
        return value
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, set):
        return sorted(str(item) for item in value)
    return str(value)


def _parse_file(path: str) -> dict:
    record: dict = {"path": path}
    try:
        with open(path, "rb") as handle:
            raw = handle.read()
    except OSError as exc:
        record.update({"ok": False, "error": f"cannot read file: {exc}", "line": None, "column": None})
        return record

    record["sha256"] = hashlib.sha256(raw).hexdigest()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        record.update({"ok": False, "error": f"not valid UTF-8: {exc}", "line": None, "column": None})
        return record

    try:
        documents = list(yaml.load_all(text, Loader=StrictSafeLoader))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        problem = getattr(exc, "problem", None) or str(exc).splitlines()[0]
        context = getattr(exc, "context", None)
        message = f"{problem}" if not context else f"{context}: {problem}"
        record.update(
            {
                "ok": False,
                "error": message,
                "line": (mark.line + 1) if mark is not None else None,
                "column": (mark.column + 1) if mark is not None else None,
            }
        )
        return record
    except ValueError as exc:  # unhashable YAML keys surface from constructors
        record.update({"ok": False, "error": str(exc), "line": None, "column": None})
        return record

    if len(documents) != 1:
        record.update(
            {
                "ok": False,
                "error": f"expected exactly one YAML document, found {len(documents)}",
                "line": None,
                "column": None,
            }
        )
        return record

    try:
        record["data"] = _jsonable(documents[0], set())
    except ValueError as exc:
        record.update({"ok": False, "error": str(exc), "line": None, "column": None})
        return record

    record["ok"] = True
    return record


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.stderr.write("yaml_bridge: expected a JSON request on stdin\n")
        return 2
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"yaml_bridge: invalid JSON request: {exc}\n")
        return 2

    root = str(request.get("root") or "").strip()
    paths = request.get("paths")
    if not paths or not isinstance(paths, list):
        sys.stderr.write("yaml_bridge: request.paths must be a non-empty list\n")
        return 2

    import os

    records = []
    for entry in paths:
        rel = str(entry)
        absolute = rel if os.path.isabs(rel) else os.path.join(root, rel) if root else rel
        record = _parse_file(absolute)
        record["path"] = rel
        records.append(record)

    payload = {
        "ok": True,
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "pyyaml": getattr(yaml, "__version__", "unknown"),
        "files": records,
    }
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
