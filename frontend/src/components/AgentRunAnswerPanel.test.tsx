// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// 底部输入区接管形态：当前问题 + 作答控制 + 显式「开始新讨论」。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentRunAnswerPanel } from "./AgentRunAnswerPanel";
import type { WireTurnResult } from "../lib/turnResultWire";

function questionResult(): WireTurnResult {
  return {
    turn_id: "turn-question",
    author_question: {
      question_ref: "q1",
      run_id: "run-question",
      goal_version: 1,
      status: "open",
      question: "这一章按哪个方向写？",
    },
    available_actions: [
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
    ],
  } as unknown as WireTurnResult;
}

const noopReply = () => Promise.resolve(true);

describe("AgentRunAnswerPanel（底部回答模式）", () => {
  it("显示回答模式标题、当前问题、作答控制与「开始新讨论」显式入口", () => {
    const html = renderToStaticMarkup(
      <AgentRunAnswerPanel
        result={questionResult()}
        disabled={false}
        onReply={noopReply}
        onStartNewDiscussion={() => {}}
      />,
    );
    expect(html).toContain("回答当前问题");
    expect(html).toContain("这一章按哪个方向写？");
    expect(html).toContain("选项A");
    expect(html).toContain("开始新讨论");
  });
});
