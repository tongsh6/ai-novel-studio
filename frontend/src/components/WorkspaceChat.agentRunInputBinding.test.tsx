// Design: docs/design/ui/46-state-and-feedback.md §9.7（AgentRun 停等/输入归属）
// B31 §6.2 Q02/Q05：主输入不能确定性 steer 时必须显示可见提示；多 live run 歧义时
// 提供真实任务选择入口；可 steer 时显示「将发给」目标。不新增隐藏 hook/testid。
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildAgentRunInputPresentation,
  decideAgentRunInputRoute,
} from "../lib/agentRunInputRouting";
import type { AgentRunStateData } from "../lib/socket";
import { AgentRunInputRoutingAids } from "./WorkspaceChat";

function run(
  runId: string,
  status: string,
  overrides: Partial<AgentRunStateData> = {},
): AgentRunStateData {
  return {
    run_id: runId,
    run_mode: "bounded",
    status,
    phase: "executing",
    goal: { text: `目标 ${runId}`, version: 1 },
    ...overrides,
  };
}

function renderAids(
  runs: AgentRunStateData[],
  options: { focusedRunId?: string | null; openQuestionRunIds?: string[] } = {},
): string {
  const decision = decideAgentRunInputRoute({
    runs,
    focusedRunId: options.focusedRunId ?? null,
    openQuestionRunIds: options.openQuestionRunIds ?? [],
  });
  const presentation = buildAgentRunInputPresentation(decision, runs);
  return renderToStaticMarkup(
    React.createElement(AgentRunInputRoutingAids, {
      presentation,
      onSelectRun: () => undefined,
    }),
  );
}

describe("WorkspaceChat 主输入归属提示（B31 CP1）", () => {
  it("单 live run 可 steer 时沿用现有「调整当前任务」提示", () => {
    const html = renderAids([run("run-only", "awaiting_author")]);

    expect(html).toContain("调整当前任务");
    expect(html).toContain("将应用到当前创作");
    expect(html).not.toContain("下方输入会作为新请求发送");
  });

  it("多 live run 且 focused 目标确定时显示「将发给」目标任务", () => {
    const html = renderAids(
      [run("run-a", "running"), run("run-b", "awaiting_author")],
      { focusedRunId: "run-b" },
    );

    expect(html).toContain("将发给");
    expect(html).toContain("目标 run-b");
    expect(html).not.toContain("当前有多个任务在进行");
  });

  it("双 live run 歧义时不 steer：显示可见提示与真实任务选择入口", () => {
    const html = renderAids([run("run-a", "running"), run("run-b", "awaiting_author")]);

    expect(html).toContain("当前有多个任务在进行");
    expect(html).toContain("下方输入会作为新请求发送");
    expect(html).toContain('role="status"');
    expect(html).toContain('role="group"');
    expect(html).toContain("选择要继续的任务");
    expect(html).toContain("目标 run-a");
    expect(html).toContain("目标 run-b");
    expect(html).not.toContain("将应用到当前创作");
  });

  it("其它 run 有未答 open question 时显示问题提示，不提供任务选择", () => {
    const html = renderAids(
      [run("run-structure", "awaiting_author"), run("run-question", "awaiting_author")],
      { openQuestionRunIds: ["run-question"] },
    );

    expect(html).toContain("有任务正在等待你的问题回复");
    expect(html).toContain("请在对应问题卡上回复");
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("将应用到当前创作");
  });

  it("没有 live run 时不渲染提示（普通 composer 不被打扰）", () => {
    const html = renderAids([run("run-done", "completed")]);

    expect(html).toBe("");
  });
});
