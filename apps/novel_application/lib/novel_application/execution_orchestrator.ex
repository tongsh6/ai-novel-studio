defmodule NovelApplication.ExecutionOrchestrator do
  @moduledoc """
  v3 Execution Orchestrator — 执行权唯一门禁。

  VS-02 扩展：当 gate 全部通过时，对低风险单步 plan 产生 `allow_tool` 决策，
  后续由 Toolbox 执行并产生 ToolTrace。
  """

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.GateOrder
  alias NovelApplication.PlannerBoundary
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @doc """
  对 MicroPlan 做出裁决。VS-02 新增 allow_tool 路径。
  """
  @spec decide(DialogueFrame.t(), MicroPlan.t()) :: OrchestratorDecision.t()
  def decide(%DialogueFrame{} = frame, %MicroPlan{} = plan) do
    decision_id = "decision_#{System.unique_integer([:positive, :monotonic])}"

    case PlannerBoundary.validate(frame, plan) do
      {:error, reason} ->
        build_decision(:fail_with_recovery, decision_id, frame, plan, reason, "planner_boundary")

      :ok ->
        decision_from_gate_result(GateOrder.evaluate(plan), decision_id, frame, plan)
    end
  end

  defp decision_from_gate_result({:pass, _results}, decision_id, frame, plan) do
    if allow_tool_dispatch?(plan) do
      build_allow_decision(decision_id, frame, plan)
    else
      build_decision(:downgrade_to_dialogue, decision_id, frame, plan,
        "gates passed but plan requires confirmation or is multi-step", "action_scope")
    end
  end

  defp decision_from_gate_result({:block, gate_name, reason, _results}, decision_id, frame, plan) do
    build_decision(gate_to_decision_type(gate_name), decision_id, frame, plan, reason, gate_name)
  end

  # ── VS-02: tool dispatch eligibility ──────────

  defp allow_tool_dispatch?(%MicroPlan{} = plan) do
    actions = plan.proposed_actions
    not MicroPlan.multi_step?(plan) and
      not MicroPlan.high_risk?(plan) and
      length(actions) == 1 and
      tool_dispatchable?(hd(actions))
  end

  defp tool_dispatchable?(action) do
    tool_name = tool_name_from_action(action)
    tool_name != nil and CapabilityRegistry.dispatchable?(tool_name)
  end

  defp tool_name_from_action(%{action_type: :capability_invocation} = action) do
    Map.get(action, :target_ref) || action[:capability_name]
  end

  defp tool_name_from_action(_), do: nil

  # ── decision builders ─────────────────────────

  defp build_allow_decision(decision_id, frame, plan) do
    action = hd(plan.proposed_actions)
    tool_name = tool_name_from_action(action)

    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :allow_tool,
      decision_status: :decided,
      approved_actions: action_refs(plan.proposed_actions),
      rejected_actions: [],
      downgraded_actions: [],
      required_author_action: nil,
      first_blocking_gate: nil,
      reason_codes: ["gates_passed", "single_step_low_risk", "tool:#{tool_name}"],
      turn_result_policy: %{truthfulness_constraints: ["tool_dispatched", "result_not_adoption"]}
    }
  end

  defp build_decision(decision_type, decision_id, frame, plan, reason, gate_name) do
    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: decision_type,
      decision_status: :decided,
      approved_actions: [],
      rejected_actions: action_refs(plan.proposed_actions),
      downgraded_actions: action_refs(plan.proposed_actions),
      required_author_action: author_action_for(decision_type, reason),
      first_blocking_gate: to_string(gate_name),
      reason_codes: [to_string(decision_type), reason],
      turn_result_policy: %{truthfulness_constraints: truthfulness_constraints_for(decision_type)}
    }
  end

  # ── helpers ───────────────────────────────────

  defp gate_to_decision_type(:action_scope), do: :downgrade_to_dialogue
  defp gate_to_decision_type(:authority), do: :require_confirmation
  defp gate_to_decision_type(:write_boundary), do: :require_confirmation
  defp gate_to_decision_type(:envelope_validation), do: :fail_with_recovery
  defp gate_to_decision_type(:correlation), do: :fail_with_recovery
  defp gate_to_decision_type(_), do: :require_confirmation

  defp truthfulness_constraints_for(:downgrade_to_dialogue),
    do: ["no_action_executed", "downgraded_to_conversation"]
  defp truthfulness_constraints_for(:require_confirmation),
    do: ["no_action_executed", "author_confirmation_required"]
  defp truthfulness_constraints_for(:reject),
    do: ["no_action_executed", "blocked_by_policy"]
  defp truthfulness_constraints_for(:fail_with_recovery),
    do: ["no_action_executed", "system_recovery_needed"]
  defp truthfulness_constraints_for(_),
    do: ["no_action_executed"]

  defp action_refs(actions) do
    Enum.map(actions, fn a ->
      %{action_id: a[:action_id], action_type: a[:action_type], summary: a[:summary]}
    end)
  end

  defp author_action_for(type, reason) do
    %{action_type: type, summary: reason, source: :orchestrator_decision}
  end
end
