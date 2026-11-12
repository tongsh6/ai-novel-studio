#!/usr/bin/env python3
"""Check imported design fixtures and repository navigation, never product execution."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path
from urllib.parse import unquote

sys.dont_write_bytecode = True
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from paths import ROOT, DESIGN, SCHEMAS, CATALOGS, FIXTURES, TOOLS, report_dir


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_links(path: Path):
    for raw in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
        if "://" in raw or raw.startswith(("#", "mailto:")):
            continue
        target = (path.parent / unquote(raw.split("#", 1)[0])).resolve()
        if target.is_dir():
            target = target / "README.md"
        yield raw, target


def navigation(manifest: dict) -> dict:
    """Require every imported file to be reachable, and each new folder indexed."""
    new = {(ROOT / p).resolve() for p in manifest["new_files"]}
    entries = {(ROOT / e["path"]).resolve() for e in manifest["entry_edits"]}
    markdown = {p for p in new | entries if p.suffix == ".md"}
    graph = {}; count = 0
    for p in markdown:
        if not p.is_file():
            raise ValueError(f"Missing navigation page: {p.relative_to(ROOT)}")
        edges = []
        # Existing files may have unrelated historical links. Check new pages in full;
        # new entry text is checked separately without pretending to audit the entire repo.
        if p in entries and p not in new:
            edit = next(e for e in manifest["entry_edits"] if ROOT / e["path"] == p)
            text = edit.get("addition", "")
            assert text in p.read_text(encoding="utf-8"), edit["path"]
            targets = []
            for raw in re.findall(r"\]\(([^)]+)\)", text):
                if "://" not in raw and not raw.startswith("#"):
                    dest = (p.parent / unquote(raw.split("#", 1)[0])).resolve()
                    targets.append((raw, dest / "README.md" if dest.is_dir() else dest))
        else:
            targets = list(local_links(p))
        for raw, dest in targets:
            count += 1
            if not dest.is_file():
                raise ValueError(f"Broken link: {p.relative_to(ROOT)} -> {raw}")
            edges.append(dest)
        graph[p] = edges
    reached = set(entries)
    queue = list(entries)
    while queue:
        for dest in graph.get(queue.pop(), []):
            if dest not in reached:
                reached.add(dest); queue.append(dest)
    missing = new - reached
    if missing:
        raise ValueError("Orphan files: " + ", ".join(str(p.relative_to(ROOT)) for p in sorted(missing)))
    folders = {p.parent for p in new}
    checked_dirs = 0
    # Only newly introduced directories are subject to complete child enumeration.
    for dirname in manifest["new_directories"]:
        folder = (ROOT / dirname).resolve(); index = folder / "README.md"
        if index not in new:
            raise ValueError(f"New directory lacks README: {dirname}")
        direct = {p for p in new if p.parent == folder and p != index}
        direct |= {p / "README.md" for p in folders if p.parent == folder}
        links = set(graph.get(index, []))
        if not direct <= links:
            raise ValueError(f"Incomplete directory index {dirname}: {direct-links}")
        checked_dirs += 1
    for edit in manifest["entry_edits"]:
        text = (ROOT / edit["path"]).read_text(encoding="utf-8")
        wanted = edit.get("addition", edit.get("replacement"))
        if wanted not in text:
            raise ValueError("Entry edit missing: " + edit["path"])
    return {"status": "PASS", "scope": "imported_files_and_added_navigation_only", "local_links": count,
            "new_files": len(new), "reachable_new_files": len(new & reached),
            "new_directories_indexed": checked_dirs, "entry_points": len(entries)}


def codegen_boundary() -> int:
    source = (ROOT / "frontend/scripts/codegen-schemas.mjs").read_text(encoding="utf-8")
    pattern = r"const files = walk\(schemasRoot\)\.filter\(\(file\) => \{.*?\n\}\);"
    match = re.search(pattern, source, re.S)
    if not match:
        raise ValueError("Cannot locate reviewed codegen exclusion predicate")
    cases = ["foundation/turn_result.json", "author_visible/display_names.json",
             *["model-interaction/" + p.name for p in sorted(SCHEMAS.glob("*.json"))],
             "model-interaction/nested/proposed.json", "foundation/enums/state.json"]
    node = ("const {relative} = require('node:path'); const assert = require('node:assert/strict');\n"
            "const schemasRoot='/fixture'; const samples=" + json.dumps(["/fixture/"+p for p in cases]) + ";\n"
            "const walk = () => samples;\n" + match.group(0) + "\n"
            "assert.deepEqual(files,[samples[0],samples[samples.length-1]]);\n")
    subprocess.run(["node", "-e", node], check=True, cwd=ROOT)
    return len(cases)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", help="A new directory under artifacts/model-contracts/vs00m-design/")
    args = parser.parse_args()
    out = report_dir(args.output_dir)
    if (out / "summary.json").exists():
        raise ValueError("Refusing to overwrite prior summary; choose another output directory.")
    manifest = load(DESIGN / "integration-manifest.json")
    # Integrity assertions are limited to preserved source inputs, not mutable new script files.
    source_checks = 0
    for record in manifest["files"]:
        if record["change"] in ["unchanged", "deduplicated_alias"]:
            assert digest(ROOT / record["repository_path"]) == record["source_sha256"], record["source_path"]
            source_checks += 1
    nav = navigation(manifest)
    (out / "navigation-report.json").write_text(json.dumps(nav, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", ANS_MODEL_PROTOCOL_REPORT_DIR=str(out))
    for script, options in [("verify.py", []), ("project_example.py", ["--export"])]:
        subprocess.run([sys.executable, str(TOOLS / script), *options], check=True, cwd=ROOT, env=env)
    schemas = [load(p) for p in SCHEMAS.glob("*.json")]
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
    groups = {"requests":"request", "responses":"model-response", "tool_results":"tool-result",
              "validations":"validation", "outcomes":"application-outcome", "author_actions":"author-action", "events":"provider-event"}
    wrappers = 0
    for path in sorted((FIXTURES / "exchanges").glob("*.json")):
        case = load(path)
        for key, name in groups.items():
            validator = Draft202012Validator(load(SCHEMAS / (name+".schema.json")), registry=registry, format_checker=FormatChecker())
            for obj in case[key]:
                validator.validate(obj); wrappers += 1
    for path in (out / "wire").glob("*.json"):
        assert path.read_bytes() == (FIXTURES / "wire" / path.name).read_bytes(), path.name
    wire_count = len(list((out / "wire").glob("*.json")))
    assert wire_count == len(list((FIXTURES / "wire").glob("*.json")))
    main_case = load(FIXTURES / "exchanges/05-full-local-revision.json")
    for name, field in [("request.json", "requests"), ("model-response.json", "responses"), ("application-outcome.json", "outcomes")]:
        assert load(FIXTURES / "read-first" / name) == main_case[field][0], name
    expected_sha = digest(FIXTURES / "read-first/applied-local-revision.txt")
    for name in ["28-author-adoption", "29-full-delegation"]:
        assert expected_sha == load(FIXTURES / ("exchanges/"+name+".json"))["outcomes"][0]["canon"]["after_versions"][0]["sha256"]
    dictionary = load(CATALOGS / "field-dictionary.json")
    for entry in dictionary["entries"]:
        assert entry["field_path"] and entry["source"] and entry["owner"] and entry["meaning"]
    assert len(load(CATALOGS / "novel-elements.json")["elements"]) == 37
    report = load(out / "report.json"); wire = load(out / "provider-projection-report.json")
    result = {"status":"PASS", "scope":"offline_design_review_and_packaging_only",
              "source_commit":report["source_commit"], "integration_base_commit":manifest["integration_base_commit"],
              "python":platform.python_version(), "jsonschema":version("jsonschema"), "referencing":version("referencing"),
              "schema_files":len(schemas), "positive_scenarios":report["summary"]["positive_cases"],
              "negative_scenarios_rejected":report["summary"]["negative_cases"], "wrapper_schema_instances":wrappers,
              "provider_mapping_checks":wire["tests"], "wire_fixtures_unchanged":wire_count,
              "source_integrity_checks":source_checks, "navigation":nav, "codegen_predicate_cases":codegen_boundary(),
              "latest_contract_alignment_claimed":False, "production_or_full_repo_gates_run":False,
              "not_verified":report["not_verified"] + ["最新 VS-00M §6.1 全量对齐", "完整仓库门禁与前端 codegen"]}
    (out / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2)); print("Evidence directory:", out.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
