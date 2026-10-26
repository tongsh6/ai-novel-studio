import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StructurePanel } from "../../components/StructurePanel";
import type { ArtifactEntry } from "../../components/WorkspaceChat";
import { STRUCTURE_PANEL } from "../copy";
import {
  isFindingFactInventoryAction,
  reviewFindingDispositionLabel,
} from "../reviewFindingActions";
import { useAppStore } from "../store";

const artifact: ArtifactEntry = {
  artifact_id: "tas-1",
  artifact_type: "character_seed",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_turn_ref: "turn-1",
  payload: {
    title: "候选角色",
    content: "待确认的角色草稿",
  },
};

const outlineArtifact: ArtifactEntry = {
  artifact_id: "outline-1",
  artifact_type: "outline_draft",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_turn_ref: "turn-outline",
  payload: {
    title: "大纲草稿",
    chapter_count: 3,
    items: [
      { title: "第01章：灵气账单", body: "主角发现灵气账单异常。" },
      { title: "第02章：旧服务器", body: "主角找到残缺功法。" },
      { title: "第03章：黑市交易", body: "主角进入黑市。" },
    ],
  },
};

// B28 A2 原生复验证据（T8-archive.ax.txt 第 138–157 行）：档案「大纲与结构 → 待保存大纲」
// 曾把正文草稿候选渲染成「大纲草稿 / 保存到大纲」。正文草稿的保存入口在工作台候选卡
// （candidate_set + available_actions），不在作品档案的待保存区。
const proseDraftArtifact: ArtifactEntry = {
  artifact_id: "as-b28-prose-1",
  artifact_type: "prose_fragment",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_turn_ref: "turn-prose-draft",
  payload: {
    title: "第01章：夜潮正文草稿",
    item_count: 1,
    items: [
      {
        item_id: "chapter_draft_87834280",
        title: "第01章：夜潮",
        body: "沈砚记得很清楚，点灯人第一次点灯时才三十岁，那一年灯楼还没有第七盏灯。",
      },
    ],
  },
};

// 同证据的「指定段落修订稿」：artifact_type 仍是 prose_fragment，按范围修订写在
// payload.modification_scope=target_segments；payload 形状取自 native-transport 帧
// as_mvnwkhjy_3h（B28 A2 真实档案里被误标成大纲草稿的第三份候选）。
const targetSegmentsRevisionArtifact: ArtifactEntry = {
  artifact_id: "as_mvnwkhjy_3h",
  artifact_type: "prose_fragment",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_turn_ref: "turn-target-segments-revision",
  payload: {
    title: "第01章：夜潮（指定段落修订稿）",
    modification_scope: "target_segments",
    item_count: 1,
    target_chapter_ref: "chapter:f35bbe62-f66a-4e77-97f1-2c42abf821d0",
    items: [
      {
        item_id: "chapter_revision_87834281",
        title: "指定段落修订稿",
        body: "沈砚记得很清楚，点灯人第一次点灯时才二十五岁，那一年灯楼还没有第七盏灯。",
        rationale: "确定性 fixture：按已绑定目标段与作者原话输出替换文本。",
      },
    ],
  },
};

const formattingPlanArtifact: ArtifactEntry = {
  artifact_id: "as-b28-formatting-plan-1",
  artifact_type: "prose_formatting_plan",
  adoption_status: "TENTATIVE",
  requires_adoption: true,
  source_turn_ref: "turn-formatting-plan",
  payload: {
    title: "第01章：夜潮（分段方案）",
    items: [{ item_id: "format_plan_1", title: "分段方案", body: "分段方案待采纳。" }],
  },
};

function renderPanel(
  getArtifactActionState: React.ComponentProps<typeof StructurePanel>["getArtifactActionState"],
  pendingAdoptions: ArtifactEntry[] = [artifact],
) {
  useAppStore.setState({
    context: {
      workId: "work-1",
      workTitle: "测试作品",
      assistantDisplayName: null,
      volumeId: null,
      volumeTitle: null,
      chapterId: null,
      chapterTitle: null,
    },
    channel: null,
  });

  return renderToStaticMarkup(
    React.createElement(StructurePanel, {
      isOpen: true,
      onClose: () => undefined,
      pendingAdoptions,
      getArtifactActionState,
      onArtifactAction: () => undefined,
      onStartPlanning: () => undefined,
      onCreateCharacter: () => undefined,
      onDraftChapter: () => undefined,
      onNewForeshadowing: () => undefined,
      onNewRule: () => undefined,
      onNewAction: () => undefined,
    }),
  );
}

describe("StructurePanel available action contract", () => {
  it("turns only the protagonist missing revise_design action into the bound inventory entry", () => {
    const protagonistFinding = {
      rule: "protagonist_undermaterialized",
      ledger: "design_debt",
      signal: "已采纳正文达到 10 章，但角色档案中没有主角。",
      proposed_disposition: "revise_design",
    };
    const otherFinding = {
      ...protagonistFinding,
      rule: "work_skeleton_missing",
    };

    expect(isFindingFactInventoryAction(protagonistFinding, "revise_design")).toBe(true);
    expect(reviewFindingDispositionLabel(protagonistFinding, "revise_design")).toBe("发起盘点");
    expect(isFindingFactInventoryAction(protagonistFinding, "revise_prose")).toBe(false);
    expect(isFindingFactInventoryAction(otherFinding, "revise_design")).toBe(false);
    expect(reviewFindingDispositionLabel(otherFinding, "revise_design")).toBe("修订设定");
  });

  it("keeps character creation as a role-design intent instead of foreshadowing copy", () => {
    expect(STRUCTURE_PANEL.createCharacterPrompt).toContain("角色");
    expect(STRUCTURE_PANEL.createCharacterPrompt).not.toContain("伏笔");
  });

  it("uses concrete archive action labels instead of the generic operation entry", () => {
    expect(STRUCTURE_PANEL.startPlanning).toBe("规划卷章结构");
    expect(STRUCTURE_PANEL.panelActions.outline.label).toBe("发起大纲调整");
    expect(STRUCTURE_PANEL.panelActions.outline.hint).toContain("对话区");
    expect(STRUCTURE_PANEL.panelActions.overview.label).toBe("发起综合修订");
    expect(STRUCTURE_PANEL.factInventory.label).toBe("发起设定盘点");
    expect(STRUCTURE_PANEL.factInventory.hint).toContain("逐项确认后才进入档案");
    expect(STRUCTURE_PANEL.profile.reviseLabel).toBe("提出立项修订");
    expect(STRUCTURE_PANEL.profile.revisePrompt).toContain("待采纳的设定修订草稿");
    expect(STRUCTURE_PANEL.profile.readFailureTitle).toBe("作品档案读取失败");
    expect(STRUCTURE_PANEL.profile.readFailureDescription).toContain("不会编造档案内容");
    expect(STRUCTURE_PANEL.profile.readFailureRetryLabel).toBe("重试读取");
    expect(JSON.stringify(STRUCTURE_PANEL)).not.toContain("发起新操作");
  });

  it("renders the current module action in the panel footer", () => {
    const html = renderPanel(() => ({ enabled: true }), []);

    expect(html).toContain("提出立项修订");
    expect(html).toContain("发起设定盘点");
    expect(html).toContain("发起综合修订");
    expect(html).toContain("从已采纳正文提炼角色、规则与伏笔");
  });

  it("routes pending outline drafts to the outline tab instead of foreshadowing", () => {
    const html = renderPanel(() => ({ enabled: true }), [outlineArtifact]);

    expect(html).toContain("大纲与结构 (1)");
    expect(html).not.toContain("伏笔 (1)");
    expect(html).toContain("待保存大纲");
    expect(html).toContain("共 3 章，包含：第01章：灵气账单、第02章：旧服务器、第03章：黑市交易。");
    expect(html).toContain("保存后进入作品档案的大纲与结构，并作为后续章节生成依据。");
    expect(html).toContain("保存到大纲");
    expect(html).not.toContain("等待审核中的内容");
  });

  // B28 A2 类型边界（a）：prose_fragment 正文草稿不得以「大纲草稿 / 保存到大纲」出现。
  it("keeps prose draft candidates out of the archive pending outline section", () => {
    const html = renderPanel(() => ({ enabled: true }), [proseDraftArtifact]);

    expect(html).not.toContain("待保存大纲");
    expect(html).not.toContain("大纲草稿");
    expect(html).not.toContain("保存到大纲");
    expect(html).not.toContain("第01章：夜潮正文草稿");
    // 没有档案类待采纳项时回到概览，不以大纲 tab 作为默认焦点、不虚报待采纳计数。
    expect(html).toContain("发起综合修订");
    expect(html).not.toContain("发起大纲调整");
    expect(html).not.toContain("大纲与结构 (1)");
  });

  // B28 A2 类型边界（b）：target_segments 修订候选（artifact_type 仍为 prose_fragment）同边界。
  it("keeps target_segments revision candidates out of the archive pending outline section", () => {
    const html = renderPanel(() => ({ enabled: true }), [targetSegmentsRevisionArtifact]);

    expect(html).not.toContain("待保存大纲");
    expect(html).not.toContain("大纲草稿");
    expect(html).not.toContain("保存到大纲");
    expect(html).not.toContain("第01章：夜潮（指定段落修订稿）");
    // 修订候选的保存/放弃/编辑入口在工作台候选卡，档案不提供第二套采纳按钮。
    expect(html).not.toContain("提出修改");
  });

  // B28 类型边界补全：分段方案同样是正文类候选，采纳入口是工作台的「应用分段方案」。
  it("keeps formatting plan candidates out of the archive pending sections", () => {
    const html = renderPanel(() => ({ enabled: true }), [formattingPlanArtifact]);

    expect(html).not.toContain("第01章：夜潮（分段方案）");
    expect(html).not.toContain("待处理内容");
    expect(html).not.toContain("保存到作品档案");
  });

  // B28 A2 类型边界（c）：真正的 outline 草稿仍正常显示与「保存到大纲」动作，
  // 正文类候选混在同一批待采纳里也不会被带进档案。
  it("keeps genuine outline drafts in the outline section while excluding content candidates", () => {
    const html = renderPanel(
      () => ({ enabled: true }),
      [proseDraftArtifact, targetSegmentsRevisionArtifact, formattingPlanArtifact, outlineArtifact],
    );

    expect(html).toContain("大纲与结构 (1)");
    expect(html).toContain("待保存大纲");
    expect(html).toContain("大纲草稿");
    expect(html).toContain("保存到大纲");
    expect(html).toContain("共 3 章，包含：第01章：灵气账单、第02章：旧服务器、第03章：黑市交易。");
    expect(html).not.toContain("第01章：夜潮正文草稿");
    expect(html).not.toContain("第01章：夜潮（指定段落修订稿）");
    expect(html).not.toContain("第01章：夜潮（分段方案）");
  });

  it("disables pending artifact business buttons when no server action exists", () => {
    const html = renderPanel(() => ({
      enabled: false,
      disabledReason: "当前动作不可用，请刷新或继续对话。",
    }));

    expect(html).toContain("候选角色");
    expect(html).toContain("概览");
    expect(html).toContain("保存角色");
    expect(html).toContain("提出修改");
    expect(html).toContain("disabled");
    expect(html).toContain("当前动作不可用，请刷新或继续对话。");
  });

  it("renders enabled pending artifact buttons only from available action state", () => {
    const html = renderPanel((_artifact, actionType) => ({
      enabled: actionType === "accept",
    }));

    expect(html).toContain("保存角色");
    expect(html).toContain("提出修改");
    expect(html).toContain("disabled");
  });
});
