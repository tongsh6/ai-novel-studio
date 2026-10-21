// Design: docs/design/ui/46-state-and-feedback.md §9.5 第 4 条 (执行中标识必须全程连续)
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEventData, AgentRunStateData } from "../lib/socket";
import { AgentRunDialogueFlow } from "./WorkspaceChat";

const RUN_ID = "run-elapsed";
const RUN_STARTED_AT = "2026-10-22T01:00:00.000Z";
const RUN_STARTED_AT_MS = Date.parse(RUN_STARTED_AT);

function runState(status: string): AgentRunStateData {
  return {
    run_id: RUN_ID,
    run_mode: "bounded",
    status,
    phase: "executing",
    completed_step_refs: [],
    pending_artifact_refs: [],
  };
}

function agentEvent(
  overrides: Partial<AgentEventData> & Pick<AgentEventData, "event_type">,
): AgentEventData {
  return {
    event_id: `evt-${overrides.event_type}-${overrides.sequence ?? 1}`,
    run_ref: RUN_ID,
    sequence: 1,
    visibility: "author",
    summary: "",
    ...overrides,
  };
}

function runStartedAt(emittedAt: string, overrides: Partial<AgentEventData> = {}): AgentEventData {
  return agentEvent({
    event_type: "run_started",
    visibility: "author",
    summary: "AgentRun 已启动。",
    emitted_at: emittedAt,
    ...overrides,
  });
}

function isoAt(secondsAfterRunStart: number): string {
  return new Date(RUN_STARTED_AT_MS + secondsAfterRunStart * 1000).toISOString();
}

function setNowAt(secondsAfterRunStart: number): void {
  vi.setSystemTime(new Date(RUN_STARTED_AT_MS + secondsAfterRunStart * 1000));
}

function renderFlow(status: string, events: AgentEventData[]): string {
  return renderToStaticMarkup(
    React.createElement(AgentRunDialogueFlow, { run: runState(status), events }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setNowAt(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentRun elapsed wait indicator", () => {
  it("stays hidden during the first five seconds of a fresh run", () => {
    setNowAt(4);

    expect(renderFlow("running", [runStartedAt(isoAt(0))])).not.toContain("已运行");
  });

  // 5 秒是显示门槛（避免短任务闪烁），不是进度百分比。
  it("shows truthful wall-clock time once the wait crosses five seconds", () => {
    setNowAt(5);
    expect(renderFlow("running", [runStartedAt(isoAt(0))])).toContain("已运行 5 秒");

    setNowAt(12);
    expect(renderFlow("running", [runStartedAt(isoAt(0))])).toContain("已运行 12 秒");
  });

  it("formats multi-minute waits with minutes and seconds", () => {
    setNowAt(3 * 60 + 12);

    expect(renderFlow("pausing", [runStartedAt(isoAt(0))])).toContain("已运行 3 分 12 秒");
  });

  it("formats long waits in hours and minutes", () => {
    setNowAt(60 * 60 + 2 * 60);

    expect(renderFlow("cancelling", [runStartedAt(isoAt(0))])).toContain("已运行 1 小时 2 分");
  });

  // 重连/恢复可能重放 run_started；取最新一条，不能把旧起点抬出来。
  it("anchors on the latest author-visible run_started event", () => {
    setNowAt(120);
    const html = renderFlow("running", [
      runStartedAt(isoAt(0), { event_id: "evt-started-original", sequence: 1 }),
      runStartedAt(isoAt(108), { event_id: "evt-started-replayed", sequence: 2 }),
    ]);

    expect(html).toContain("已运行 12 秒");
    expect(html).not.toContain("已运行 2 分");
  });

  it("ignores non-author run_started events when picking the anchor", () => {
    setNowAt(120);
    const html = renderFlow("running", [
      agentEvent({
        event_type: "run_started",
        visibility: "system",
        sequence: 1,
        emitted_at: isoAt(108),
      }),
      agentEvent({
        event_type: "provider_progress",
        sequence: 2,
        emitted_at: isoAt(60),
        reason_codes: ["provider_started"],
      }),
    ]);

    // 没有作者可见 run_started → 回退到最早事件（60 秒前的 provider_progress）。
    expect(html).toContain("已运行 1 分");
  });

  it("falls back to the earliest event timestamp when run_started is absent", () => {
    setNowAt(12);
    const html = renderFlow("created", [
      agentEvent({ event_type: "provider_progress", sequence: 1, emitted_at: isoAt(0) }),
      agentEvent({ event_type: "tool_started", sequence: 2, emitted_at: isoAt(10) }),
    ]);

    expect(html).toContain("已运行 12 秒");
  });

  it("shows nothing when events carry no timestamps", () => {
    setNowAt(120);

    expect(
      renderFlow("running", [agentEvent({ event_type: "run_started", sequence: 1 })]),
    ).not.toContain("已运行");
  });

  it.each(["completed", "cancelled", "failed", "paused", "awaiting_author"])(
    "disappears once the run status is %s",
    (status) => {
      setNowAt(120);
      const html = renderFlow(status, [
        runStartedAt(isoAt(0)),
        agentEvent({
          event_type: "evaluation_made",
          sequence: 2,
          emitted_at: isoAt(30),
          summary: "评估已完成。",
          payload: { author_narrative: "这一轮评估已经完成。" },
        }),
      ]);

      expect(html).not.toContain("已运行");
    },
  );

  it("recomputes from the wall clock instead of freezing the first reading", () => {
    setNowAt(12);
    expect(renderFlow("running", [runStartedAt(isoAt(0))])).toContain("已运行 12 秒");

    setNowAt(12 + 60);
    expect(renderFlow("running", [runStartedAt(isoAt(0))])).toContain("已运行 1 分 12 秒");
  });
});
