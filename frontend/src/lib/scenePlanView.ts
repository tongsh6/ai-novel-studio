// Design: docs/design/ui/43-structure-panel.md §5.0.5（场次计划只读可见）
//
// B11C CP2：把 `get_toc` 投影里的 `plan_direction.scene_plans`（NEM04 三槽 +
// B11C 场级结构八槽）归一成档案「大纲与结构」章卡片可只读渲染的可见行。
// 纯函数：不做网络请求、不写回、不补造缺失字段——缺字段整行不出现，无场次计划
// 返回 null（诚实缺席）；`title` 必填，坏数据整体跳过，避免渲染空场次。
import { STRUCTURE_PANEL } from "./copy";
import type { ScenePlanDto } from "./socket";

export interface ScenePlanRowView {
  key: string;
  /** 行标签（含全角冒号，如「目标：」「因果：」）。 */
  label: string;
  /** 已格式化的可见值；组行内为「子槽：值」以「；」连接。 */
  value: string;
}

export interface ScenePlanItemView {
  key: string;
  /** 「1. 场名」——场次序号取可见顺序（1 起）。 */
  title: string;
  rows: ScenePlanRowView[];
}

export interface ScenePlansView {
  /** 「场次计划（N 场）」 */
  heading: string;
  items: ScenePlanItemView[];
}

type ScenePlanFieldKey =
  | "goal"
  | "agendas"
  | "emotion"
  | "causal"
  | "information"
  | "dialogue"
  | "sensory";

function sceneText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function simpleRow(field: ScenePlanFieldKey, value: string | null): ScenePlanRowView | null {
  if (!value) return null;
  return {
    key: field,
    label: STRUCTURE_PANEL.scenePlans.fieldLabels[field],
    value,
  };
}

// 组行：只收集存在的子槽，缺子槽不拼空洞句式（如只有「阻力」时不补「转折：」）。
function groupRow(field: ScenePlanFieldKey, parts: (string | null)[]): ScenePlanRowView | null {
  const present = parts.filter((part): part is string => part !== null);
  if (present.length === 0) return null;
  return {
    key: field,
    label: STRUCTURE_PANEL.scenePlans.fieldLabels[field],
    value: STRUCTURE_PANEL.scenePlans.partsLine(present),
  };
}

function part(label: string, value: string | null): string | null {
  return value ? `${label}${value}` : null;
}

function scenePlanItem(plan: ScenePlanDto, seq: number): ScenePlanItemView | null {
  const title = sceneText(plan.title);
  if (!title) return null;

  const S = STRUCTURE_PANEL.scenePlans;
  const rows = [
    simpleRow("goal", sceneText(plan.goal)),
    simpleRow("agendas", sceneText(plan.agendas)),
    simpleRow("emotion", sceneText(plan.emotion)),
    groupRow("causal", [
      part(S.partLabels.opposition, sceneText(plan.opposition)),
      part(S.partLabels.turn, sceneText(plan.turn)),
      part(S.partLabels.consequence, sceneText(plan.consequence)),
    ]),
    groupRow("information", [
      part(S.partLabels.reader_learns, sceneText(plan.reader_learns)),
      part(S.partLabels.protagonist_learns, sceneText(plan.protagonist_learns)),
      part(S.partLabels.remains_hidden, sceneText(plan.remains_hidden)),
    ]),
    groupRow("dialogue", [
      part(S.partLabels.surface_topic, sceneText(plan.surface_topic)),
      part(S.partLabels.hidden_conflict, sceneText(plan.hidden_conflict)),
    ]),
    simpleRow("sensory", sceneText(plan.sensory)),
  ].filter((row): row is ScenePlanRowView => row !== null);

  return {
    key: `scene-${seq}`,
    title: S.sceneTitle(seq, title),
    rows,
  };
}

export function toScenePlansView(
  scenePlans: ScenePlanDto[] | null | undefined,
): ScenePlansView | null {
  if (!Array.isArray(scenePlans)) return null;

  const items: ScenePlanItemView[] = [];

  for (const plan of scenePlans) {
    if (!plan || typeof plan !== "object") continue;
    const item = scenePlanItem(plan, items.length + 1);
    if (item) items.push(item);
  }

  if (items.length === 0) return null;

  return {
    heading: STRUCTURE_PANEL.scenePlans.heading(items.length),
    items,
  };
}
