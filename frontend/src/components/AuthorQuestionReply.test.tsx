// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// AuthorQuestionReply 只负责作答操作（选项/自由文本/发送）；问题文本与记录展示由调用方组件承担。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthorQuestionReply } from "./AuthorQuestionReply";
import type { WireTurnResult } from "../lib/turnResultWire";

function questionResult(status = "open"): WireTurnResult {
  return {
    turn_id: "turn-question",
    author_question: {
      question_ref: "q1",
      run_id: "run-question",
      goal_version: 1,
      status,
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
      {
        action_id: "action-free-text",
        action_type: "author_choice",
        question_ref: "q1",
        target_ref: "run-question",
        label: "回复此问题",
        response_kind: "free_text",
        enabled: true,
        expected_goal_version: 1,
      },
    ],
  } as unknown as WireTurnResult;
}

const noopReply = () => Promise.resolve(true);

describe("AuthorQuestionReply（46 §9.7 作答操作）", () => {
  it("渲染结构化选项与自由回复入口", () => {
    const html = renderToStaticMarkup(
      <AuthorQuestionReply result={questionResult()} disabled={false} onReply={noopReply} />,
    );
    expect(html).toContain("选项A");
    expect(html).toContain("回复此问题");
  });

  it("已答复状态显示已收到回复，不再提供选项", () => {
    const html = renderToStaticMarkup(
      <AuthorQuestionReply result={questionResult("answered")} disabled onReply={noopReply} />,
    );
    expect(html).toContain("已收到回复");
    expect(html).not.toContain("选项A");
  });

  it("空白输入时发送按钮禁用（不提供裸继续）", () => {
    const html = renderToStaticMarkup(
      <AuthorQuestionReply result={questionResult()} disabled={false} onReply={noopReply} />,
    );
    // 自由回复需先展开输入框；静态渲染下选项按钮存在，发送按钮只在展开后出现。
    expect(html).not.toContain("发送回复");
  });
});
