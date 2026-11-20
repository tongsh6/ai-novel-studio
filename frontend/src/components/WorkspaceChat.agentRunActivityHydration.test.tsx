// Design: docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md (AgentRun 关联摘要 / activity 补水)
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  agentRunActivityQueryTurn,
  mergeAgentRunRuntimeState,
  stateFromTurnResult,
  upsertAssistantTurnResultMessage,
  type AgentRunAnchorMessage,
} from "../lib/agentRunAnchoring";
import { agentRunEventsFor, isAgentEventData, mergeAgentRunEvents } from "../lib/agentRunTimeline";
import type { AgentEventData } from "../lib/socket";
import { AgentRunDialogueFlow, type TurnResult } from "./WorkspaceChat";
import { MarkdownText } from "./MarkdownText";

function turnResult(attrs: Partial<TurnResult>): TurnResult {
  return {
    schema_version: "3.0-draft",
    turn_id: "turn_result",
    phase: "completed",
    status: "completed",
    next_action: "continue",
    assistant_message: { text: "完成回应" },
    produced_at: "2026-07-01T00:00:00Z",
    ...attrs,
  };
}

describe("WorkspaceChat AgentRun activity hydration query turn", () => {
  // B23 CP1（F2）：judgment_plan / judgment_loop 的子 turn 没有自己的 run，
  // activity 必须按 run 的 parent_turn_ref（父消息 id）查询才能命中停等理由。
  it("queries with the parent message turn for a child agent turn result", () => {
    const result = turnResult({
      turn_id: "message_parent_b23:agent:6",
      agent_run: {
        run_id: "run_judgment_plan_b23",
        parent_turn_ref: "message_parent_b23",
        status: "awaiting_author",
      },
    });

    expect(agentRunActivityQueryTurn(result)).toBe("message_parent_b23");
  });

  // 历史 transcript 摘要没有 parent_turn_ref 时仍用 turn_id，交给后端按父 id 回退查询。
  it("falls back to the turn id when the persisted agent_run summary has no parent ref", () => {
    const result = turnResult({
      turn_id: "message_parent_b23:agent:6",
      agent_run: { run_id: "run_judgment_plan_b23", status: "awaiting_author" },
    });

    expect(agentRunActivityQueryTurn(result)).toBe("message_parent_b23:agent:6");
  });

  it("ignores a blank or null parent ref", () => {
    expect(
      agentRunActivityQueryTurn(
        turnResult({
          turn_id: "turn_plain",
          agent_run: { run_id: "run_plain", parent_turn_ref: " " },
        }),
      ),
    ).toBe("turn_plain");
    expect(
      agentRunActivityQueryTurn(
        turnResult({
          turn_id: "turn_plain",
          agent_run: { run_id: "run_plain", parent_turn_ref: null },
        }),
      ),
    ).toBe("turn_plain");
  });
});

// 原生十轮失败的独立输入顺序：resume -> HTTP activity -> pending submission 旧 ACK。
// 预期来自已提交事件的身份与计数，不从组件投影反推；这组纯机制测试不代签原生恢复。
describe("运行事件与业务回执分别归属", () => {
  it("公开流式仅由同源正文交付接管，取消未交付时保留原文", () => {
    const text = "## 对照\n\n**中文。**继续";
    const stream: AgentEventData = {
      event_id: "evt-stream",
      run_ref: "run-live",
      sequence: 1,
      event_type: "provider_progress",
      visibility: "author",
      summary: "provider_event:chunk",
      reason_codes: ["provider_chunk"],
      refs: [],
      payload: {
        provider_call_ref: "call-live",
        provider_run_ref: "provider-live",
        author_narrative_delta: text,
      },
    };
    const source = {
      source_type: "provider_output",
      provider_run_ref: "provider-live",
      provider_call_ref: "call-live",
      provider_output_ref: "provider-live:output",
      source_hash: "b05f7f89db346b4d85a8b7f4d727622049c9cc7e40b3cd25502abd2430dcae0c",
      source_byte_range: { start: 0, length: 30 },
      narrative_hash: "b05f7f89db346b4d85a8b7f4d727622049c9cc7e40b3cd25502abd2430dcae0c",
    };
    const delivery = turnResult({
      assistant_message: { text },
      agent_run: { run_id: "run-live", status: "running", phase: "executing" },
      trace_summary: {
        reply_record: { author_narrative_source: source },
      },
    });
    const state = stateFromTurnResult(delivery)!;
    const before = renderToStaticMarkup(<AgentRunDialogueFlow run={state} events={[stream]} />);
    expect(before).toContain("<strong>中文。</strong>");
    const after = renderToStaticMarkup(
      <>
        <MarkdownText text={text} />
        <AgentRunDialogueFlow run={state} events={[stream]} deliveredResults={[delivery]} />
      </>,
    );
    expect(after.match(/<strong>中文。<\/strong>/g)).toHaveLength(1);
    for (const replyRecord of [
      { provider_call_ref: "call-live", response_kind: "plain_text" },
      {
        author_narrative_source: {
          ...source,
          provider_run_ref: "another-provider",
          provider_output_ref: "another-provider:output",
        },
      },
      {
        author_narrative_source: {
          ...source,
          source_type: "provider_output_tool_narrative",
          tool_call_name: "ask_author",
          tool_call_narrative_field: "question",
        },
      },
    ]) {
      const otherDelivery = turnResult({
        ...delivery,
        trace_summary: { reply_record: replyRecord },
      });
      const retained = renderToStaticMarkup(
        <>
          <MarkdownText text={text} />
          <AgentRunDialogueFlow run={state} events={[stream]} deliveredResults={[otherDelivery]} />
        </>,
      );
      expect(retained.match(/<strong>中文。<\/strong>/g)).toHaveLength(2);
    }
    const cancelled = renderToStaticMarkup(
      <AgentRunDialogueFlow
        run={{ ...state, status: "cancelled" }}
        events={[
          { ...stream, payload: { ...stream.payload, author_narrative_delta: "未完成 **强调" } },
        ]}
      />,
    );
    expect(cancelled).toContain("未完成 **强调");
    expect(cancelled).not.toContain("<strong>");
  });

  const event: AgentEventData = {
    event_id: "evt-restored-compaction",
    run_ref: "run-restored",
    event_type: "checkpoint_created",
    sequence: 2012,
    visibility: "author",
    summary: "较早的 4 项创作过程已整理",
    reason_codes: ["transcript_compaction"],
    refs: [],
    payload: {
      covered_counts: { tool_exchanges: 0, scope_updates: 2, discussion_messages: 2 },
      history_target: { session_id: "session-restored", turn_id: "turn-source" },
      sources: [],
    },
  };
  const result = turnResult({
    turn_id: "turn-delivered",
    agent_run: {
      run_id: "run-restored",
      status: "completed",
      phase: "stopped",
      parent_turn_ref: "turn-delivered",
      run_mode: "bounded",
    },
  });
  const receipt = turnResult({
    ...result,
    agent_run: { ...result.agent_run, status: "running", phase: "executing" },
  });

  it.each(["activity_first", "receipt_first"] as const)(
    "%s：重放业务快照不擦除持久事件、不倒退已确认终态",
    (order) => {
      let events: AgentEventData[] = [];
      let messages: AgentRunAnchorMessage<TurnResult>[] = [];
      const state = stateFromTurnResult(result)!;
      messages = upsertAssistantTurnResultMessage(messages, result);
      if (order === "activity_first") events = mergeAgentRunEvents(events, [event]);
      messages = upsertAssistantTurnResultMessage(messages, receipt);
      const runtime = mergeAgentRunRuntimeState(state, stateFromTurnResult(receipt)!);
      if (order === "receipt_first") events = mergeAgentRunEvents(events, [event]);

      // 再次收到同一持久事件只指向同一个事件，不按相同文案吞并其它真实事件。
      events = mergeAgentRunEvents(events, [structuredClone(event)]);
      messages = upsertAssistantTurnResultMessage(messages, result);
      expect(messages).toHaveLength(1);
      expect(messages[0].turnResult?.agent_run).not.toHaveProperty("events");
      expect(messages[0].turnResult?.agent_run).not.toHaveProperty("activity_loaded");
      expect(runtime.status).toBe("completed");
      expect(events).toEqual([event]);
      const html = renderToStaticMarkup(
        <AgentRunDialogueFlow run={runtime} events={agentRunEventsFor(events, runtime.run_id)} />,
      );
      expect(html).toContain("较早的 4 项创作过程已整理");
      expect(html.match(/查看已整理的较早创作过程/g)).toHaveLength(1);
      expect(html).not.toContain("evt-restored-compaction");
      expect(html).not.toContain("turn-source");
    },
  );

  it("其它运行的事件不串入，同文案不同事件身份保留真实次数", () => {
    const next: AgentEventData = { ...event, event_id: "evt-next", sequence: 2013 };
    const other: AgentEventData = { ...event, event_id: "evt-other", run_ref: "run-other" };
    const events = mergeAgentRunEvents([event], [other, next, event]);
    expect(agentRunEventsFor(events, "run-restored")).toEqual([event, next]);
    expect(agentRunEventsFor(events, "run-other")).toEqual([other]);
    expect(agentRunEventsFor(events, "run-missing")).toEqual([]);
    const html = renderToStaticMarkup(
      <AgentRunDialogueFlow
        run={stateFromTurnResult(result)}
        events={agentRunEventsFor(events, "run-restored")}
      />,
    );
    expect(html).toContain("较早的 8 项创作过程已整理");
  });

  it("HTTP 数据入口仍拒绝不完整事件；空补拉不撤销已观察事实", () => {
    const values: unknown[] = [
      event,
      null,
      {},
      { ...event, run_ref: null },
      { ...event, sequence: "2012" },
    ];
    expect(values.filter(isAgentEventData)).toEqual([event]);
    expect(mergeAgentRunEvents([event], [])).toEqual([event]);
  });
});
