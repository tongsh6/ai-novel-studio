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
  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @author_action_ttl_seconds 900

  # gate → decision_type 翻译表（ADR-0005 gate 顺序是开放集合：新增 gate 走保守
  # require_confirmation，保留 policy 等历史映射供后续 slice 复用）。
  @gate_decision_types %{
    action_scope: :downgrade_to_dialogue,
    authority: :require_confirmation,
    write_boundary: :require_confirmation,
    policy: :reject,
    envelope_validation: :fail_with_recovery,
    correlation: :fail_with_recovery
  }
  @default_gate_decision_type :require_confirmation

  # decision_type → TurnResult 真实性约束。
  @truthfulness_constraints %{
    downgrade_to_dialogue: ["no_action_executed", "downgraded_to_conversation"],
    require_confirmation: ["no_action_executed", "author_confirmation_required"],
    require_clarification: ["no_action_executed", "author_clarification_required"],
    reject: ["no_action_executed", "blocked_by_policy"],
    fail_with_recovery: ["no_action_executed", "system_recovery_needed"]
  }
  @default_truthfulness_constraints ["no_action_executed"]

  @behavior_next_actions %{
    clarification: "answer_clarification",
    confirmation: "confirm_before_execute"
  }
  @default_behavior_next_action "continue_dialogue"

  # {action_id 前缀, action_type, idempotency_key 前缀}
  @behavior_action_templates %{
    clarification: [
      {"act_answer_", "answer_clarification", "clarify_"},
      {"act_cancel_", "cancel_pending_behavior", "cancel_"}
    ],
    confirmation: [
      {"act_confirm_", "confirm_before_execute", "confirm_"},
      {"act_reject_", "reject_or_cancel_confirmation", "reject_"}
    ]
  }

  @doc """
  裁决 MicroPlan。返回 {decision, behavior}。

  opts 可带 `confirmation_binding`（ADR-0009 确认 re-gate）：作者确认后重新裁决时
  传入有效 ConfirmationBinding，authority / write_boundary gate 视确认已满足；
  其余 gate 照常评估，确认不等于裁决一定放行（VS-03 §6）。
  """
  @spec decide(DialogueFrame.t(), MicroPlan.t(), keyword()) ::
          {OrchestratorDecision.t(), BehaviorState.t() | nil}
  def decide(frame, plan, opts \\ [])

  def decide(%DialogueFrame{} = frame, %MicroPlan{} = plan, opts) do
    binding = Keyword.get(opts, :confirmation_binding)
    decision_id = NovelFoundation.ID.unique("decision")
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
          GateOrder.evaluate(plan, binding)
          |> decision_from_gate_result(decision_id, frame, plan, binding)
          |> mark_confirmed_by(binding)
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

  # 确认 re-gate 的裁决在 reason_codes 留下绑定证明（VS-03 §5：gate result 与
  # binding 可经 trace 追溯），只标记携带了有效确认的裁决。
  defp mark_confirmed_by({decision, behavior}, %ConfirmationBinding{} = binding) do
    if ConfirmationBinding.confirm?(binding) do
      reason_codes =
        decision.reason_codes ++
          [
            "confirmed_by:#{binding.binding_id}",
            "rebased_state_snapshot:#{binding.rebased_state_snapshot_ref}"
          ] ++
          Enum.map(binding.gate_result_refs, &"gate_result_ref:#{&1}")

      {%{decision | reason_codes: reason_codes}, behavior}
    else
      {decision, behavior}
    end
  end

  defp mark_confirmed_by(result, _binding), do: result

  defp decision_from_gate_result({:pass, _results}, decision_id, frame, plan, binding) do
    cond do
      allow_tool_dispatch?(plan, binding) ->
        {build_allow_decision(decision_id, frame, plan), nil}

      allow_agent_run_start?(plan, binding) ->
        {build_allow_agent_run_decision(decision_id, frame, plan), nil}

      true ->
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

  defp decision_from_gate_result(
         {:block, gate_name, reason, _results},
         decision_id,
         frame,
         plan,
         _binding
       ) do
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
    behavior_id = NovelFoundation.ID.unique("bh")

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
      available_actions:
        behavior_actions(behavior_type, decision_id, behavior_id, target, frame.turn_id),
      prompt_contract: %{question: reason},
      constraints: %{risk: plan.risk_hint}
    }
  end

  defp behavior_next_action(behavior_type),
    do: Map.get(@behavior_next_actions, behavior_type, @default_behavior_next_action)

  # behavior_ref 必须指向 behavior 自身（ADR-0009 / VS-03），前端按
  # action.behavior_ref == behavior_state.active.behavior_id 门控确认动作显隐。
  # action_id / idempotency_key 仍以 decision_id 为键（一次决定一组动作）；
  # 未知 behavior_type 走空动作集（与 GateOrder 未知 gate 的保守降级同构）。
  # ADR-0007 #3：动作必须携带可追溯 ref——与 candidate 动作同一约定
  # （`decision_trace:<turn_id>`），前端/trace 据此把作者动作关联回本轮决策。
  defp behavior_actions(behavior_type, d_id, behavior_id, target, turn_id) do
    expires_at = author_action_expires_at()

    @behavior_action_templates
    |> Map.get(behavior_type, [])
    |> Enum.map(fn {action_id_prefix, action_type, idempotency_key_prefix} ->
      %{
        action_id: "#{action_id_prefix}#{d_id}",
        action_type: action_type,
        behavior_ref: behavior_id,
        target_ref: target,
        idempotency_key: "#{idempotency_key_prefix}#{d_id}",
        trace_ref: "decision_trace:#{turn_id}",
        expires_at: expires_at
      }
    end)
  end

  defp author_action_expires_at do
    DateTime.utc_now()
    |> DateTime.add(@author_action_ttl_seconds, :second)
    |> DateTime.to_iso8601()
  end

  # ── VS-02 tool dispatch ───────────────────────

  # 高风险 plan 在携带有效确认绑定（re-gate）时不再因风险被降级；
  # 单步、可分发等其余条件照常要求。
  defp allow_tool_dispatch?(%MicroPlan{} = plan, binding) do
    actions = plan.proposed_actions

    not MicroPlan.multi_step?(plan) and
      (not MicroPlan.high_risk?(plan) or confirmed?(binding)) and
      length(actions) == 1 and tool_dispatchable?(hd(actions))
  end

  defp allow_agent_run_start?(%MicroPlan{} = plan, binding) do
    actions = plan.proposed_actions

    not MicroPlan.multi_step?(plan) and
      (not MicroPlan.high_risk?(plan) or confirmed?(binding)) and
      length(actions) == 1 and agent_run_start?(hd(actions))
  end

  defp confirmed?(%ConfirmationBinding{} = binding), do: ConfirmationBinding.confirm?(binding)
  defp confirmed?(_binding), do: false

  defp tool_dispatchable?(action) do
    tool_name = tool_name_from_action(action)
    tool_name != nil and CapabilityRegistry.dispatchable?(tool_name)
  end

  defp tool_name_from_action(%{action_type: :capability_invocation} = action) do
    Map.get(action, :target_ref) || action[:capability_name]
  end

  defp tool_name_from_action(_), do: nil

  defp agent_run_start?(%{action_type: :agent_run_start}), do: true
  defp agent_run_start?(_action), do: false

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

  defp build_allow_agent_run_decision(decision_id, frame, plan) do
    action = hd(plan.proposed_actions)
    profile_ref = action[:target_ref] || action[:profile_ref]

    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :allow_agent_run,
      decision_status: :decided,
      approved_actions: action_refs(plan.proposed_actions),
      rejected_actions: [],
      downgraded_actions: [],
      required_author_action: nil,
      first_blocking_gate: nil,
      reason_codes: [
        "gates_passed",
        "agent_run_start",
        "profile:#{profile_ref}",
        "internal_steps_require_regate"
      ],
      turn_result_policy: %{
        truthfulness_constraints: ["agent_run_created", "internal_steps_require_regate"]
      }
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

  defp gate_to_decision_type(gate_name),
    do: Map.get(@gate_decision_types, gate_name, @default_gate_decision_type)

  defp truthfulness_constraints_for(decision_type),
    do: Map.get(@truthfulness_constraints, decision_type, @default_truthfulness_constraints)

  defp action_refs(actions) do
    Enum.map(actions, fn action ->
      %{
        action_id: action_ref_text(action[:action_id]),
        action_type: action_ref_action_type(action[:action_type]),
        summary: action_ref_text(action[:summary])
      }
    end)
  end

  # action_ref 的字段类型是 String.t()/atom()：proposed_action map 在恢复/降级路径上
  # 可能缺键（历史 TurnResult），这里做类型收敛，避免用 any() 拼接 struct 字段。
  defp action_ref_text(value) when is_binary(value), do: value
  defp action_ref_text(_value), do: ""

  defp action_ref_action_type(value) when is_atom(value), do: value
  defp action_ref_action_type(_value), do: :unknown

  defp author_action_for(type, reason) do
    %{action_type: type, summary: reason, source: :orchestrator_decision}
  end
end
