// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// 回答上下文提示条：问题 + 结构化选项 chips + 显式「开始新讨论」；输入由主 composer 承担。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentRunAnswerPrompt } from "./AgentRunAnswerPrompt";
import type { WireTurnResult } from "../lib/turnResultWire";

function questionResult(withFreeText = true): WireTurnResult {
  const actions: unknown[] = [
    {
      action_id: "action-choice-a",
      action_type: "author_choice",
      question_ref: "q1",
      target_ref: "run-question",
      label: "选项A",
      response_kind: "choice",
      enabled: true,
      expected_goal_version: 1,
    },
  ];
  if (withFreeText) {
    actions.push({
      action_id: "action-free-text",
      action_type: "author_choice",
      question_ref: "q1",
      target_ref: "run-question",
      label: "回复此问题",
      response_kind: "free_text",
      enabled: true,
      expected_goal_version: 1,
    });
  }
  return {
    turn_id: "turn-question",
    author_question: {
      question_ref: "q1",
      run_id: "run-question",
      goal_version: 1,
      status: "open",
      question: "这一章按哪个方向写？",
    },
    available_actions: actions,
  } as unknown as WireTurnResult;
}

describe("AgentRunAnswerPrompt（回答上下文提示条）", () => {
  it("显示问题、选项 chips 与「开始新讨论」显式入口", () => {
    const html = renderToStaticMarkup(
      <AgentRunAnswerPrompt
        result={questionResult()}
        disabled={false}
        onAnswer={() => {}}
        onStartNewDiscussion={() => {}}
        onAbandon={() => {}}
      />,
    );
    expect(html).toContain("需要你决定");
    expect(html).toContain("这一章按哪个方向写？");
    expect(html).toContain("选项A");
    expect(html).toContain("开始新讨论");
    expect(html).toContain("回答后当前任务继续");
    expect(html).toContain("放弃此问题");
  });

  it("等待时长：显示已等待分钟数", () => {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <AgentRunAnswerPrompt
        result={questionResult()}
        disabled={false}
        waitingSince={since}
        onAnswer={() => {}}
        onStartNewDiscussion={() => {}}
        onAbandon={() => {}}
      />,
    );
    expect(html).toContain("已等待 5 分钟");
  });

  it("无自由文本授权时提示只能点选项", () => {
    const html = renderToStaticMarkup(
      <AgentRunAnswerPrompt
        result={questionResult(false)}
        disabled={false}
        onAnswer={() => {}}
        onStartNewDiscussion={() => {}}
        onAbandon={() => {}}
      />,
    );
    expect(html).toContain("请选择上方选项继续");
    expect(html).not.toContain("回复此问题");
  });
});
