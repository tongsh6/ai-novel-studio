import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { UICardData as UICard } from "../../components/UICards";
import { CandidateSetCard, DefaultCard } from "../../components/UICards";
import { CARD } from "../copy";
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
      actions: [
        {
          action_id: "accept-local",
          action_type: "accept",
          label: "不应渲染",
          target_ref: "artifact-1",
          enabled: true,
        },
      ],
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
      actions: [
        {
          action_id: "accept-local",
          action_type: "accept",
          label: "不应渲染",
          target_ref: "artifact-1",
          enabled: true,
        },
      ],
    } as unknown as UICard;

    const html = renderToStaticMarkup(React.createElement(CandidateSetCard, { card }));

    expect(html).toContain("雨夜霓虹下的 28% 生存率");
    expect(html).toContain("AI 在视网膜边缘弹出红色警告");
    expect(html).toContain("创作依据：直接呈现生死决策瞬间。");
    expect(html).not.toContain("不应渲染");
    expect(html).not.toContain("accept-local");
  });

  it("multi-item adoption starts unselected and keeps actions disabled until one item is chosen", () => {
    const card = {
      card_type: "candidate_set",
      candidate_set_ref: "as-choice",
      title: "角色设定草稿",
      items: [
        { item_id: "character-a", title: "沈砚", body: "冷峻调查者。" },
        { item_id: "character-b", title: "云栖", body: "游离秩序的线人。" },
      ],
    } as UICard;

    const html = renderToStaticMarkup(
      React.createElement(CandidateSetCard, {
        card,
        selectionMode: true,
        selectedItemId: null,
        onSelectItem: () => undefined,
        renderItemActions: (item) =>
          React.createElement(
            "button",
            { "data-target": String(item.item_id) },
            `保存 ${String(item.item_id)}`,
          ),
        renderEmptySelectionActions: React.createElement(
          "button",
          { disabled: true },
          CARD.tentativeArtifact.candidateEmptyAcceptLabel,
        ),
      }),
    );

    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="选择方案 A：沈砚"');
    expect(html).toContain('aria-label="选择方案 B：云栖"');
    expect(html).toContain(CARD.tentativeArtifact.candidateSelectionRequired);
    expect(html).toContain(CARD.tentativeArtifact.candidateEmptyAcceptLabel);
    expect(html).not.toContain("data-target");
  });

  it("multi-item adoption renders only the selected item actions in the shared footer", () => {
    const card = {
      card_type: "candidate_set",
      candidate_set_ref: "as-choice",
      title: "角色设定草稿",
      items: [
        { item_id: "character-a", title: "沈砚", body: "冷峻调查者。" },
        { item_id: "character-b", title: "云栖", body: "游离秩序的线人。" },
      ],
    } as UICard;

    const html = renderToStaticMarkup(
      React.createElement(CandidateSetCard, {
        card,
        selectionMode: true,
        selectedItemId: "character-b",
        onSelectItem: () => undefined,
        renderItemActions: (item) =>
          React.createElement(
            "button",
            { "data-target": String(item.item_id) },
            `保存 ${String(item.item_id)}`,
          ),
      }),
    );

    expect(html).toContain("已选择：方案 B · 云栖");
    expect(html).toContain('data-target="character-b"');
    expect(html).not.toContain('data-target="character-a"');
    expect(html).toContain("checked");
  });

  it("prose candidate_set fallback uses chapter draft language", () => {
    const card = {
      card_type: "candidate_set",
      artifact_type: "prose_fragment",
      items: [
        {
          item_id: "chapter_01",
          title: "第一章：穿越初遇",
          body: "陆明站在茶馆门口，听见城门外马蹄声骤近。",
        },
      ],
    } as UICard;

    const html = renderToStaticMarkup(React.createElement(CandidateSetCard, { card }));

    expect(html).toContain("章节正文草稿");
    expect(html).toContain("保存后会写入章节正文");
    expect(html).not.toContain("待确认的创作材料");
    expect(html).not.toContain("创作素材");
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

  it("reading mode keeps real unnamed titles but hides internal projection ids", () => {
    expect(readingWorkTitle("未命名作品")).toBe("未命名作品");
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
      scenes: [{ title: "", content: "正文" }],
    });
  });

  it("reading mode hides generated scene placeholder titles but keeps meaningful scene titles", () => {
    expect(
      normalizeChapterContentTitle(
        {
          title: "第01章：底层灵气账单",
          scenes: [
            { title: "场景 2", content: "续写正文" },
            { title: "第三场", content: "继续正文" },
            { title: "矿道追击", content: "有效场景标题正文" },
          ],
        },
        { id: "ch-1", title: "第01章：底层灵气账单", seq: 1, wordCount: 0, status: null },
      ).scenes,
    ).toEqual([
      { title: "", content: "续写正文" },
      { title: "", content: "继续正文" },
      { title: "矿道追击", content: "有效场景标题正文" },
    ]);
  });
});
