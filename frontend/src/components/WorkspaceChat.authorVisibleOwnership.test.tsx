// Design: docs/design/ui/46-state-and-feedback.md §9.4.2 / §9.5 / §9.7（叙述时序与提问正文唯一所有者）
// Design: docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md §6（模型说明与系统结果来源分立）
// Render the actual whole workbench, not a hand-rebuilt message composition.
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, TurnResult } from "./WorkspaceChat";
import type { AgentEventData } from "../lib/socket";

const state = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  events: [] as AgentEventData[],
  calls: 0,
  history: false,
}));
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
            : index === 54
              ? state.events
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
  state.events = [];
  state.history = false;
});
describe("WorkspaceChat author-visible semantic ownership", () => {
  it.each([false, true])(
    "keeps model text and one system notice through repeated delivery, history=%s",
    (history) => {
      state.history = history;
      const value: TurnResult = {
        schema_version: "3.0-draft",
        turn_id: "turn-role-notice",
        phase: "completed",
        status: "completed",
        next_action: "continue",
        assistant_message: { text: "灯笺731：我已核对老沈的身份。\n保留这段说明的原始换行。" },
        ui_cards: [
          {
            card_type: "result_card",
            title: "系统核对结果",
            body: "沈砚（老沈）已是主角，本轮没有修改作品。",
          },
          {
            card_type: "confirmation_card",
            title: "待执行确认",
            body: "此操作还未授权。",
            behavior_ref: "behavior-live",
          },
          {
            card_type: "candidate_set",
            title: "另一个未采纳候选",
            candidate_set_ref: "candidate-live",
            artifact_type: "character_profile_revision",
            items: [{ item_id: "candidate-item", title: "候选项正文", body: "仍需作者选择。" }],
          },
        ],
        available_actions: [],
      };
      let messages = upsertAssistantTurnResultMessage<TurnResult, ChatMessage>([], value);
      messages = upsertAssistantTurnResultMessage(messages, value);
      expect(messages).toHaveLength(1);
      expect(messages[0].turnResult?.assistant_message?.text).toBe(
        "灯笺731：我已核对老沈的身份。\n保留这段说明的原始换行。",
      );
      expect(messages[0].turnResult?.ui_cards).toHaveLength(3);
      const html = render([], messages);
      for (const text of [
        "灯笺731：我已核对老沈的身份。",
        "保留这段说明的原始换行。",
        "系统核对结果",
        "沈砚（老沈）已是主角，本轮没有修改作品。",
      ]) {
        expect(html.split(text).length - 1).toBe(1);
      }
      if (history) {
        expect(html).toContain("历史会话");
        expect(html).not.toContain("待执行确认");
        expect(html).not.toContain("另一个未采纳候选");
        expect(html).not.toContain("候选项正文");
      } else {
        expect(html).toContain("待执行确认");
        expect(html).toContain("候选项正文");
      }
    },
  );
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
  it.each([
    ["question", false],
    ["question", true],
    ["reply", false],
    ["reply", true],
  ] as const)(
    "keeps accepted earlier judgments before one final %s, history=%s",
    (kind, history) => {
      state.history = history;
      const finalText =
        kind === "question"
          ? "请确认要调整哪一位沈砚？"
          : "这些差异足以区分两位沈砚，现有身份保持不变。";
      const value = result(finalText, history ? "answered" : "open", "with-judgments");
      if (kind === "reply") {
        value.author_question = undefined;
        value.phase = "completed";
        value.status = "completed";
        value.next_action = "continue";
      }
      const finalSource = {
        source_type: kind === "question" ? "provider_output_tool_narrative" : "provider_output",
        provider_run_ref: "provider-final",
        provider_call_ref: "call-final",
        provider_output_ref: "provider-final",
        ...(kind === "question"
          ? { tool_call_name: "ask_author", tool_call_narrative_field: "question" }
          : {}),
        source_hash: "final-source-hash",
        narrative_hash: "final-body-hash",
        source_byte_range: { start: 0, length: 42 },
      };
      const earlierSource = {
        ...finalSource,
        source_type: "provider_output_tool_narrative",
        provider_run_ref: "provider-earlier",
        provider_call_ref: "call-earlier",
        provider_output_ref: "provider-earlier",
        tool_call_name: "judgment_decision",
        tool_call_narrative_field: "author_narrative",
        source_hash: "earlier-source-hash",
        narrative_hash: "earlier-body-hash",
      };
      const runId = "run-with-judgments";
      const completed = history || kind === "reply";
      value.agent_run = {
        run_id: runId,
        status: completed ? "completed" : "awaiting_author",
        phase: completed ? "completed" : "awaiting_author",
      };
      value.trace_summary = {
        reply_record: {
          provider_call_ref: "call-final",
          author_narrative_source: finalSource,
        },
      };
      state.events = [
        {
          event_id: "earlier-accepted",
          run_ref: runId,
          sequence: 1,
          event_type: "judgment_decided",
          visibility: "author",
          summary: "已完成判断",
          payload: {
            author_narrative: "我已核对同名角色资料。",
            author_narrative_source: earlierSource,
          },
        },
        {
          event_id: "separate-field",
          run_ref: runId,
          sequence: 2,
          event_type: "plan_revised",
          visibility: "author",
          summary: "已修订安排",
          payload: {
            author_narrative: "这两份角色资料仍有身份差异。",
            author_narrative_source: {
              ...earlierSource,
              tool_call_narrative_field: "reason",
              source_hash: "reason-source-hash",
              narrative_hash: "reason-body-hash",
            },
          },
        },
        {
          event_id: "final-accepted",
          run_ref: runId,
          sequence: 3,
          event_type: "judgment_decided",
          visibility: "author",
          summary: "已接受最终回应",
          payload: { author_narrative: finalText, author_narrative_source: finalSource },
        },
        {
          event_id: "private-attempt",
          run_ref: runId,
          sequence: 4,
          event_type: "provider_progress",
          visibility: "developer",
          summary: "私有判断片段",
          payload: { author_narrative_delta: "不得出现的未校验正文" },
        },
      ];
      let messages = upsertAssistantTurnResultMessage<TurnResult, ChatMessage>([], value);
      messages = upsertAssistantTurnResultMessage(messages, value);
      expect(messages).toHaveLength(1);
      const html = render([], messages);
      for (const text of ["我已核对同名角色资料。", "这两份角色资料仍有身份差异。", finalText]) {
        expect(html.split(text).length - 1).toBe(1);
      }
      expect(html.indexOf("我已核对同名角色资料。")).toBeLessThan(
        html.indexOf("这两份角色资料仍有身份差异。"),
      );
      expect(html.indexOf("这两份角色资料仍有身份差异。")).toBeLessThan(html.indexOf(finalText));
      expect(html).not.toContain("不得出现的未校验正文");
      if (history) expect(html).toContain("历史会话");
    },
  );
  it("renders the accepted question once without changing either original projection", () => {
    const question = "  唯一结构化问题\n\n请确认老沈的身份。\n";
    const value = result(question);
    const html = render([value]);
    expect(value.assistant_message?.text).toBe(question);
    expect(value.author_question?.question).toBe(question);
    expect(html.split("唯一结构化问题").length - 1).toBe(1);
    expect(html.split("请确认老沈的身份。").length - 1).toBe(1);
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
