import { describe, expect, it } from "vitest";

import {
  buildAgentRunInputPresentation,
  decideAgentRunInputRoute,
  deriveAgentRunInputMode,
  findCurrentOpenAuthorQuestion,
  openQuestionRunIdsForRuns,
  selectActiveAgentRun,
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

function questionResult(
  runId: string,
  status: string,
  goalVersion: number | null,
  turnId: string,
) {
  return {
    turn_id: turnId,
    author_question: { run_id: runId, status, goal_version: goalVersion },
  };
}

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

describe("findCurrentOpenAuthorQuestion", () => {
  const currentRun = run("run-same", "awaiting_author", {
    goal: { text: "目标 run-same", version: 2 },
  });

  it("同一 run 的 v1 旧题与 v2 当前题并存时选当前版本", () => {
    const old = questionResult("run-same", "open", 1, "turn-v1");
    const current = questionResult("run-same", "open", 2, "turn-v2");

    const found = findCurrentOpenAuthorQuestion(currentRun, [[old], [current]]);

    expect(found?.turn_id).toBe("turn-v2");
  });

  it("旧消息缺版本时不能遮蔽 snapshot 中精确匹配的当前题", () => {
    const legacy = questionResult("run-same", "open", null, "turn-legacy");
    const current = questionResult("run-same", "open", 2, "turn-v2");

    const found = findCurrentOpenAuthorQuestion(currentRun, [[legacy], [current]]);

    expect(found?.turn_id).toBe("turn-v2");
  });

  it("只有旧版本题时返回 null", () => {
    const old = questionResult("run-same", "open", 1, "turn-v1");

    expect(findCurrentOpenAuthorQuestion(currentRun, [[old], []])).toBeNull();
  });

  it("不同 run 的题不参与当前 run 选题", () => {
    const other = questionResult("run-other", "open", 2, "turn-other");

    expect(findCurrentOpenAuthorQuestion(currentRun, [[other]])).toBeNull();
  });

  it("闭合题不被选中", () => {
    const answered = questionResult("run-same", "answered", 2, "turn-answered");

    expect(findCurrentOpenAuthorQuestion(currentRun, [[answered]])).toBeNull();
  });

  it("题版本缺失时仍按现有兼容规则匹配", () => {
    const legacy = questionResult("run-same", "open", null, "turn-legacy");

    expect(
      findCurrentOpenAuthorQuestion(currentRun, [[legacy]])?.turn_id,
    ).toBe("turn-legacy");
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

describe("deriveAgentRunInputMode（46 §9.7 等待即回答）", () => {
  const presentationFor = (
    decision: ReturnType<typeof decideAgentRunInputRoute>,
    runs: readonly AgentRunStateData[],
  ) => buildAgentRunInputPresentation(decision, runs);

  const decide = (
    runs: readonly AgentRunStateData[],
    openQuestionRunIds: string[] = [],
    focusedRunId: string | null = null,
  ) =>
    decideAgentRunInputRoute({
      runs,
      openQuestionRunIds,
      focusedRunId: focusedRunId,
      lastEventAt: {},
      pendingAnswerBehaviorId: null,
    });

  it("active run 有未答模型问题：主输入区接管为回答模式", () => {
    const runs = [run("run-question", "awaiting_author")];
    const decision = decide(runs, ["run-question"]);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs));
    expect(mode).toEqual({ mode: "answer_question", questionRunId: "run-question" });
  });

  it("作者显式「开始新讨论」后：有未答问题也按新讨论处理", () => {
    const runs = [run("run-question", "awaiting_author")];
    const decision = decide(runs, ["run-question"]);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs), {
      answerModeDismissed: true,
    });
    expect(mode).toEqual({ mode: "new_discussion", questionRunId: null });
  });

  it("唯一 open question 的 run 被选择器视为 active：主输入接管回答", () => {
    // 选择器优先选「持有唯一未答问题的 run」为 active（B31 §6.2 Q01），
    // 因此其它 run 的问题也会自然成为回答目标，而不是新讨论。
    const runs = [run("run-active", "running"), run("run-other", "awaiting_author")];
    const decision = decide(runs, ["run-other"], "run-active");
    expect(decision.reason).toBe("active_has_model_question");
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs));
    expect(mode).toEqual({ mode: "answer_question", questionRunId: "run-other" });
  });

  it("多个 run 同时有未答问题（歧义）：不接管主输入", () => {
    const runs = [run("run-a", "awaiting_author"), run("run-b", "awaiting_author")];
    const decision = decide(runs, ["run-a", "run-b"]);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs));
    expect(mode.mode).toBe("new_discussion");
  });

  it("唯一可 steer 的 active run：输入即调整当前任务", () => {
    const runs = [run("run-running", "running")];
    const decision = decide(runs);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs));
    expect(mode).toEqual({ mode: "steer", questionRunId: null });
  });

  it("无 active run：普通新讨论", () => {
    const runs: AgentRunStateData[] = [];
    const decision = decide(runs);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs));
    expect(mode).toEqual({ mode: "new_discussion", questionRunId: null });
  });

  it("预算不足等阻塞语义：blocked 优先于其它模式", () => {
    const runs = [run("run-question", "awaiting_author")];
    const decision = decide(runs, ["run-question"]);
    const mode = deriveAgentRunInputMode(decision, presentationFor(decision, runs), {
      blocked: true,
    });
    expect(mode).toEqual({ mode: "blocked", questionRunId: null });
  });
});
