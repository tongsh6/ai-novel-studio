import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentEventData } from "../lib/socket";
import { AgentRunDialogueFlow } from "./WorkspaceChat";

function checkpointEvent(sequence: number, covered: number): AgentEventData {
  return {
    event_id: `evt_run_1_${sequence}`,
    run_ref: "run_1",
    run_id: "run_1",
    step_ref: "step_3",
    sequence,
    event_type: "checkpoint_created",
    visibility: "author",
    summary: "内部摘要不应出现在作者界面",
    reason_codes: ["transcript_compaction"],
    refs: [],
    payload: { covered_exchanges: covered, sources: ["角色档案"] },
    emitted_at: "2026-11-04T00:00:00Z",
  };
}

function runStartedEvent(sequence: number): AgentEventData {
  return {
    event_id: `evt_run_1_${sequence}`,
    run_ref: "run_1",
    run_id: "run_1",
    sequence,
    event_type: "run_started",
    visibility: "author",
    summary: "创作开始",
    reason_codes: [],
    refs: [],
    payload: {},
    emitted_at: "2026-11-04T00:00:00Z",
  };
}

function renderFlow(events: AgentEventData[]): string {
  return renderToStaticMarkup(
    React.createElement(AgentRunDialogueFlow, {
      run: null,
      events,
    }),
  );
}

describe("AgentRunDialogueFlow 整理记录接线（W1–W3）", () => {
  it("W1：存在 checkpoint_created 事件时渲染单行细条", () => {
    const html = renderFlow([checkpointEvent(3, 12)]);

    expect(html).toContain("较早的 12 项创作过程已整理");
    expect(html).toContain('aria-label="查看已整理的较早创作过程"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("W2：无整理事件时不渲染细条（作者无感）", () => {
    const html = renderFlow([runStartedEvent(1)]);

    expect(html).not.toContain("创作过程已整理");
    expect(html).not.toContain("查看已整理的较早创作过程");
  });

  it("W3：checkpoint_created 不被当作叙事/计划事件渲染", () => {
    const event = checkpointEvent(3, 12);
    const html = renderFlow([event]);

    // 事件 summary 是后端事实文本，可能含内部口径；作者界面只渲染 copy 文案。
    expect(html).not.toContain(event.summary);
    // 不进入叙事段落区域。
    expect(html).not.toContain("agenticLoopNarrativeParagraph");
  });
});
