import { TRACE } from "./copy";

export interface TraceContextSourceView {
  key: string;
  label: string;
  summary: string | null;
}

export interface TraceSummaryView {
  primaryReason: string;
  decisionLabel: string;
  goal: string | null;
  contextSources: TraceContextSourceView[];
  detailLines: string[];
  integrityNote: string;
}

type TraceSummaryLike = Record<string, unknown>;

const authorRoleTextPattern =
  /(?:^|\s)(?:作者|user)[:：]\s*(.*?)(?=\s(?:作者|AI|user|assistant)[:：]|$)/gu;
const assistantRoleTextPattern =
  /(?:^|\s)(?:AI|assistant)[:：]\s*(.*?)(?=\s(?:作者|AI|user|assistant)[:：]|$)/gu;

const decisionLabels: Record<string, string> = {
  reply_only: TRACE.decisions.replyOnly,
  exploration: TRACE.decisions.exploration,
  downgrade: TRACE.decisions.downgrade,
  confirmation_required: TRACE.decisions.confirmationRequired,
  clarification_required: TRACE.decisions.clarificationRequired,
  rejected: TRACE.decisions.rejected,
  recovery: TRACE.decisions.recovery,
  fail_with_recovery: TRACE.decisions.recovery,
  tool_allowed: TRACE.decisions.toolAllowed,
  tool_dispatched: TRACE.decisions.toolDispatched,
  adopt_tentative: TRACE.decisions.adoptTentative,
};

const noToolReasons: Record<string, string> = {
  no_tool_needed: TRACE.reasons.noToolNeeded,
  exploratory_only: TRACE.reasons.exploratoryOnly,
  user_requested_discussion: TRACE.reasons.userRequestedDiscussion,
  tool_was_dispatched: TRACE.reasons.toolWasDispatched,
  micro_plan_evaluated_by_orchestrator: TRACE.reasons.microPlanEvaluated,
  micro_plan_generation_failed: TRACE.reasons.microPlanFailed,
};

const gateReasons: Record<string, string> = {
  action_scope: TRACE.gates.actionScope,
  planner_boundary: TRACE.gates.plannerBoundary,
  authority_budget: TRACE.gates.authorityBudget,
  confirmation_required: TRACE.gates.confirmationRequired,
};

const reasonCodeLabels: Record<string, string> = {
  gates_passed: TRACE.reasonCodes.gatesPassed,
  candidate_adopted_as_tentative: TRACE.reasonCodes.candidateAdoptedAsTentative,
  tool_result_not_adoption: TRACE.reasonCodes.toolResultNotAdoption,
};

const contextSourceLabels: Record<string, string> = {
  current_work: TRACE.contextSources.currentWork,
  conversation: TRACE.contextSources.recentDialogue,
  recent_dialogue: TRACE.contextSources.recentDialogue,
  memory: TRACE.contextSources.memory,
  work_archive: TRACE.contextSources.workArchive,
  session_transcript: TRACE.contextSources.sessionTranscript,
};

export function toAuthorTraceSummary(
  traceSummary: TraceSummaryLike | null | undefined,
): TraceSummaryView | null {
  if (!traceSummary || typeof traceSummary !== "object") return null;

  const decisionType = stringValue(traceSummary.decision_type);
  const noToolReason = stringValue(traceSummary.no_tool_reason);
  const primaryReason = reasonText(noToolReason, decisionType);
  const contextSources = contextSourceViews(traceSummary.context_refs);
  const details = detailLines(traceSummary);

  return {
    primaryReason,
    decisionLabel: decisionLabel(decisionType),
    goal: authorSafeGoal(traceSummary.dialogue_goal) || authorSafeGoal(traceSummary.plan_goal),
    contextSources,
    detailLines: details,
    integrityNote: TRACE.integrityNote,
  };
}

function reasonText(noToolReason: string | null, decisionType: string | null): string {
  if (noToolReason && noToolReasons[noToolReason]) return noToolReasons[noToolReason];
  if (decisionType === "tool_dispatched") return TRACE.reasons.toolWasDispatched;
  if (decisionType === "confirmation_required") return TRACE.reasons.confirmationRequired;
  if (decisionType === "clarification_required") return TRACE.reasons.clarificationRequired;
  if (decisionType === "rejected") return TRACE.reasons.rejected;
  if (decisionType === "recovery" || decisionType === "fail_with_recovery") {
    return TRACE.reasons.microPlanFailed;
  }

  return TRACE.reasons.safeFallback;
}

function decisionLabel(decisionType: string | null): string {
  if (!decisionType) return TRACE.decisions.unknown;
  return decisionLabels[decisionType] ?? TRACE.decisions.unknown;
}

function contextSourceViews(value: unknown): TraceContextSourceView[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const views: TraceContextSourceView[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const sourceType = stringValue((item as TraceSummaryLike).source_type);
    if (!sourceType || seen.has(sourceType)) continue;
    const summary = authorSafeSummary((item as TraceSummaryLike).summary, sourceType);
    if (shouldHideContextSource(sourceType, summary)) continue;

    seen.add(sourceType);
    views.push({
      key: sourceType,
      label: contextSourceLabels[sourceType] ?? TRACE.contextSources.other,
      summary,
    });
  }

  return views;
}

function authorSafeGoal(value: unknown): string | null {
  const goal = authorSafeText(value);
  if (!goal) return null;

  const normalized = goal
    .replace(/^(用户|作者|你)\s*(想要|希望|想|要求|需要|打算|正在|提出)?\s*/u, "")
    .replace(/^讨论并确定/u, "讨论")
    .trim();

  if (!normalized) return null;
  if (isLowValueGoal(normalized)) return null;

  return normalized.slice(0, 72);
}

function authorSafeSummary(value: unknown, sourceType: string): string | null {
  const summary = authorSafeText(value);
  if (!summary) return null;
  if (
    sourceType === "conversation" ||
    sourceType === "recent_dialogue" ||
    sourceType === "session_transcript"
  ) {
    return summarizeConversation(summary);
  }

  return summary;
}

function authorSafeText(value: unknown): string | null {
  const summary = stringValue(value);
  if (!summary) return null;

  const normalized = summary.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!normalized) return null;
  if (/(trace_|ctx_|mem_|raw prompt|provider raw|hidden policy|debug)/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function summarizeConversation(summary: string): string {
  if (!/(^|\s)(作者|AI|user|assistant)：?/u.test(summary)) return summary;

  const authorText = latestRoleText(summary, authorRoleTextPattern);
  const assistantText = latestRoleText(summary, assistantRoleTextPattern);

  if (authorText && assistantText) return TRACE.previousDialogueSummary(authorText);
  if (authorText) return TRACE.previousAuthorMention(authorText);
  if (assistantText) return TRACE.previousAssistantReply;

  return TRACE.previousAssistantReply;
}

function latestRoleText(summary: string, pattern: RegExp): string | null {
  pattern.lastIndex = 0;
  const matches = [...summary.matchAll(pattern)];
  const last = matches.at(-1)?.[1]?.trim();
  return last ? last.slice(0, 48) : null;
}

function shouldHideContextSource(sourceType: string, summary: string | null): boolean {
  if (sourceType !== "current_work") return false;
  if (!summary) return true;
  return summary === "当前作品背景" || summary === "未命名作品";
}

function isLowValueGoal(goal: string): boolean {
  if (/^(气质氛围|讨论并确定|用户意图|作者意图)$/u.test(goal)) return true;
  if (
    goal.length <= 8 &&
    !/(讨论|探索|回答|解释|整理|确认|生成|创作|补充|规划|分析|澄清|继续|构思|完善|推进|比较|选择|复盘|修改|改写)/u.test(
      goal,
    )
  ) {
    return true;
  }

  return false;
}

function detailLines(summary: TraceSummaryLike): string[] {
  const lines: string[] = [];

  const gate = stringValue(summary.first_blocking_gate);
  if (gate) lines.push(gateReasons[gate] ?? TRACE.gates.generic);

  const reasonCodes = Array.isArray(summary.reason_codes) ? summary.reason_codes : [];
  for (const code of reasonCodes) {
    const key = stringValue(code);
    if (!key) continue;
    lines.push(reasonCodeLabels[key] ?? TRACE.reasonCodes.generic);
  }

  const toolName = stringValue(summary.tool_name);
  const toolStatus = stringValue(summary.tool_status);
  if (toolName) {
    const label = toolNameLabel(toolName);
    lines.push(
      toolStatus ? TRACE.toolWithStatus(label, toolStatusLabel(toolStatus)) : TRACE.toolUsed(label),
    );
  }

  const recovery = stringValue(summary.recovery);
  if (recovery) lines.push(TRACE.recoveryApplied);

  // WR01b：这一章按什么使命写的（author-safe 一句话，非 ref）。
  const missionStatement = stringValue(summary.chapter_mission_statement);
  if (missionStatement) lines.push(TRACE.chapterMission(missionStatement));

  lines.push(...aiMessageEnvelopeLines(summary.ai_message_envelope));
  lines.push(...replayIntegrityLines(summary));

  return unique(lines);
}

function replayIntegrityLines(summary: TraceSummaryLike): string[] {
  const lines: string[] = [];
  const replayStatus = stringValue(summary.replay_result_status);
  const providerCalled = booleanValue(summary.replay_provider_called);

  if (replayStatus === "complete") lines.push(TRACE.replayComplete);
  if (replayStatus === "partial") lines.push(TRACE.replayPartial);
  if (providerCalled === false) lines.push(TRACE.replayNoProvider);

  return lines;
}

function aiMessageEnvelopeLines(value: unknown): string[] {
  const envelope = objectValue(value);
  if (!envelope) return [];

  const guidance = objectValue(envelope.turn_guidance_layer);
  const novelLayer = objectValue(envelope.novel_layer);
  const workState = objectValue(envelope.work_state_layer);
  const lines: string[] = [];

  const guidanceMode = stringValue(guidance?.guidance_mode);
  if (guidanceMode === "quality") lines.push(TRACE.guidance.qualityDiagnosis);

  const focus = stringArray(guidance?.element_focus).map(qualityFocusLabel);
  if (focus.length > 0) lines.push(TRACE.guidance.qualityFocus(focus.join("、")));

  const gates = stringArray(novelLayer?.quality_gates).map(qualityFocusLabel);
  if (gates.length > 0) lines.push(TRACE.guidance.qualityGates(gates.join("、")));

  const sources = workStateSources(workState?.context_refs);
  if (sources.length > 0) {
    lines.push(TRACE.guidance.workStateSources(sources.join("、")));
  }
  if (workStateMissing(workState)) {
    lines.push(TRACE.guidance.workStateMissing);
  }

  const missingQuestions = stringArray(guidance?.missing_questions);
  if (missingQuestions.some((question) => question.includes("正文片段"))) {
    lines.push(TRACE.guidance.missingLimit);
  }

  return lines;
}

function objectValue(value: unknown): TraceSummaryLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as TraceSummaryLike;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
}

function workStateSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const labels: string[] = [];
  for (const item of value) {
    const source = objectValue(item);
    const sourceType = stringValue(source?.source_type);
    if (!sourceType) continue;
    labels.push(contextSourceLabels[sourceType] ?? TRACE.contextSources.other);
  }

  return unique(labels);
}

function workStateMissing(workState: TraceSummaryLike | null): boolean {
  if (!workState) return true;
  return (
    missingStatus(workState.snapshot_summary) ||
    missingStatus(workState.chapter_state) ||
    missingStatus(workState.chapter_summary)
  );
}

function missingStatus(value: unknown): boolean {
  const object = objectValue(value);
  return stringValue(object?.status) === "missing";
}

function qualityFocusLabel(value: string): string {
  const labels: Record<string, string> = {
    conflict_pressure: "冲突压力",
    cost_visibility: "代价可见",
    reader_payoff: "读者回报",
    protagonist_agency: "主角能动性",
  };

  return labels[value] ?? "创作质量";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toolStatusLabel(status: string): string {
  if (status === "ok" || status === "success" || status === "completed") return "已完成";
  if (status === "error" || status === "failed") return "失败";
  if (status === "pending") return "待处理";
  return "已记录";
}

function toolNameLabel(name: string): string {
  if (name === "creative_generator") return "创作生成";
  if (name === "text_analysis") return "文本分析";
  return "创作工具";
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
