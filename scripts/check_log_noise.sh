#!/usr/bin/env bash
# ADR-0018 §6 日志噪声静态门禁（B13b BB-10，2026-10-23 作者拍板方案 A）。
#
# 作用：生产 lib 中 `Logger.warning` 只允许出现在已审 provider 适配器
# unknown-error 分支（allowlist 17 处）。新增 warning 必须显式登记理由，
# 否则本脚本 exit 1——防「warning 悄悄变成常规路径噪声」回归。
#
# 口径来源：ADR-0018 §6「正常路径不允许 warning/error 级；warning 留给真正
# 需要关注的异常」。运行时 per-base-turn 行数/error 级断言由 Tauri verifier
# 的 log_noise 通用断言承担（scripts/tauri_slice_verify.sh 的 verify_native_slice）。
#
# 用法：bash scripts/check_log_noise.sh
# 退出码：0 = 通过；1 = 出现未豁免 warning 或 allowlist 与实测不符（超出）。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

exec python3 - "$PROJECT_ROOT" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

# 已审 allowlist：文件 -> 允许的 `Logger.warning` 出现次数。
# 全部位于 provider 适配器 unknown-error 分支（网关/HTTP/Anthropic/DeepSeek/LM Studio）。
ALLOWLIST = {
    "apps/novel_agent/lib/novel_agent/provider/deep_seek.ex": 5,
    "apps/novel_agent/lib/novel_agent/provider/lm_studio.ex": 4,
    "apps/novel_agent/lib/novel_agent/provider/gateway.ex": 1,
    "apps/novel_agent/lib/novel_agent/provider/http.ex": 3,
    "apps/novel_agent/lib/novel_agent/provider/anthropic.ex": 4,
}

actual = {}
for app_dir in sorted((root / "apps").glob("*/lib")):
    for path in app_dir.rglob("*.ex"):
        rel = str(path.relative_to(root))
        count = path.read_text(encoding="utf-8").count("Logger.warning")
        if count:
            actual[rel] = count

unexpected = {}
for rel, count in sorted(actual.items()):
    allowed = ALLOWLIST.get(rel, 0)
    if count > allowed:
        unexpected[rel] = (count, allowed)

total = sum(actual.values())
allowed_total = sum(ALLOWLIST.values())

print(f"[log-noise] production lib Logger.warning: {total} 处（allowlist {allowed_total} 处）")

if unexpected:
    for rel, (count, allowed) in unexpected.items():
        if allowed == 0:
            print(f"  ✗ 未登记 warning: {rel} ({count} 处)")
        else:
            print(f"  ✗ warning 超出登记数: {rel} ({count} > {allowed})")
    print(
        "[log-noise] 新增 warning 必须在 scripts/check_log_noise.sh 的 allowlist 登记，"
        "并在 ADR-0018 §6 口径下说明它为什么不是常规路径噪声。"
    )
    sys.exit(1)

reduced = {
    rel: (actual.get(rel, 0), allowed)
    for rel, allowed in ALLOWLIST.items()
    if actual.get(rel, 0) < allowed
}
if reduced:
    for rel, (count, allowed) in reduced.items():
        print(f"  ℹ warning 数量下降: {rel} ({count} < {allowed})——可在下次清理时同步 allowlist")

print("[log-noise] passed")
PY
