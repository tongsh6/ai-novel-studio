defmodule NovelApplication.ExecutionOrchestrator do
  @moduledoc """
  v3 Execution Orchestrator — 执行权唯一门禁。

  Planner 提出 MicroPlan，Orchestrator 按 gate order 裁决。
  Planner 不能批准自己的执行。
  """

  alias NovelApplication.GateOrder
  alias NovelApplication.PlannerBoundary
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @doc """
  对 MicroPlan 做出裁决。

  返回 OrchestratorDecision。
  """
  @spec decide(DialogueFrame.t(), MicroPlan.t()) :: OrchestratorDecision.t()
  def decide(%DialogueFrame{} = frame, %MicroPlan{} = plan) do
    decision_id = "decision_#{System.unique_integer([:positive, :monotonic])}"

    # 1. PlannerOutput Boundary validation
    case PlannerBoundary.validate(frame, plan) do
      {:error, reason} ->
        build_decision(:fail_with_recovery, decision_id, frame, plan, reason, "planner_boundary")

      :ok ->
        # 2. Run gate order
        case GateOrder.evaluate(plan) do
          {:pass, _results} ->
            # VS-01 does not dispatch tools — this path is future-proof
            build_decision_without_block(decision_id, frame, plan)

          {:block, gate_name, reason, _results} ->
            decision_type = gate_to_decision_type(gate_name)
            build_decision(decision_type, decision_id, frame, plan, reason, gate_name)
        end
    end
  end

  defp gate_to_decision_type(:action_scope), do: :downgrade_to_dialogue
  defp gate_to_decision_type(:authority), do: :require_confirmation
  defp gate_to_decision_type(:write_boundary), do: :require_confirmation
  defp gate_to_decision_type(:envelope_validation), do: :fail_with_recovery
  defp gate_to_decision_type(:correlation), do: :fail_with_recovery
  defp gate_to_decision_type(_), do: :require_confirmation

  defp build_decision(decision_type, decision_id, frame, plan, reason, gate_name) do
    constraints = truthfulness_constraints_for(decision_type)

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
      turn_result_policy: %{truthfulness_constraints: constraints}
    }
  end

  defp build_decision_without_block(decision_id, frame, plan) do
    # VS-01 future-proof: when gates pass, we'd allow but not dispatch
    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :downgrade_to_dialogue,
      decision_status: :decided,
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: action_refs(plan.proposed_actions),
      required_author_action: %{
        action_type: "continue_dialogue",
        message: plan.fallback_strategy.downgrade_message
      },
      first_blocking_gate: "action_scope",
      reason_codes: ["vs01_safety_default", "no_tool_dispatch_in_vs01"],
      turn_result_policy: %{truthfulness_constraints: ["no_action_executed", "downgraded_to_conversation"]}
    }
  end

  defp truthfulness_constraints_for(:downgrade_to_dialogue),
    do: ["no_action_executed", "downgraded_to_conversation"]
  defp truthfulness_constraints_for(:require_confirmation),
    do: ["no_action_executed", "author_confirmation_required"]
  defp truthfulness_constraints_for(:require_clarification),
    do: ["no_action_executed", "scope_or_target_missing"]
  defp truthfulness_constraints_for(:reject),
    do: ["no_action_executed", "blocked_by_policy"]
  defp truthfulness_constraints_for(:fail_with_recovery),
    do: ["no_action_executed", "system_recovery_needed"]

  defp action_refs(actions) do
    Enum.map(actions, fn a ->
      %{
        action_id: a[:action_id],
        action_type: a[:action_type],
        summary: a[:summary]
      }
    end)
  end

  defp author_action_for(type, reason) do
    %{
      action_type: type,
      summary: reason,
      source: :orchestrator_decision
    }
  end
end
