import { describe, expect, it } from "vitest";

import {
  buildAgentRunInputPresentation,
  decideAgentRunInputRoute,
  openQuestionRunIdsForRuns,
  selectActiveAgentRun,
  shouldRouteInputToAgentSteer,
} from "../agentRunInputRouting";
import type { AgentRunStateData } from "../socket";

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

describe("shouldRouteInputToAgentSteer (legacy compatibility)", () => {
  it("routes ordinary input to steer while an AgentRun is active", () => {
    const single = (status: string) => run(`run-${status}`, status);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: single("running") })).toBe(true);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: single("paused") })).toBe(true);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: single("awaiting_author") })).toBe(true);
  });

  it("未绑定主输入不隐式回答模型问题，明确回复走源 author_action", () => {
    const awaiting = run("run-awaiting", "awaiting_author");
    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: awaiting,
        hasUnansweredModelQuestion: true,
      }),
    ).toBe(false);
    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: awaiting,
        hasUnansweredModelQuestion: false,
      }),
    ).toBe(true);
  });

  it("does not steal normal chat input when no active run exists", () => {
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: null })).toBe(false);
    expect(
      shouldRouteInputToAgentSteer({ latestAgentRun: run("run-completed", "completed") }),
    ).toBe(false);
    expect(
      shouldRouteInputToAgentSteer({ latestAgentRun: run("run-cancelled", "cancelled") }),
    ).toBe(false);
    expect(shouldRouteInputToAgentSteer({ latestAgentRun: run("run-failed", "failed") })).toBe(
      false,
    );
  });

  it("keeps pending author answers and explicit micro-plan requests on the user_message path", () => {
    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: run("run-running", "running"),
        pendingAnswerBehaviorId: "behavior_pending",
      }),
    ).toBe(false);

    expect(
      shouldRouteInputToAgentSteer({
        latestAgentRun: run("run-running", "running"),
        generateMicroPlan: true,
      }),
    ).toBe(false);
  });
});

describe("selectActiveAgentRun (B31 §6.2 Q01)", () => {
  it("优先选择唯一 open question 所属 run，而非 Map 末位的 run", () => {
    const planRun = run("run-plan", "awaiting_author");
    const questionRun = run("run-question", "awaiting_author");
    // 调用方传入顺序刻意把 plan 放最后（模拟旧 visibleAgentRunMap 插入序）。
    const selection = selectActiveAgentRun({
      runs: [questionRun, planRun],
      openQuestionRunIds: ["run-question"],
    });

    expect(selection.source).toBe("open_question");
    expect(selection.run?.run_id).toBe("run-question");
  });

  it("多个 open question 时不再猜，交给 focused/后续选择", () => {
    const selection = selectActiveAgentRun({
      runs: [run("run-a", "awaiting_author"), run("run-b", "awaiting_author")],
      openQuestionRunIds: ["run-a", "run-b"],
    });

    expect(selection.run).toBeNull();
    expect(selection.source).toBe("ambiguous");
  });

  it("focusedRunId 优先于最近活动与唯一 steerable", () => {
    const selection = selectActiveAgentRun({
      runs: [run("run-a", "running"), run("run-b", "awaiting_author")],
      focusedRunId: "run-a",
      lastEventAt: { "run-b": 200, "run-a": 100 },
    });

    expect(selection.source).toBe("focused");
    expect(selection.run?.run_id).toBe("run-a");
  });

  it("最近语义活动（agent_event/turn_result 时间）唯一时选择它", () => {
    const selection = selectActiveAgentRun({
      runs: [run("run-a", "running"), run("run-b", "paused")],
      lastEventAt: { "run-a": 100, "run-b": 300 },
    });

    expect(selection.source).toBe("recent");
    expect(selection.run?.run_id).toBe("run-b");
  });

  it("最近活动并列时继续回退，最终以唯一 steerable 决定", () => {
    const selection = selectActiveAgentRun({
      runs: [run("run-a", "running")],
      lastEventAt: { "run-a": 300 },
    });

    expect(selection.source).toBe("recent");
    expect(selection.run?.run_id).toBe("run-a");

    const singleSteerable = selectActiveAgentRun({
      runs: [run("run-only", "awaiting_author")],
    });
    expect(singleSteerable.source).toBe("unique_steerable");
    expect(singleSteerable.run?.run_id).toBe("run-only");
  });

  it("多 live run 无 open question/focus/活动时返回 ambiguous，不按到达序猜", () => {
    const selection = selectActiveAgentRun({
      runs: [run("run-a", "running"), run("run-b", "awaiting_author")],
    });

    expect(selection.run).toBeNull();
    expect(selection.source).toBe("ambiguous");
    expect(selection.candidateRunIds).toEqual(["run-a", "run-b"]);
  });

  it("忽略 terminal 与 runtime 失活 run", () => {
    const selection = selectActiveAgentRun({
      runs: [
        run("run-terminal", "completed"),
        run("run-dead", "awaiting_author", { runtime_live: false }),
        run("run-live", "paused"),
      ],
      openQuestionRunIds: ["run-dead"],
    });

    expect(selection.candidateRunIds).toEqual(["run-live"]);
    expect(selection.run?.run_id).toBe("run-live");
  });
});

describe("openQuestionRunIdsForRuns", () => {
  it("只保留 status=open 且 goal version 与 run 匹配的问题 run", () => {
    const runs = [
      run("run-v1", "awaiting_author", { goal: { text: "目标", version: 1 } }),
      run("run-v2", "awaiting_author", { goal: { text: "目标", version: 2 } }),
      run("run-closed", "completed"),
    ];
    const openIds = openQuestionRunIdsForRuns(runs, [
      { run_id: "run-v1", status: "open", goal_version: 1 },
      { run_id: "run-v2", status: "open", goal_version: 1 },
      { run_id: "run-closed", status: "open", goal_version: 1 },
      { run_id: "run-v2", status: "answered", goal_version: 2 },
    ]);

    expect(openIds).toEqual(["run-v1"]);
  });

  it("版本缺失时按匹配处理，避免漏掉真实 open 问题", () => {
    const openIds = openQuestionRunIdsForRuns(
      [run("run-a", "awaiting_author", { goal: { text: "目标", version: 3 } })],
      [{ run_id: "run-a", status: "open", goal_version: null }],
    );

    expect(openIds).toEqual(["run-a"]);
  });
});

describe("decideAgentRunInputRoute (B31 §6.2 Q02)", () => {
  it("唯一 active run 且无其它未答问题时才 plain steer", () => {
    const decision = decideAgentRunInputRoute({
      runs: [run("run-a", "running")],
      openQuestionRunIds: [],
    });

    expect(decision.route).toBe("steer");
    expect(decision.reason).toBe("active_run_unique");
    expect(decision.run?.run_id).toBe("run-a");
  });

  it("其它 run 有未答 open question 时主输入按新请求处理，不 steer", () => {
    const decision = decideAgentRunInputRoute({
      runs: [run("run-structure", "awaiting_author"), run("run-question", "awaiting_author")],
      openQuestionRunIds: ["run-question"],
    });

    expect(decision.route).toBe("user_message");
    expect(decision.reason).toBe("active_has_model_question");
    expect(decision.run?.run_id).toBe("run-question");
  });

  it("active run 自身有未答 open question 时主输入按新请求处理", () => {
    const decision = decideAgentRunInputRoute({
      runs: [run("run-question", "awaiting_author")],
      openQuestionRunIds: ["run-question"],
    });

    expect(decision.route).toBe("user_message");
    expect(decision.reason).toBe("active_has_model_question");
  });

  it("双 live run 无确定性 active run 时按新请求处理（歧义不 steer）", () => {
    const decision = decideAgentRunInputRoute({
      runs: [run("run-a", "running"), run("run-b", "awaiting_author")],
    });

    expect(decision.route).toBe("user_message");
    expect(decision.reason).toBe("ambiguous_live_runs");
    expect(decision.run).toBeNull();
  });

  it("focused run 解除歧义后恢复 plain steer", () => {
    const decision = decideAgentRunInputRoute({
      runs: [run("run-a", "running"), run("run-b", "awaiting_author")],
      focusedRunId: "run-b",
    });

    expect(decision.route).toBe("steer");
    expect(decision.run?.run_id).toBe("run-b");
  });

  it("pending answer / 显式计划请求保持 user_message", () => {
    const base = { runs: [run("run-a", "running")] };
    expect(
      decideAgentRunInputRoute({ ...base, pendingAnswerBehaviorId: "behavior_pending" }).reason,
    ).toBe("pending_answer");
    expect(decideAgentRunInputRoute({ ...base, generateMicroPlan: true }).reason).toBe(
      "explicit_micro_plan",
    );
  });
});

describe("buildAgentRunInputPresentation (B31 §6.2 Q05)", () => {
  it("可 steer 且多 live run 时显示将发给哪个任务", () => {
    const runs = [run("run-a", "running"), run("run-b", "paused")];
    const decision = decideAgentRunInputRoute({ runs, focusedRunId: "run-b" });
    const presentation = buildAgentRunInputPresentation(decision, runs);

    expect(presentation.canSteer).toBe(true);
    expect(presentation.liveRunCount).toBe(2);
    expect(presentation.steerTargetGoalText).toBe("目标 run-b");
    expect(presentation.noticeKind).toBeNull();
  });

  it("歧义时显示可见提示与任务选择项", () => {
    const runs = [run("run-a", "running"), run("run-b", "awaiting_author")];
    const decision = decideAgentRunInputRoute({ runs });
    const presentation = buildAgentRunInputPresentation(decision, runs);

    expect(presentation.canSteer).toBe(false);
    expect(presentation.noticeKind).toBe("ambiguous");
    expect(presentation.showRunSelector).toBe(true);
    expect(presentation.selectorRuns.map((entry) => entry.run_id)).toEqual(["run-a", "run-b"]);
  });

  it("有未答问题时显示问题提示，不提供任务选择", () => {
    const runs = [run("run-structure", "awaiting_author"), run("run-question", "awaiting_author")];
    const decision = decideAgentRunInputRoute({
      runs,
      openQuestionRunIds: ["run-question"],
    });
    const presentation = buildAgentRunInputPresentation(decision, runs);

    expect(presentation.canSteer).toBe(false);
    expect(presentation.noticeKind).toBe("question");
    expect(presentation.showRunSelector).toBe(false);
  });
});
