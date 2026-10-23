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

  # gate → decision_type 翻译表（ADR-0005 §Gate 与 decision 的映射）。
  # GATE-ORDER-CLOSURE 补齐 12 门后按 ADR 映射表收口；未知 gate 仍走保守
  # require_confirmation（ADR-0005 gate 顺序是开放集合）。
  @gate_decision_types %{
    correlation: :fail_with_recovery,
    envelope_validation: :fail_with_recovery,
    behavior_compatibility: :require_clarification,
    action_scope: :downgrade_to_dialogue,
    slot_contract_validation: :require_clarification,
    authority: :require_confirmation,
    policy_safety: :downgrade_to_dialogue,
    budget: :fail_with_recovery,
    toolbox_availability: :fail_with_recovery,
    write_boundary: :require_confirmation,
    trace_readiness: :fail_with_recovery,
    turn_result_compat: :fail_with_recovery
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

  opts 可带：

  - `:confirmation_binding`（ADR-0009 确认 re-gate）：作者确认后重新裁决时传入有效
    ConfirmationBinding，authority / write_boundary gate 视确认已满足；其余 gate 照常
    评估，确认不等于裁决一定放行（VS-03 §6）。
  - `:gate_context`（ADR-0005 GATE-ORDER-CLOSURE）：可选运行期事实——`:frame`、
    `:open_behavior`、`:behavior_resolution`、`:budget`、`:trace_ready?`、`:idempotency`。
    真实调用点按需接线；缺席的 gate 走「未接线」保守语义，不伪造已检查事实。
  """
  @spec decide(DialogueFrame.t(), MicroPlan.t(), keyword()) ::
          {OrchestratorDecision.t(), BehaviorState.t() | nil}
  def decide(frame, plan, opts \\ [])

  def decide(%DialogueFrame{} = frame, %MicroPlan{} = plan, opts) do
    binding = Keyword.get(opts, :confirmation_binding)
    gate_context = build_gate_context(frame, opts)
    decision_id = NovelFoundation.ID.unique("decision")
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:orchestrator, :decide, :start, %{})

    {decision, behavior} =
      case PlannerBoundary.validate(frame, plan) do
        {:error, reason} ->
          {build_planner_boundary_decision(decision_id, frame, plan, reason), nil}

        :ok ->
          GateOrder.evaluate(plan, binding, gate_context)
          |> decision_from_gate_result(decision_id, frame, plan, binding)
          |> mark_confirmed_by(binding)
      end

    LogContext.put_decision(decision_id)

    duration = System.monotonic_time(:millisecond) - t0

    LogEmit.emit(:orchestrator, :decide, :done, %{
      decision_type: decision.decision_type,
      decision_id: decision_id,
      has_behavior: behavior != nil,
      first_blocking_gate: decision.first_blocking_gate,
      gate_order_version: decision.gate_order_version,
      gate_count: length(decision.gate_results),
      # LogEmit 经 Jason 编码落 JSONL：tuple 无 Encoder 会让整行静默丢弃，这里用
      # JSON-safe map lineage（也是 verifier 断言的稳定形态）。
      gate_outcomes: NovelDomain.GateResult.lineage(decision.gate_results),
      duration_ms: duration
    })

    {decision, behavior}
  end

  # 运行期 gate 事实：frame 恒注入；其余由真实调用点显式提供（见各 flow）。
  defp build_gate_context(frame, opts) do
    opts
    |> Keyword.get(:gate_context, %{})
    |> Map.new()
    |> Map.put(:frame, frame)
  end

  @doc """
  从 AgentRun 运行态派生 gate_context（ADR-0005 gate 7 budget 的真实接线）。

  agent run 的每个 tool step 在 `ExecutionOrchestrator.decide/3` 前调用本函数，
  把 run 的真实剩余预算注入 gate；`AgentRun.budget_exhausted?/1` 为真时 budget
  gate 会以 `recoverable_failure` 阻断，避免绕过 run 级预算重复执行。
  """
  @spec gate_context_for_run(map()) :: map()
  def gate_context_for_run(run) when is_map(run) do
    budget = Map.get(run, :budget) || %{}
    consumed = Map.get(run, :consumed_budget) || %{}

    context = %{
      budget: %{
        remaining: %{
          steps: remaining_budget(budget, consumed, :max_steps, :execution_steps),
          tool_calls: remaining_budget(budget, consumed, :max_tool_calls, :tool_calls),
          provider_calls: remaining_budget(budget, consumed, :max_provider_calls, :provider_calls)
        },
        exhausted?: agent_run_budget_exhausted?(run)
      }
    }

    # gate 10 trace readiness 的真实接线：持久化 tracer 存在 = 本轮 trace 可落库回放；
    # 内存 trace 路径（测试/无持久化注入）缺席时不伪造可写事实，gate 走未接线语义。
    if NovelApplication.persistence_tracer() do
      Map.put(context, :trace_ready?, true)
    else
      context
    end
  end

  defp remaining_budget(budget, consumed, max_key, consumed_key) do
    max = budget_value(budget, max_key)
    used = budget_value(consumed, consumed_key)

    if is_integer(max) and is_integer(used), do: max(max - used, 0), else: nil
  end

  defp budget_value(map, key) when is_map(map) do
    case Map.get(map, key) do
      value when is_integer(value) -> value
      _ -> Map.get(map, Atom.to_string(key))
    end
  end

  defp budget_value(_map, _key), do: nil

  defp agent_run_budget_exhausted?(%NovelDomain.AgentRun{} = run),
    do: NovelDomain.AgentRun.budget_exhausted?(run)

  defp agent_run_budget_exhausted?(run) when is_map(run) do
    budget_value(run, :budget) != nil and consumed_exhausted?(run)
  end

  defp consumed_exhausted?(run) do
    budget = Map.get(run, :budget) || %{}
    consumed = Map.get(run, :consumed_budget) || %{}

    remaining_budget(budget, consumed, :max_steps, :execution_steps) == 0 or
      remaining_budget(budget, consumed, :max_tool_calls, :tool_calls) == 0 or
      remaining_budget(budget, consumed, :max_provider_calls, :provider_calls) == 0
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

  defp decision_from_gate_result({:pass, results}, decision_id, frame, plan, binding) do
    cond do
      allow_tool_dispatch?(plan, binding) ->
        {build_allow_decision(decision_id, frame, plan, results), nil}

      allow_agent_run_start?(plan, binding) ->
        {build_allow_agent_run_decision(decision_id, frame, plan, results), nil}

      true ->
        # 12 门全 pass 但没有可分发动作：这是 decision 级降级（不是 gate 阻断），
        # first_blocking_gate 必须为 nil，否则 gate 序列与 first blocking gate 自相矛盾。
        {build_gate_passed_downgrade(decision_id, frame, plan, results), nil}
    end
  end

  defp decision_from_gate_result(
         {:block, gate_name, reason, results},
         decision_id,
         frame,
         plan,
         _binding
       ) do
    decision_type = gate_to_decision_type(gate_name)
    decision = build_decision(decision_type, decision_id, frame, plan, reason, gate_name, results)

    behavior =
      if decision_type == :require_confirmation do
        open_behavior(decision_type, decision_id, frame, plan, reason)
      end

    {decision, behavior}
  end

  # 幂等 lineage 命中：不再执行新动作，decision 保留复用的 decision ref。
  # 真实 replay 复用由 Channel 的 ActionIdempotencyService receipt 承担；gate 层
  # 只在显式注入 replay 证据时短路（ADR-0005 gate 0 replay_existing）。
  defp decision_from_gate_result(
         {:replay_existing, _gate_name, decision_ref, results},
         decision_id,
         frame,
         plan,
         _binding
       ) do
    {build_replay_decision(decision_id, frame, plan, decision_ref, results), nil}
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

  defp build_gate_passed_downgrade(decision_id, frame, plan, results) do
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
      required_author_action: nil,
      first_blocking_gate: nil,
      reason_codes: [
        "gates_passed",
        "no_dispatchable_action",
        "downgraded_to_dialogue"
      ],
      turn_result_policy: %{
        truthfulness_constraints: truthfulness_constraints_for(:downgrade_to_dialogue)
      },
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: results
    }
  end

  defp build_allow_decision(decision_id, frame, plan, results) do
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
      turn_result_policy: %{truthfulness_constraints: ["tool_dispatched", "result_not_adoption"]},
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: results
    }
  end

  defp build_allow_agent_run_decision(decision_id, frame, plan, results) do
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
      },
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: results
    }
  end

  defp build_decision(decision_type, decision_id, frame, plan, reason, gate_name, results) do
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
      turn_result_policy: %{truthfulness_constraints: truthfulness_constraints_for(decision_type)},
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: results
    }
  end

  # PlannerBoundary 在 gate 之前失败：仍写入 envelope_validation 的结构化 GateResult，
  # 保证「validation failure 必须进入 DecisionTrace」（VS-01 §3）不因前置短路丢失。
  defp build_planner_boundary_decision(decision_id, frame, plan, reason) do
    result =
      NovelDomain.GateResult.block(
        :envelope_validation,
        1,
        :hard_block,
        "planner_boundary_violation",
        reason,
        input_refs: %{plan_id: plan.plan_id, frame_ref: plan.frame_ref}
      )

    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :fail_with_recovery,
      decision_status: :decided,
      approved_actions: [],
      rejected_actions: action_refs(plan.proposed_actions),
      downgraded_actions: action_refs(plan.proposed_actions),
      required_author_action: author_action_for(:fail_with_recovery, reason),
      first_blocking_gate: "planner_boundary",
      reason_codes: ["fail_with_recovery", reason],
      turn_result_policy: %{
        truthfulness_constraints: truthfulness_constraints_for(:fail_with_recovery)
      },
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: [result]
    }
  end

  # 幂等 lineage 命中：不再执行新动作，记录复用的已有 decision ref。
  defp build_replay_decision(decision_id, frame, plan, existing_decision_ref, results) do
    %OrchestratorDecision{
      decision_id: decision_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :replay_existing,
      decision_status: :decided,
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: action_refs(plan.proposed_actions),
      required_author_action: nil,
      first_blocking_gate: nil,
      reason_codes: ["replay_existing", "replay_decision_ref:#{existing_decision_ref}"],
      turn_result_policy: %{
        truthfulness_constraints: ["no_action_executed", "reuse_recorded_decision"]
      },
      gate_order_version: GateOrder.gate_order_version(),
      gate_results: results
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
