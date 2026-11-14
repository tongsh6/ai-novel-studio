#!/usr/bin/env bash
# B84 A4：验收 artifact 固定路径覆盖前的证据归档 owner。
#
# 固定路径（如 artifacts/slice-verify/<slice-id>）仍供下游 quality_accept/summary
# 读取；覆盖前先把上一批目录移到同根 `.history/` 下，避免直接删除证据。只接受位于
# 指定 artifacts 根内的路径；不存在时不做任何事；移动作业失败返回非零，调用方不得
# 静默吞掉（退出失败与"无需归档"是不同事实）。
#
# 用法：novel_artifact_archive <artifact_dir> <artifacts_root>
novel_artifact_archive() {
  local dir="${1:-}"
  local root="${2:-}"
  if [[ -z "$dir" || -z "$root" ]]; then
    echo "novel_artifact_archive: 缺少 artifact_dir/artifacts_root" >&2
    return 64
  fi
  if [[ "$dir" != "$root/"* ]]; then
    echo "novel_artifact_archive: 路径越界（必须位于 ${root}/ 下）: $dir" >&2
    return 65
  fi
  [[ -e "$dir" ]] || return 0

  local history="$root/.history"
  mkdir -p "$history" || return 1
  local name stamp target
  name="$(basename "$dir")"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$history/${name}-${stamp}-$$"
  mv "$dir" "$target" || return 1
  echo "[artifact-history] archived $dir -> $target"
  return 0
}
