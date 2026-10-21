// Design: docs/design/ui/43-structure-panel.md §5.0.6（卷蓝图只读可见）
//
// B11A CP4-lite：把 `get_toc.volumes[].blueprint`（VS-00J §2.1 的 string-keyed map）
// 归一成档案「大纲与结构」卷头下只读渲染的可见行。纯函数：不做网络请求、不写回、
// 不补造缺失字段——缺字段整行不出现，无可显示内容的蓝图返回 null（诚实缺席）。
// 卷蓝图只是设计态（I-VOL-8），这里不产生任何 author_action。
import { STRUCTURE_PANEL } from "./copy";
import type { VolumeBlueprintDto } from "./socket";

export interface VolumeBlueprintRowView {
  key: string;
  /** 行标签（含全角冒号，如「目标冲突：」「支线：」）。 */
  label: string;
  /** 已格式化的可见值；组行内为「子槽：值」以「；」连接。 */
  value: string;
}

export interface VolumeBlueprintView {
  /** 「卷蓝图」 */
  heading: string;
  /** 三态徽标（含括号，如「【已确认】」）；状态缺失或未知时省略。 */
  statusLabel?: string;
  rows: VolumeBlueprintRowView[];
}

type VolumeBlueprintFieldKey =
  | "goal_conflict"
  | "arc_stage"
  | "map_boundary"
  | "subplots"
  | "pacing"
  | "new_elements";

function blueprintText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function simpleRow(
  field: VolumeBlueprintFieldKey,
  value: string | null,
): VolumeBlueprintRowView | null {
  if (!value) return null;
  return {
    key: field,
    label: STRUCTURE_PANEL.volumeBlueprint.fieldLabels[field],
    value,
  };
}

// 组行：只收集存在的子槽，缺子槽不拼空洞句式（如只有「启动」时不补「推进：」）。
function groupRow(
  field: VolumeBlueprintFieldKey,
  parts: (string | null)[],
): VolumeBlueprintRowView | null {
  const present = parts.filter((part): part is string => part !== null);
  if (present.length === 0) return null;
  return {
    key: field,
    label: STRUCTURE_PANEL.volumeBlueprint.fieldLabels[field],
    value: STRUCTURE_PANEL.volumeBlueprint.partsLine(present),
  };
}

function part(label: string, value: string | null): string | null {
  return value ? `${label}${value}` : null;
}

function statusLabel(blueprint: VolumeBlueprintDto): string | undefined {
  const raw = blueprintText(blueprint.status);
  if (!raw) return undefined;
  // 未知状态不显示：不把内部枚举值直接暴露给作者（40 §3.1）。
  return STRUCTURE_PANEL.volumeBlueprint.statusLabels[raw];
}

export function toVolumeBlueprintView(
  blueprint: VolumeBlueprintDto | null | undefined,
): VolumeBlueprintView | null {
  if (!blueprint || typeof blueprint !== "object") return null;

  const B = STRUCTURE_PANEL.volumeBlueprint;
  const rows = [
    simpleRow("goal_conflict", blueprintText(blueprint.goal_conflict)),
    simpleRow("arc_stage", blueprintText(blueprint.arc_stage)),
    simpleRow("map_boundary", blueprintText(blueprint.map_boundary)),
    groupRow("subplots", [
      part(B.partLabels.subplots_start, blueprintText(blueprint.subplots_start)),
      part(B.partLabels.subplots_advance, blueprintText(blueprint.subplots_advance)),
      part(B.partLabels.subplots_close, blueprintText(blueprint.subplots_close)),
    ]),
    groupRow("pacing", [
      part(B.partLabels.climaxes, blueprintText(blueprint.climaxes)),
      part(B.partLabels.payoff_density, blueprintText(blueprint.payoff_density)),
      part(B.partLabels.buffers, blueprintText(blueprint.buffers)),
    ]),
    groupRow("new_elements", [
      part(B.partLabels.new_characters, blueprintText(blueprint.new_characters)),
      part(B.partLabels.new_settings, blueprintText(blueprint.new_settings)),
      part(B.partLabels.new_maps, blueprintText(blueprint.new_maps)),
    ]),
  ].filter((row): row is VolumeBlueprintRowView => row !== null);

  // 只有 status/source_ref 等元数据、没有任何内容槽时整块不渲染：块承载的是
  // 「这一卷要解决什么」，没有内容就不假装有蓝图（诚实缺席）。
  if (rows.length === 0) return null;

  const label = statusLabel(blueprint);

  return {
    heading: B.heading,
    ...(label ? { statusLabel: label } : {}),
    rows,
  };
}
