// Design: docs/design/ui/46-state-and-feedback.md §9.7（2026-11-04 修订：等待即回答）
// 消息流记录形态：只显示问题文本与作答状态，回答操作由底部回答面板统一接管。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthorQuestionRecord } from "./AuthorQuestionRecord";

function question(status: string) {
  return {
    question_ref: "q1",
    run_id: "run-question",
    goal_version: 1,
    status,
    question: "这一章按哪个方向写？",
  } as never;
}

describe("AuthorQuestionRecord（消息流记录形态）", () => {
  it("等待回答：显示问题与等待状态，不提供第二套回答操作", () => {
    const html = renderToStaticMarkup(<AuthorQuestionRecord question={question("open")} />);
    expect(html).toContain("这一章按哪个方向写？");
    expect(html).toContain("等待你的回答");
    expect(html).not.toContain("回复此问题");
    expect(html).not.toContain("发送回复");
  });

  it("已回答：显示已收到回复", () => {
    const html = renderToStaticMarkup(<AuthorQuestionRecord question={question("answered")} />);
    expect(html).toContain("已收到回复");
  });

  it("已结束：显示此问题已结束", () => {
    const html = renderToStaticMarkup(<AuthorQuestionRecord question={question("closed")} />);
    expect(html).toContain("此问题已结束");
  });
});
