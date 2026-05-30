defmodule NovelApplication.ExecutionOrchestrator do
  @moduledoc """
  v3 Execution Orchestrator — 执行权唯一门禁。Planner 不能批准自己的 MicroPlan。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.GateOrder
  alias NovelApplication.PlannerBoundary
  alias NovelCommon.LogContext
  alias NovelDomain.BehaviorState
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @doc "裁决 MicroPlan。返回 {decision, behavior}。"
  @spec decide(DialogueFrame.t(), MicroPlan.t()) ::
          {OrchestratorDecision.t(), BehaviorState.t() | nil}
  def decide(%DialogueFrame{} = frame, %MicroPlan{} = plan) do
    decision_id = "decision_#{System.unique_integer([:positive, :monotonic])}"
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:orchestrator, :decide, :start, %{})

    {decision, behavior} =
      case PlannerBoundary.validate(frame, plan) do
        {:error, reason} ->
          {build_decision(
             :fail_with_recovery,
             decision_id,
             frame,
             plan,
             reason,
             "planner_boundary"
           ), nil}

        :ok ->
          decision_from_gate_result(GateOrder.evaluate(plan), decision_id, frame, plan)
      end

    LogContext.put_decision(decision_id)

    duration = System.monotonic_time(:millisecond) - t0

    LogEmit.emit(:orchestrator, :decide, :done, %{
      decision_type: decision.decision_type,
      decision_id: decision_id,
      has_behavior: behavior != nil,
      duration_ms: duration
    })

    {decision, behavior}
  end

  # ── gate result handling ──────────────────────

  defp decision_from_gate_result({:pass, _results}, decision_id, frame, plan) do
    if allow_tool_dispatch?(plan) do
      {build_allow_decision(decision_id, frame, plan), nil}
    else
      {build_decision(
         :downgrade_to_dialogue,
         decision_id,
         frame,
         plan,
         "gates passed but plan requires confirmation or is multi-step",
         "action_scope"
       ), nil}
    end
  end

  defp decision_from_gate_result({:block, gate_name, reason, _results}, decision_id, frame, plan) do
    decision_type = gate_to_decision_type(gate_name)
    decision = build_decision(decision_type, decision_id, frame, plan, reason, gate_name)

    behavior =
      if decision_type == :require_confirmation do
        open_behavior(decision_type, decision_id, frame, plan, reason)
      end

    {decision, behavior}
  end

  # ── behavior lifecycle ────────────────────────

  defp open_behavior(decision_type, decision_id, frame, plan, reason) do
    action = hd(plan.proposed_actions)
    target = action[:target_ref]
    behavior_id = "bh_#{System.unique_integer([:positive, :monotonic])}"

    behavior_type =
      if decision_type == :require_confirmation, do: :confirmation, else: :clarification

    %BehaviorState{
      behavior_id: behavior_id,
      behavior_type: behavior_type,
      lifecycle_status: :awaiting_author,
      blocking_actor: :author,
      opened_at_turn_ref: frame.turn_id,
      opened_by_decision_ref: decision_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      target_ref: target,
      required_next_action: behavior_next_action(behavior_type),
      available_actions: behavior_actions(behavior_type, decision_id, behavior_id, target),
      prompt_contract: %{question: reason},
      constraints: %{risk: plan.risk_hint}
    }
  end

  defp behavior_next_action(:clarification), do: "answer_clarification"
  defp behavior_next_action(:confirmation), do: "confirm_before_execute"
  defp behavior_next_action(_), do: "continue_dialogue"

  # behavior_ref 必须指向 behavior 自身（ADR-0009 / VS-03），前端按
  # action.behavior_ref == behavior_state.active.behavior_id 门控确认动作显隐。
  # action_id / idempotency_key 仍以 decision_id 为键（一次决定一组动作）。
  defp behavior_actions(:clarification, d_id, behavior_id, target) do
    [
      %{
        action_id: "act_answer_#{d_id}",
        action_type: "answer_clarification",
        behavior_ref: behavior_id,
        target_ref: target,
        idempotency_key: "clarify_#{d_id}"
      },
      %{
        action_id: "act_cancel_#{d_id}",
        action_type: "cancel_pending_behavior",
        behavior_ref: behavior_id,
        target_ref: target,
        idempotency_key: "cancel_#{d_id}"
      }
    ]
  end

  defp behavior_actions(:confirmation, d_id, behavior_id, target) do
    [
      %{
        action_id: "act_confirm_#{d_id}",
        action_type: "confirm_before_execute",
        behavior_ref: behavior_id,
        target_ref: target,
        idempotency_key: "confirm_#{d_id}"
      },
      %{
        action_id: "act_reject_#{d_id}",
        action_type: "reject_or_cancel_confirmation",
        behavior_ref: behavior_id,
        target_ref: target,
        idempotency_key: "reject_#{d_id}"
      }
    ]
  end

  defp behavior_actions(_, _, _, _), do: []

  # ── VS-02 tool dispatch ───────────────────────

  defp allow_tool_dispatch?(%MicroPlan{} = plan) do
    actions = plan.proposed_actions

    not MicroPlan.multi_step?(plan) and not MicroPlan.high_risk?(plan) and
      length(actions) == 1 and tool_dispatchable?(hd(actions))
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
  defp gate_to_decision_type(:policy), do: :reject
  defp gate_to_decision_type(:envelope_validation), do: :fail_with_recovery
  defp gate_to_decision_type(:correlation), do: :fail_with_recovery
  defp gate_to_decision_type(_), do: :require_confirmation

  defp truthfulness_constraints_for(:downgrade_to_dialogue),
    do: ["no_action_executed", "downgraded_to_conversation"]

  defp truthfulness_constraints_for(:require_confirmation),
    do: ["no_action_executed", "author_confirmation_required"]

  defp truthfulness_constraints_for(:require_clarification),
    do: ["no_action_executed", "author_clarification_required"]

  defp truthfulness_constraints_for(:reject),
    do: ["no_action_executed", "blocked_by_policy"]

  defp truthfulness_constraints_for(:fail_with_recovery),
    do: ["no_action_executed", "system_recovery_needed"]

  defp truthfulness_constraints_for(_), do: ["no_action_executed"]

  defp action_refs(actions) do
    Enum.map(actions, fn a ->
      %{action_id: a[:action_id], action_type: a[:action_type], summary: a[:summary]}
    end)
  end

  defp author_action_for(type, reason) do
    %{action_type: type, summary: reason, source: :orchestrator_decision}
  end
end
