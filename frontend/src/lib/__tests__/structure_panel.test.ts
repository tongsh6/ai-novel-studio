import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StructurePanel } from "../../components/StructurePanel";
import type { ArtifactEntry } from "../../components/WorkspaceChat";
import { STRUCTURE_PANEL } from "../copy";
import { useAppStore } from "../store";

const artifact: ArtifactEntry = {
  artifact_id: "tas-1",
  artifact_type: "character_seed",
  adoption_status: "PENDING",
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
  adoption_status: "PENDING",
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
  it("keeps character creation as a role-design intent instead of foreshadowing copy", () => {
    expect(STRUCTURE_PANEL.createCharacterPrompt).toContain("角色");
    expect(STRUCTURE_PANEL.createCharacterPrompt).not.toContain("伏笔");
  });

  it("uses concrete archive action labels instead of the generic operation entry", () => {
    expect(STRUCTURE_PANEL.startPlanning).toBe("规划卷章结构");
    expect(STRUCTURE_PANEL.panelActions.outline.label).toBe("发起大纲调整");
    expect(STRUCTURE_PANEL.panelActions.outline.hint).toContain("对话区");
    expect(STRUCTURE_PANEL.panelActions.overview.label).toBe("发起综合修订");
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
    expect(html).toContain("发起综合修订");
    expect(html).toContain("跨模块调整，转到对话区拆分确认。");
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
