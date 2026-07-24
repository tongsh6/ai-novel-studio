// Design: docs/design/ui/46-state-and-feedback.md §9.7
// Prototype: novel-studio.pen → 46§9.7-agent-run-control-dock (dxUhh)
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentRunStateData } from "../lib/socket";
import { AgentRunControlDock, AgentRunDialogueFlow } from "./WorkspaceChat";

function runState(status: string): AgentRunStateData {
  return {
    run_id: "run-control-dock",
    run_mode: "bounded",
    status,
    phase: "executing",
    completed_step_refs: ["step-1"],
    pending_artifact_refs: [],
  };
}

function renderDock(
  status: string,
  options: {
    canPause?: boolean;
    canResume?: boolean;
    canCancel?: boolean;
    hasSteerInput?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    React.createElement(AgentRunControlDock, {
      run: runState(status),
      events: [],
      canPause: options.canPause ?? false,
      canResume: options.canResume ?? false,
      canCancel: options.canCancel ?? true,
      hasSteerInput: options.hasSteerInput ?? false,
      onCommand: () => undefined,
      onRequestCancel: () => undefined,
    }),
  );
}

describe("AgentRun fixed control dock", () => {
  it("shows one stable pause action while the run is active", () => {
    const html = renderDock("running", { canPause: true });

    expect(html).toContain('aria-label="当前创作任务控制"');
    expect(html).toContain("进行中 · 创作执行");
    expect(html).toContain("<span>暂停</span>");
    expect(html).toContain("<span>终止任务</span>");
    expect(html).not.toContain("<span>继续</span>");
    expect(html).toContain('data-animated="true"');
  });

  it("reuses the same primary action slot for resume when paused", () => {
    const html = renderDock("paused", { canResume: true });

    expect(html).toContain("已暂停 · 创作执行");
    expect(html).toContain("<span>继续</span>");
    expect(html).toContain("<span>终止任务</span>");
    expect(html).not.toContain("<span>暂停</span>");
    expect(html).not.toContain("data-animated");
    expect(html).toContain("agentRunDockPrimaryActionEmphasis");
  });

  it("lets a typed steering request become the primary paused-state action", () => {
    const html = renderDock("paused", { canResume: true, hasSteerInput: true });

    expect(html).toContain("<span>继续</span>");
    expect(html).not.toContain("agentRunDockPrimaryActionEmphasis");
  });

  it("locks both actions while termination is being processed", () => {
    const html = renderDock("cancelling", { canCancel: false });

    expect(html).toContain("正在终止 · 创作执行");
    expect(html).toContain("<span>处理中…</span>");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("AgentRun dialogue activity", () => {
  it("turns a paused quality revision into a static semantic activity", () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentRunDialogueFlow, {
        run: {
          ...runState("paused"),
          trigger: {
            kind: "author_action",
            action_type: "revise_from_findings",
          },
          current_activity: {
            kind: "revision_draft_generation",
            completed_steps: 3,
            total_steps: 4,
          },
        },
        events: [],
      }),
    );

    expect(html).toContain("修订已暂停，继续后会从当前步骤恢复。");
    expect(html).not.toContain("正在生成修订稿");
    expect(html).not.toContain("spinnerIcon");
    expect(html).not.toContain("第 3/4 步");
    expect(html).not.toContain("已暂停 · 修订原稿");
  });

  it("does not leave a running activity behind after a quality revision completes", () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentRunDialogueFlow, {
        run: {
          ...runState("completed"),
          trigger: {
            kind: "author_action",
            action_type: "revise_from_findings",
          },
          current_activity: {
            kind: "revision_draft_generation",
            completed_steps: 4,
            total_steps: 4,
          },
        },
        events: [],
      }),
    );

    expect(html).toContain("已完成");
    expect(html).not.toContain("正在生成修订稿");
    expect(html).not.toContain("spinnerIcon");
  });
});
