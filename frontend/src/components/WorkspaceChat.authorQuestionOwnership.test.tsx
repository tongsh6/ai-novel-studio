// Design: docs/design/ui/46-state-and-feedback.md §9.7（提问正文唯一所有者）
// Render the actual whole workbench, not a hand-rebuilt message composition.
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, TurnResult } from "./WorkspaceChat";

const state = vi.hoisted(() => ({ messages: [] as ChatMessage[], calls: 0, history: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.calls++;
      // Existing hook slots only, no production injection API. The history test
      // asserts the real banner so a changed slot fails rather than silently passing.
      const value =
        index === 0
          ? state.messages
          : index === 25 && state.history
            ? { session_id: "history", title: "历史问题", status: "ARCHIVED" }
            : initial;
      return actual.useState(value);
    },
  };
});
import { WorkspaceChat } from "./WorkspaceChat";
import { upsertAssistantTurnResultMessage } from "../lib/agentRunAnchoring";

function result(
  question: string,
  status: "open" | "answered" | "closed" = "open",
  id = "q1",
): TurnResult {
  return {
    schema_version: "3.0-draft",
    turn_id: "turn-" + id,
    phase: "awaiting_author",
    status: "needs_selection",
    next_action: "waiting_for_author",
    assistant_message: { text: question },
    author_question: {
      question_ref: id,
      run_id: "run-" + id,
      goal_version: 1,
      source_turn_ref: "turn-" + id,
      question,
      options: [],
      provider_call_ref: "provider-" + id,
      status,
    },
    available_actions: [],
  };
}
function render(results: TurnResult[], messages?: ChatMessage[]) {
  state.messages =
    messages ??
    results.map((turnResult) => ({
      role: "assistant",
      text: turnResult.assistant_message?.text ?? "",
      turnId: turnResult.turn_id,
      turnResult,
    }));
  state.calls = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkspaceChat />
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}
beforeEach(() => {
  state.calls = 0;
  state.messages = [];
  state.history = false;
});
describe("WorkspaceChat structured question ownership", () => {
  it.each(["answered", "closed"] as const)(
    "preserves one historical %s question and Why",
    (status) => {
      state.history = true;
      const html = render([result("历史问题正文", status)]);
      expect(html).toContain("历史会话");
      expect(html.split("历史问题正文").length - 1).toBe(1);
      expect(html).toContain(status === "answered" ? "已收到回复" : "此问题已结束");
      expect(html).toContain("为什么");
      expect(html).not.toContain('aria-label="回答当前问题"');
    },
  );
  it("uses semantic ownership even when the generic text differs", () => {
    const value = result("唯一结构化问题");
    value.assistant_message = { text: "不同的旧通用投影" };
    const html = render([value]);
    expect(html).toContain("唯一结构化问题");
    expect(html).not.toContain("不同的旧通用投影");
  });
  it("renders Markdown once and leaves ordinary replies with their own owner", () => {
    const question = result("**问题重点**\n\n- 第一选项\n- 第二选项");
    const ordinary = { ...result("普通正文"), author_question: undefined };
    const html = render([question, ordinary]);
    expect(html).toContain("<strong>问题重点</strong>");
    expect(html).not.toContain("**问题重点**");
    expect(html.split("第一选项").length - 1).toBe(1);
    expect(html).toContain("普通正文");
  });
  it("preserves distinct identities with identical words", () => {
    const html = render([result("相同的问题", "open", "q1"), result("相同的问题", "open", "q2")]);
    expect(html.split("相同的问题").length - 1).toBe(2);
  });
  it("real result upsert replaces a preview and repeated delivery remains one question", () => {
    const value = result("最终结构化提问");
    const preview = {
      ...value,
      author_question: undefined,
      assistant_message: { text: "旧流式预览" },
    };
    let messages = upsertAssistantTurnResultMessage<TurnResult, ChatMessage>([], preview);
    messages = upsertAssistantTurnResultMessage(messages, value);
    messages = upsertAssistantTurnResultMessage(messages, value);
    const html = render([], messages);
    expect(html).not.toContain("旧流式预览");
    expect(html.split("最终结构化提问").length - 1).toBe(1);
  });
  it.each([
    "短问题？",
    "这是超过四十八个字符的完整提问，用于证明下方操作区域不通过截断问题产生第二份正文，作者仍可读到完整问题并选择正确选项。",
  ])("keeps one body with the real bottom operation bar: %s", (text) => {
    const value = result(text);
    value.agent_run = {
      run_id: "run-q1",
      run_mode: "bounded",
      status: "awaiting_author",
      phase: "waiting",
    };
    value.available_actions = [
      {
        action_id: "choice-q1",
        action_type: "author_choice",
        question_ref: "q1",
        target_ref: "run-q1",
        label: "保留秘密",
        response_kind: "choice",
        enabled: true,
        expected_goal_version: 1,
      },
    ] as TurnResult["available_actions"];
    const html = render([value]);
    expect(html.split(text).length - 1).toBe(1);
    expect(html).toContain("需要你决定");
    expect(html).toContain("回答当前问题");
    expect(html).toContain("开始新讨论");
    expect(html.split("保留秘密").length - 1).toBe(1);
    expect(html).toContain("为什么");
  });
  it("renders one complete short question in the actual message composition", () => {
    const text = "请决定保留秘密还是公开真相？";
    const html = render([result(text)]);
    expect(html.split(text).length - 1).toBe(1);
    expect(html).toContain("为什么");
    expect(html).toContain("等待你的回答");
  });
});
