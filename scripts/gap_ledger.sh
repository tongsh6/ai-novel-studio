#!/usr/bin/env bash
# 原差距表是状态源；NEXT 只排期，移出 NEXT 不等于销账。
# 更新规则见 tasks/README.md；快照为派生产物，缺源/未知状态时不得覆盖。
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PYEOF'
import datetime
import json
import os
import re
import tempfile
from pathlib import Path

open_gaps = {}
source_ids = set()


def collect(path, pattern, prefix, closed):
    seen = set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        match = re.match(pattern, line)
        if not match:
            continue
        key = prefix + match.group(1)
        if key in seen:
            raise ValueError(f"重复差距编号: {key}")
        seen.add(key)
        if not closed(line):
            open_gaps[key] = re.sub(r"~~[^~]*~~", "", match.group(2)).strip()[:60]
    if not seen:
        raise ValueError(f"缺少差距源表: {path}")
    source_ids.update(seen)


collect(
    "docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md",
    r"\|\s*(G\d+)\s*\|\s*([^|]+)\|", "VS-00D:",
    lambda line: "~~" in line,
)
collect(
    "docs/design/08-novel-element-model.md",
    r"\|\s*(NEM-GAP-\d+)\s*\|\s*([^|]+)\|", "08:",
    lambda line: "已关闭" in line and "部分关闭" not in line,
)

source = Path("tasks/slices/VS00D-G-GAP-RECONCILIATION.md")
text = source.read_text(encoding="utf-8")
heading = "## 6. 开放债务状态"
parts = re.split(r"(?m)^" + re.escape(heading) + r"\s*$", text)
if len(parts) != 2:
    raise ValueError(f"缺少或重复债务状态节: {source}")
body = re.split(r"(?m)^## ", parts[1], maxsplit=1)[0]
seen = set()
for line in body.splitlines():
    if not re.match(r"^\|\s*B\d+\s*\|", line):
        continue
    if not line.rstrip().endswith("|"):
        raise ValueError(f"债务行损坏: {line}")
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if len(cells) != 4 or not all(cells):
        raise ValueError(f"债务行必须为 编号/事项/状态/承接 四列: {line}")
    key, desc, status, _ = cells
    if key in seen:
        raise ValueError(f"重复债务编号: {key}")
    seen.add(key)
    if status not in {"todo", "doing", "blocked", "deferred", "done", "superseded", "cancelled"}:
        raise ValueError(f"未知债务状态: {key}={status}")
    if status not in {"done", "superseded", "cancelled"}:
        open_gaps["B轨:" + key] = re.sub(r"~~[^~]*~~", "", desc).strip()[:60]
if not seen:
    raise ValueError(f"债务源表为空或损坏: {source}；已完成行应保留显式终态")
source_ids.update("B轨:" + key for key in seen)

path = Path("reports/gap-ledger/latest.json")
previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
prev = previous.get("gaps", {})
streak = previous.get("streak", {})
missing_ids = set(prev) - source_ids
if missing_ids:
    raise ValueError("差距源丢失既有编号，须保留显式关闭/转交记录: " + ", ".join(sorted(missing_ids)))
added = [key for key in open_gaps if key not in prev]
closed = [key for key in prev if key not in open_gaps]
new_streak = {
    key: streak.get(key, 0) + 1 if key in prev else 1 for key in open_gaps
}
today = datetime.date.today().isoformat()
snapshot = {"scanned_at": today, "gaps": open_gaps, "streak": new_streak}
# 源读取/验证全部成功才发布；写入失败也保留上一份完整快照。
temporary = None
try:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(snapshot, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    os.replace(temporary, path)
finally:
    if temporary is not None and temporary.exists():
        temporary.unlink()

print(
    f"[gap-ledger] {today} 开放差距 {len(open_gaps)} 项"
    f"（VS-00D {sum(k.startswith('VS-00D:') for k in open_gaps)}"
    f" / NEM-GAP {sum(k.startswith('08:') for k in open_gaps)}"
    f" / B 轨 {sum(k.startswith('B轨:') for k in open_gaps)}）"
)
if added:
    print("[gap-ledger] 新增: " + ", ".join(added))
if closed:
    print("[gap-ledger] 关闭: " + ", ".join(closed))
stale = [(key, count) for key, count in new_streak.items() if count >= 3]
if stale:
    print("[gap-ledger] ⚠ 复核（连续 3+ 次快照仍开放，不代表期间无进展）：")
    for key, count in sorted(stale, key=lambda item: -item[1]):
        print(f"    {key} ×{count}  {open_gaps[key]}")
PYEOF
