import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  UICardData as UICard,
} from "../../components/UICards";
import { CandidateSetCard, DefaultCard } from "../../components/UICards";
import {
  adoptionDecisionCopy,
  adoptionDecisionFollowUpAction,
  OPEN_READING_MODE_ACTION_ID,
} from "../adoptionDecision";
import {
  normalizeChapterContentTitle,
  normalizeReadingToc,
  readingWorkTitle,
} from "../readingProjection";
import { deriveWorkspaceRuntimeState, getPendingAdoptionCount } from "../workspaceRuntimeState";

describe("card type contracts", () => {
  it("candidate_set is a semantic display card without embedded actions", () => {
    const card: UICard = {
      card_type: "candidate_set",
      priority: "normal",
      visibility: "primary",
      title: "待确认的创作材料",
      body: "候选角色设定",
      artifact_refs: ["tas-1"],
    };

    expect(card.card_type).toBe("candidate_set");
    expect("actions" in card).toBe(false);
    expect(card.artifact_refs).toEqual(["tas-1"]);
  });

  it("UICards ignore legacy embedded actions when rendering semantic cards", () => {
    const card = {
      card_type: "candidate_set",
      title: "候选内容",
      body: "候选正文",
      actions: [{
        action_id: "accept-local",
        action_type: "accept",
        label: "不应渲染",
        target_ref: "artifact-1",
        enabled: true,
      }],
    } as unknown as UICard;

    const html = renderToStaticMarkup(React.createElement(DefaultCard, { card }));

    expect(html).toContain("候选内容");
    expect(html).toContain("候选正文");
    expect(html).not.toContain("不应渲染");
    expect(html).not.toContain("accept-local");
  });

  it("candidate_set renders generated item body and rationale without embedded actions", () => {
    const card = {
      card_type: "candidate_set",
      title: "待确认的创作材料",
      body: "这里是一组待确认的创作材料。",
      items: [
        {
          item_id: "scene_01",
          title: "雨夜霓虹下的 28% 生存率",
          body: "AI 在视网膜边缘弹出红色警告：生存率 28%。他只剩三秒决定是否相信算法。",
          rationale: "直接呈现生死决策瞬间。",
        },
      ],
      actions: [{
        action_id: "accept-local",
        action_type: "accept",
        label: "不应渲染",
        target_ref: "artifact-1",
        enabled: true,
      }],
    } as unknown as UICard;

    const html = renderToStaticMarkup(React.createElement(CandidateSetCard, { card }));

    expect(html).toContain("雨夜霓虹下的 28% 生存率");
    expect(html).toContain("AI 在视网膜边缘弹出红色警告");
    expect(html).toContain("创作依据：直接呈现生死决策瞬间。");
    expect(html).not.toContain("不应渲染");
    expect(html).not.toContain("accept-local");
  });

  it("discarded adoption state uses author-facing copy", () => {
    expect(adoptionDecisionCopy("DISCARDED")).toEqual({
      title: "已废弃",
      description: "这条候选稿已从待处理列表移除，未写入作品事实。",
    });
  });

  it("only accepted adoption decisions expose a reading follow-up", () => {
    expect(adoptionDecisionFollowUpAction("ACCEPTED", "prose_fragment")).toEqual({
      action_id: OPEN_READING_MODE_ACTION_ID,
      label: "查看已采纳内容",
    });
    expect(adoptionDecisionFollowUpAction("EDITED_ACCEPTED", "scene_draft")?.action_id).toBe(
      OPEN_READING_MODE_ACTION_ID,
    );
    expect(adoptionDecisionFollowUpAction("ACCEPTED", "character_seed")).toBeNull();
    expect(adoptionDecisionFollowUpAction("DISCARDED", "prose_fragment")).toBeNull();
  });

  it("pending adoption count should be unique by artifact id after resume", () => {
    const state = deriveWorkspaceRuntimeState({
      adoptionState: {
        pending: [
          { artifact_id: "artifact-1" },
          { artifact_id: "artifact-2" },
          { artifact_id: "artifact-1" },
        ],
        resolved: [{ artifact_id: "artifact-2", adoption_status: "ACCEPTED" }],
      },
    });

    expect(state.adoption.pendingArtifactIds).toEqual(["artifact-1"]);
    expect(getPendingAdoptionCount(state)).toBe(1);
  });

  it("reading mode does not expose internal projection ids as author-facing titles", () => {
    expect(readingWorkTitle("未命名作品")).toBe("当前作品");
    expect(readingWorkTitle("作品加载失败")).toBe("当前作品");
    expect(readingWorkTitle("artifact-123")).toBe("当前作品");

    expect(
      normalizeReadingToc({
        volumes: [
          {
            id: "vol-1",
            title: "已采纳内容",
            seq: 1,
            chapters: [{ id: "ch-1", title: "as_15", seq: 1 }],
          },
        ],
      })?.volumes[0].chapters[0].title,
    ).toBe("已采纳片段 1");

    expect(
      normalizeChapterContentTitle(
        { title: "as_15", scenes: [{ title: "as_15", content: "正文" }] },
        { id: "ch-1", title: "已采纳片段 1", seq: 1, wordCount: 0, status: null },
      ),
    ).toEqual({
      title: "已采纳片段 1",
      scenes: [{ title: "已采纳片段 1", content: "正文" }],
    });
  });
});
