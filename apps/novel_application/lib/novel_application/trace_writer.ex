defmodule NovelApplication.TraceWriter do
  @moduledoc """
  v3 trace 写入。VS-02 扩展：记录 ToolTrace。
  """

  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DecisionTrace
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.ToolRequest
  alias NovelDomain.ToolResult

  @doc "Record reply-only/exploration trace."
  @spec record(DialogueFrame.t(), map(), DialogueContext.t() | nil) :: {DecisionTrace.t(), map()}
  def record(%DialogueFrame{} = frame, turn_result, context \\ nil) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id, turn_id: frame.turn_id, frame_ref: frame.frame_id,
      decision_type: decision_type(frame.frame_type),
      no_tool_reason: to_string(frame.tool_need.reason_code),
      no_behavior_reason: no_behavior_reason(frame.frame_type),
      no_write_reason: "this turn does not perform production write",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: build_event_order(context)
    }

    summary = %{
      trace_ref: trace_id, decision_type: trace.decision_type,
      frame_type: frame.frame_type, dialogue_goal: frame.dialogue_goal.summary,
      no_tool_reason: trace.no_tool_reason,
      context_refs: format_context_refs(context_refs),
      has_context: context != nil and DialogueContext.has_context?(context)
    }

    {trace, summary}
  end

  @doc "Record trace with OrchestratorDecision and gate results."
  @spec record_with_decision(
    DialogueFrame.t(), MicroPlan.t(), OrchestratorDecision.t(), map(), DialogueContext.t() | nil
  ) :: {DecisionTrace.t(), map()}
  def record_with_decision(%DialogueFrame{} = frame, %MicroPlan{} = plan, %OrchestratorDecision{} = decision, turn_result, context) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id, turn_id: frame.turn_id, frame_ref: frame.frame_id,
      decision_type: decision_type_for(decision.decision_type),
      no_tool_reason: "micro_plan_evaluated_by_orchestrator",
      no_behavior_reason: no_behavior_reason(frame.frame_type),
      no_write_reason: "orchestrator blocked execution: #{decision.first_blocking_gate}",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [
        :author_input_received,
        :dialogue_context_attached,
        :dialogue_frame_validated,
        :micro_plan_generated,
        :planner_boundary_validated,
        :gate_evaluation_started,
        :orchestrator_decision_recorded,
        :turn_result_emitted
      ]
    }

    summary = %{
      trace_ref: trace_id, decision_type: trace.decision_type,
      frame_type: frame.frame_type, dialogue_goal: frame.dialogue_goal.summary,
      plan_goal: plan.plan_goal.summary, plan_actions: length(plan.proposed_actions),
      orchestrator_decision: decision.decision_type,
      first_blocking_gate: decision.first_blocking_gate,
      reason_codes: decision.reason_codes,
      context_refs: format_context_refs(context_refs)
    }

    {trace, summary}
  end

  @doc "Record trace with tool execution (VS-02)."
  @spec record_with_tool(
    DialogueFrame.t(), MicroPlan.t(), OrchestratorDecision.t(),
    ToolRequest.t(), ToolResult.t(), map(), DialogueContext.t() | nil
  ) :: {DecisionTrace.t(), map()}
  def record_with_tool(
    %DialogueFrame{} = frame, %MicroPlan{} = _plan, %OrchestratorDecision{} = decision,
    %ToolRequest{} = req, %ToolResult{} = result, turn_result, context
  ) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id, turn_id: frame.turn_id, frame_ref: frame.frame_id,
      decision_type: :tool_dispatched,
      no_tool_reason: "tool_was_dispatched",
      no_behavior_reason: "tool_execution_completed",
      no_write_reason: "tool_result_not_adoption_awaiting_adoption_boundary",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [
        :author_input_received,
        :dialogue_frame_validated,
        :micro_plan_generated,
        :orchestrator_decision_allow_tool,
        :tool_request_constructed,
        :tool_dispatched,
        :tool_result_received,
        :tool_trace_recorded,
        :turn_result_emitted
      ]
    }

    summary = %{
      trace_ref: trace_id,
      decision_type: :tool_dispatched,
      tool_name: req.tool_name,
      tool_version: req.tool_version,
      tool_status: result.status,
      tool_request_id: req.tool_request_id,
      tool_result_id: result.tool_result_id,
      decision_ref: decision.decision_id,
      adoption_status: "not_adopted",
      context_refs: format_context_refs(context_refs)
    }

    {trace, summary}
  end

  @doc "Record recovery trace when plan generation fails."
  @spec record_recovery(DialogueFrame.t(), map(), DialogueContext.t() | nil) :: {DecisionTrace.t(), map()}
  def record_recovery(%DialogueFrame{} = frame, turn_result, _context) do
    trace_id = allocate_trace_id()

    trace = %DecisionTrace{
      trace_id: trace_id, turn_id: frame.turn_id, frame_ref: frame.frame_id,
      decision_type: :fail_with_recovery,
      no_tool_reason: "micro_plan_generation_failed",
      no_behavior_reason: "recovery mode: reverted to reply-only",
      no_write_reason: "plan generation failed, no execution attempted",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [
        :author_input_received, :dialogue_frame_validated,
        :micro_plan_generation_failed, :recovery_fallback, :turn_result_emitted
      ]
    }

    summary = %{
      trace_ref: trace_id, decision_type: :fail_with_recovery,
      frame_type: frame.frame_type, dialogue_goal: frame.dialogue_goal.summary,
      recovery: "plan generation failed, reverted to reply_only"
    }

    {trace, summary}
  end

  # ── helpers ───────────────────────────────────

  defp decision_type(:creative_exploration), do: :exploration
  defp decision_type(_), do: :reply_only

  defp decision_type_for(:downgrade_to_dialogue), do: :downgrade
  defp decision_type_for(:require_confirmation), do: :confirmation_required
  defp decision_type_for(:require_clarification), do: :clarification_required
  defp decision_type_for(:reject), do: :rejected
  defp decision_type_for(:fail_with_recovery), do: :recovery
  defp decision_type_for(:allow_tool), do: :tool_allowed

  defp no_behavior_reason(:creative_exploration), do: "exploration stays conversational"
  defp no_behavior_reason(_), do: "reply-only turn does not open durable behavior"

  defp build_event_order(context) do
    base = [:author_input_received, :dialogue_context_attached, :dialogue_frame_validated,
            :decision_recorded, :turn_result_emitted]
    if context && DialogueContext.has_context?(context) do
      base
    else
      List.delete(base, :dialogue_context_attached) |> List.insert_at(1, :dialogue_context_empty)
    end
  end

  defp format_context_refs(refs) when is_list(refs) do
    Enum.map(refs, fn %ContextSourceRef{} = ref ->
      %{context_ref: ref.context_ref, source_type: ref.source_type}
    end)
  end
  defp format_context_refs(_), do: []

  defp allocate_trace_id, do: "trace_#{System.unique_integer([:positive, :monotonic])}"
end
