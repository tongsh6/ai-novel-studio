import { TRACE } from "./copy";

export interface TraceContextSourceView {
  key: string;
  label: string;
}

export interface TraceSummaryView {
  title: string;
  primaryReason: string;
  decisionLabel: string;
  goal: string | null;
  contextSources: TraceContextSourceView[];
  detailLines: string[];
  integrityNote: string;
}

type TraceSummaryLike = Record<string, unknown>;

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
    title: TRACE.title,
    primaryReason,
    decisionLabel: decisionLabel(decisionType),
    goal: stringValue(traceSummary.dialogue_goal) || stringValue(traceSummary.plan_goal),
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

    seen.add(sourceType);
    views.push({
      key: sourceType,
      label: contextSourceLabels[sourceType] ?? TRACE.contextSources.other,
    });
  }

  return views;
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
    lines.push(toolStatus ? TRACE.toolWithStatus(label, toolStatusLabel(toolStatus)) : TRACE.toolUsed(label));
  }

  const recovery = stringValue(summary.recovery);
  if (recovery) lines.push(TRACE.recoveryApplied);

  return unique(lines);
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
