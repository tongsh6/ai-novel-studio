import type { AgentRunStateData } from "./socket";

const TERMINAL_AGENT_RUN_STATUSES = new Set(["completed", "cancelled", "failed"]);
const STEERABLE_AGENT_RUN_STATUSES = new Set(["running", "pausing", "paused", "awaiting_author"]);

export type AgentRunSelectionSource =
  | "open_question"
  | "focused"
  | "recent"
  | "unique_steerable"
  | "ambiguous"
  | "none";

export interface AgentRunSelection {
  run: AgentRunStateData | null;
  source: AgentRunSelectionSource;
  candidateRunIds: string[];
  openQuestionRunIds: string[];
}

export interface OpenAuthorQuestionBinding {
  run_id?: string | null;
  status?: string | null;
  goal_version?: number | null;
}

export interface SelectActiveAgentRunInput {
  runs: readonly AgentRunStateData[];
  /** 已按 B26 author_question 身份（status=open、goal version 匹配）过滤的 run_ids。 */
  openQuestionRunIds?: readonly string[];
  /** 作者最近交互过的 run（点击结果/停等坞、提交 steer、显式回复问题等）。 */
  focusedRunId?: string | null;
  /** 客户端语义活动时间：只记录真实活动（agent_event/turn_result），不用恢复广播到达序。 */
  lastEventAt?: Readonly<Record<string, number>>;
}

export interface DecideAgentRunInputRouteInput extends SelectActiveAgentRunInput {
  pendingAnswerBehaviorId?: string | null;
  generateMicroPlan?: boolean;
}

export type AgentRunInputRoute = "steer" | "user_message";

export type AgentRunInputRouteReason =
  | "active_run_unique"
  | "explicit_micro_plan"
  | "pending_answer"
  | "ambiguous_live_runs"
  | "no_active_run"
  | "active_has_model_question"
  | "other_run_has_model_question"
  | "active_run_not_steerable";

export interface AgentRunInputDecision {
  route: AgentRunInputRoute;
  reason: AgentRunInputRouteReason;
  run: AgentRunStateData | null;
  selection: AgentRunSelection;
}

export type AgentRunInputNoticeKind = "ambiguous" | "question" | null;

export interface AgentRunInputPresentation {
  canSteer: boolean;
  activeRunId: string | null;
  noticeKind: AgentRunInputNoticeKind;
  showRunSelector: boolean;
  selectorRuns: Array<{ run_id: string; goal_text: string }>;
  steerTargetGoalText: string | null;
  liveRunCount: number;
}

export function isTerminalAgentRun(status: string | null | undefined): boolean {
  return TERMINAL_AGENT_RUN_STATUSES.has(String(status ?? ""));
}

export function isSteerableAgentRun(run: AgentRunStateData | null | undefined): boolean {
  if (!run) return false;
  if (TERMINAL_AGENT_RUN_STATUSES.has(run.status)) return false;
  // DS03：runtime 已失活的任务不能再被 steer——输入应作为新请求。
  if (run.runtime_live === false) return false;

  return STEERABLE_AGENT_RUN_STATUSES.has(run.status);
}

export function steerableAgentRuns(runs: readonly AgentRunStateData[]): AgentRunStateData[] {
  return runs.filter(isSteerableAgentRun);
}

function uniqueRunIds(runIds: readonly (string | null | undefined)[]): string[] {
  return [...new Set(runIds.filter((runId): runId is string => Boolean(runId)))];
}

// 共享的当前绑定判断：status=open、问题属于该 run、run 仍可继续且 goal version 匹配。
function isCurrentOpenAuthorQuestion(
  question: OpenAuthorQuestionBinding | null | undefined,
  run: AgentRunStateData | null | undefined,
): boolean {
  if (!run || !isSteerableAgentRun(run)) return false;
  if (question?.status !== "open" || !question.run_id) return false;
  if (String(question.run_id) !== run.run_id) return false;
  const runVersion = run.goal?.version ?? null;
  const questionVersion = question.goal_version ?? null;
  return questionVersion === null || runVersion === null || questionVersion === runVersion;
}

/**
 * B31 §6.2 Q01：B26 显式问题只在 status=open 且 goal version 与 run 当前版本匹配时
 * 才算「未答问题」。版本缺失（旧持久记录/尚未投影）按匹配处理，避免漏掉真实 open 问题。
 */
export function openQuestionRunIdsForRuns(
  runs: readonly AgentRunStateData[],
  questions: readonly OpenAuthorQuestionBinding[],
): string[] {
  // 只有仍可继续的 run 上的 open question 才会参与输入归属；terminal/失活 run 的
  // 历史问题不能被当成「等待回复」。
  const runById = new Map(steerableAgentRuns(runs).map((run) => [run.run_id, run]));
  return uniqueRunIds(
    questions
      .filter((question) =>
        isCurrentOpenAuthorQuestion(
          question,
          question.run_id ? runById.get(String(question.run_id)) : null,
        ),
      )
      .map((question) => String(question.run_id)),
  );
}

/**
 * B81 CP5：从 turn_result 来源（消息历史与 open-question snapshot，按调用方给定
 * 顺序）中找出该具体 run 的未答问题，与 openQuestionRunIdsForRuns 共享同一
 * run/status/goal_version 绑定判断。run 版本已知时精确版本优先，缺失版本的记录
 * 只作兼容回退，不能遮蔽精确匹配的当前题。
 */
export function findCurrentOpenAuthorQuestion<
  T extends { author_question?: OpenAuthorQuestionBinding | null },
>(
  run: AgentRunStateData | null | undefined,
  sources: readonly (readonly (T | null | undefined)[])[],
): T | null {
  if (!run || !isSteerableAgentRun(run)) return null;

  const candidates = sources
    .flat()
    .filter((result): result is T => Boolean(result))
    .filter((result) => isCurrentOpenAuthorQuestion(result.author_question, run));

  const runVersion = run.goal?.version ?? null;
  if (runVersion === null) return candidates[0] ?? null;
  return (
    candidates.find((result) => result.author_question?.goal_version === runVersion) ??
    candidates.find((result) => (result.author_question?.goal_version ?? null) === null) ??
    null
  );
}

/**
 * B31 §6.2 Q01：确定性 active run 选择。
 * 优先级：① 唯一 open question 所属 run；② focusedRunId；③ 唯一最近活动 run；
 * ④ 唯一 steerable run；⑤ 否则 ambiguous（不猜）。禁止 Map 插入序/广播到达序。
 */
export function selectActiveAgentRun({
  runs,
  openQuestionRunIds = [],
  focusedRunId = null,
  lastEventAt = {},
}: SelectActiveAgentRunInput): AgentRunSelection {
  const candidates = steerableAgentRuns(runs);
  const candidateRunIds = candidates.map((run) => run.run_id);
  const liveRunIds = new Set(candidateRunIds);
  const openRunIds = uniqueRunIds(openQuestionRunIds).filter((runId) => liveRunIds.has(runId));
  const base = { candidateRunIds, openQuestionRunIds: openRunIds };

  if (candidates.length === 0) {
    return { ...base, run: null, source: "none" };
  }

  const questionRuns = candidates.filter((run) => openRunIds.includes(run.run_id));
  if (questionRuns.length === 1) {
    return { ...base, run: questionRuns[0], source: "open_question" };
  }

  if (focusedRunId) {
    const focused = candidates.find((run) => run.run_id === focusedRunId);
    if (focused) return { ...base, run: focused, source: "focused" };
  }

  const timedCandidates = candidates
    .map((run) => ({ run, at: lastEventAt?.[run.run_id] }))
    .filter(
      (entry): entry is { run: AgentRunStateData; at: number } =>
        typeof entry.at === "number" && Number.isFinite(entry.at),
    );
  if (timedCandidates.length > 0) {
    const latestAt = Math.max(...timedCandidates.map((entry) => entry.at));
    const latestRuns = timedCandidates.filter((entry) => entry.at === latestAt);
    if (latestRuns.length === 1) {
      return { ...base, run: latestRuns[0].run, source: "recent" };
    }
  }

  if (candidates.length === 1) {
    return { ...base, run: candidates[0], source: "unique_steerable" };
  }

  return { ...base, run: null, source: "ambiguous" };
}

/**
 * B31 §6.2 Q02：普通主输入只有在「active run 唯一确定 + 无其它 run 未答 open question
 * + 无 pending answer/显式计划请求」时才走 plain steer；否则按新请求走 user_message。
 */
export function decideAgentRunInputRoute({
  runs,
  openQuestionRunIds = [],
  focusedRunId = null,
  lastEventAt = {},
  pendingAnswerBehaviorId = null,
  generateMicroPlan = false,
}: DecideAgentRunInputRouteInput): AgentRunInputDecision {
  const selection = selectActiveAgentRun({
    runs,
    openQuestionRunIds,
    focusedRunId,
    lastEventAt,
  });
  const liveRunIds = new Set(steerableAgentRuns(runs).map((run) => run.run_id));
  const openRunIds = uniqueRunIds(openQuestionRunIds).filter((runId) => liveRunIds.has(runId));

  if (generateMicroPlan) {
    return { route: "user_message", reason: "explicit_micro_plan", run: null, selection };
  }
  if (pendingAnswerBehaviorId) {
    return { route: "user_message", reason: "pending_answer", run: null, selection };
  }
  if (!selection.run) {
    return {
      route: "user_message",
      reason: selection.source === "ambiguous" ? "ambiguous_live_runs" : "no_active_run",
      run: null,
      selection,
    };
  }

  const activeRun = selection.run;
  if (openRunIds.includes(activeRun.run_id)) {
    return {
      route: "user_message",
      reason: "active_has_model_question",
      run: activeRun,
      selection,
    };
  }
  if (openRunIds.some((runId) => runId !== activeRun.run_id)) {
    return {
      route: "user_message",
      reason: "other_run_has_model_question",
      run: activeRun,
      selection,
    };
  }
  if (!isSteerableAgentRun(activeRun)) {
    return {
      route: "user_message",
      reason: "active_run_not_steerable",
      run: activeRun,
      selection,
    };
  }

  return { route: "steer", reason: "active_run_unique", run: activeRun, selection };
}

export function agentRunGoalSummary(run: AgentRunStateData | null | undefined): string {
  const goalText = typeof run?.goal?.text === "string" ? run.goal.text : "";
  const firstLine =
    goalText
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

/**
 * B31 §6.2 Q05：输入区展示模型（是否 steer、将发给哪个任务、歧义/等待问题提示、
 * 多 live run 时的任务选择项）。纯函数，供 WorkspaceChat 渲染与单测共用。
 */
export function buildAgentRunInputPresentation(
  decision: AgentRunInputDecision,
  runs: readonly AgentRunStateData[],
): AgentRunInputPresentation {
  const candidates = steerableAgentRuns(runs);
  const candidateById = new Map(candidates.map((run) => [run.run_id, run]));
  const selectorRuns = decision.selection.candidateRunIds
    .map((runId) => candidateById.get(runId))
    .filter((run): run is AgentRunStateData => Boolean(run))
    .map((run) => ({ run_id: run.run_id, goal_text: agentRunGoalSummary(run) }));
  const canSteer = decision.route === "steer" && decision.run !== null;

  let noticeKind: AgentRunInputNoticeKind = null;
  if (!canSteer) {
    if (
      decision.reason === "active_has_model_question" ||
      decision.reason === "other_run_has_model_question"
    ) {
      noticeKind = "question";
    } else if (decision.reason === "ambiguous_live_runs") {
      noticeKind = "ambiguous";
    }
  }

  return {
    canSteer,
    activeRunId: decision.run?.run_id ?? null,
    noticeKind,
    showRunSelector: noticeKind === "ambiguous" && selectorRuns.length > 1,
    selectorRuns,
    steerTargetGoalText: canSteer ? agentRunGoalSummary(decision.run) : null,
    liveRunCount: candidates.length,
  };
}

/**
 * 输入区语义模式（46 §9.7，2026-11-04 作者拍板「等待即回答」）。
 *
 * 输入区原本多语义（新讨论/调整任务/回答模型问题/预算不足），此前散落在
 * WorkspaceChat 的条件判断里。这里把语义收敛为单一派生：视图只按 mode 渲染，
 * 不再各自推断。
 *
 * - `answer_question`：当前 active run 有未答模型问题（作者未显式选择新讨论）——
 *   主输入区接管为回答入口，回答走 `author_choice` 同 run 继续；
 * - `steer`：唯一可 steer 的 active run 且无未答问题——输入即调整当前任务；
 * - `new_discussion`：普通新请求（含作者显式「开始新讨论」、其它 run 有问题等）；
 * - `blocked`：预算不足等不可输入场景，恢复动作由控制坞既有矩阵负责。
 */
export type AgentRunInputMode = "answer_question" | "steer" | "new_discussion" | "blocked";

export interface AgentRunInputModeOptions {
  /** 作者显式「开始新讨论」后为 true：即使有未答模型问题也按新讨论处理。 */
  answerModeDismissed?: boolean;
  /** 预算不足等既有阻塞语义（budgetShortfallAwaiting）。 */
  blocked?: boolean;
}

export interface AgentRunInputModeState {
  mode: AgentRunInputMode;
  /** `answer_question` 时承载该问题的 run_id；否则 null。 */
  questionRunId: string | null;
}

export function deriveAgentRunInputMode(
  decision: AgentRunInputDecision,
  presentation: AgentRunInputPresentation,
  options: AgentRunInputModeOptions = {},
): AgentRunInputModeState {
  if (options.blocked === true) {
    return { mode: "blocked", questionRunId: null };
  }
  const answerableRunId =
    decision.reason === "active_has_model_question" ? (decision.run?.run_id ?? null) : null;
  if (answerableRunId !== null && options.answerModeDismissed !== true) {
    return { mode: "answer_question", questionRunId: answerableRunId };
  }
  if (presentation.canSteer) {
    return { mode: "steer", questionRunId: null };
  }
  return { mode: "new_discussion", questionRunId: null };
}
