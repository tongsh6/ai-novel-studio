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

function renderPanel(
  getArtifactActionState: React.ComponentProps<typeof StructurePanel>["getArtifactActionState"],
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
      pendingAdoptions: [artifact],
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

  it("disables pending artifact business buttons when no server action exists", () => {
    const html = renderPanel(() => ({
      enabled: false,
      disabledReason: "当前动作不可用，请刷新或继续对话。",
    }));

    expect(html).toContain("候选角色");
    expect(html).toContain("概览");
    expect(html).toContain("采纳设定");
    expect(html).toContain("提出修改");
    expect(html).toContain("disabled");
    expect(html).toContain("当前动作不可用，请刷新或继续对话。");
  });

  it("renders enabled pending artifact buttons only from available action state", () => {
    const html = renderPanel((_artifact, actionType) => ({
      enabled: actionType === "accept",
    }));

    expect(html).toContain("采纳设定");
    expect(html).toContain("提出修改");
    expect(html).toContain("disabled");
  });
});
