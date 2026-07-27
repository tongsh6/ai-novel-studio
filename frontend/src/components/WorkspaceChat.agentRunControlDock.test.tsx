// Design: docs/design/ui/46-state-and-feedback.md §9.7
// Prototype: novel-studio.pen → 46§9.7-agent-run-control-dock (dxUhh)
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentRunStateData } from "../lib/socket";
import { AgentRunControlDock, AgentRunDialogueFlow } from "./WorkspaceChat";

function runState(status: string, overrides: Partial<AgentRunStateData> = {}): AgentRunStateData {
  return {
    run_id: "run-control-dock",
    run_mode: "bounded",
    status,
    phase: "executing",
    completed_step_refs: ["step-1"],
    pending_artifact_refs: [],
    ...overrides,
  };
}

function renderDock(
  status: string,
  options: {
    canPause?: boolean;
    canResume?: boolean;
    canCancel?: boolean;
    hasSteerInput?: boolean;
    runtimeAuthority?: "live" | "dead" | "unknown";
    awaitingInput?: boolean;
    commandInFlight?: boolean;
    noticeText?: string | null;
    runOverrides?: Partial<AgentRunStateData>;
  } = {},
): string {
  return renderToStaticMarkup(
    React.createElement(AgentRunControlDock, {
      run: runState(status, options.runOverrides ?? {}),
      events: [],
      canPause: options.canPause ?? false,
      canResume: options.canResume ?? false,
      canCancel: options.canCancel ?? true,
      runtimeAuthority: options.runtimeAuthority ?? "live",
      awaitingInput: options.awaitingInput ?? false,
      commandInFlight: options.commandInFlight ?? false,
      noticeText: options.noticeText ?? null,
      hasSteerInput: options.hasSteerInput ?? false,
      onCommand: () => undefined,
      onRequestCancel: () => undefined,
      onRestartTask: () => undefined,
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

  // DS03 状态矩阵：awaiting_author 不提供裸「继续」，只保留补充输入引导与终止。
  it("replaces bare resume with an input-required hint while awaiting the author", () => {
    const html = renderDock("awaiting_author", { awaitingInput: true, canCancel: true });

    expect(html).toContain("等待你确认 · 创作执行");
    expect(html).toContain("等待你的补充：输入具体方向后发送，任务才会继续。");
    expect(html).toContain("<span>终止任务</span>");
    expect(html).not.toContain("<span>继续</span>");
    expect(html).not.toContain("<span>暂停</span>");
  });

  // DS03 状态矩阵：dead bounded 明示失效，唯一动作是重新发起；不发 agent_command。
  it("demotes a dead bounded run to an expired surface with restart only", () => {
    const html = renderDock("awaiting_author", {
      runtimeAuthority: "dead",
      canCancel: false,
    });

    expect(html).toContain("原任务已失效");
    expect(html).toContain("后台运行已结束，历史记录仍可查看。可重新发起任务继续。");
    expect(html).toContain("<span>重新发起任务</span>");
    expect(html).not.toContain("<span>继续</span>");
    expect(html).not.toContain("<span>暂停</span>");
    expect(html).not.toContain("<span>终止任务</span>");
    expect(html).not.toContain("data-animated");
  });

  // DS03 状态矩阵：durable 检查点走 durable recovery 口径，不复用 bounded resume 假象。
  it("keeps a dead durable checkpoint honest without live controls", () => {
    const html = renderDock("awaiting_author", {
      runtimeAuthority: "dead",
      canCancel: false,
      runOverrides: { run_mode: "durable", recovered: true, long_run_task_ref: "task-1" },
    });

    expect(html).toContain("已从检查点恢复，实时控制不可用。");
    expect(html).not.toContain("<span>重新发起任务</span>");
    expect(html).not.toContain("<span>继续</span>");
    expect(html).not.toContain("<span>终止任务</span>");
  });

  // DS03：liveness 未确认（仅历史快照）时不授予可提交动作。
  it("keeps actions disabled while runtime liveness is unknown", () => {
    const html = renderDock("paused", { runtimeAuthority: "unknown", canCancel: false });

    expect(html).toContain("正在确认任务状态…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  // DS03：命令失败是单一内联 system status，不是 AI 消息。
  it("renders a command failure as one inline system status", () => {
    const html = renderDock("awaiting_author", {
      awaitingInput: true,
      noticeText: "原任务已失效，无法继续；请重新发起任务。",
    });

    expect(html).toContain('role="status"');
    expect(html).toContain("原任务已失效，无法继续；请重新发起任务。");
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
