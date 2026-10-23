defmodule NovelApplication.GateOrder do
  @moduledoc """
  Execution Gate Order — 按 ADR-0005 的 0–11 顺序评估 MicroPlan。

  GATE-ORDER-CLOSURE（B13b §4.1 #2）：补齐 ADR-0005 冻结的 12 门，每门产出结构化
  `NovelDomain.GateResult`（identity / order / outcome / reason code / input refs），
  并由 `ExecutionOrchestrator` 记录 gate order version 与逐门 lineage。

  顺序冻结（重排会改变安全语义，见 ADR-0005 §最终决策）：

     0 correlation            关联与幂等 lineage
     1 envelope_validation    DialogueFrame / MicroPlan / PlannerOutput 边界
     2 behavior_compatibility 当前 open behavior 是否匹配本轮输入
     3 action_scope           是否越过下一步边界 / 长计划
     4 slot_contract_validation 关键 slot / target / schema 合法性
     5 authority              权限与高风险确认
     6 policy_safety          内容策略与禁止操作
     7 budget                 run 预算余量（真实 run budget）
     8 toolbox_availability   capability 是否已注册可用
     9 write_boundary         tentative / production / adoption 边界
    10 trace_readiness        本轮决策是否可被记录回放
    11 turn_result_compat     输出事实与决策兼容

  Gate 输入分两类：`MicroPlan` / `ConfirmationBinding` 是必选输入；其余运行期事实
  （frame、open behavior、run budget、trace 可用性、幂等 lineage）经 `context` map
  可选注入。缺席时对应 gate 走保守「未接线」语义（pass_with_note 或保持既有行为），
  不伪造通过事实；真实调用点必须显式接线（见各 agent run flow / confirmation re-gate）。

  确认 re-gate（ADR-0009 / VS-03 §5）：作者确认后必须重新跑全部 gate；携带有效
  ConfirmationBinding（answer_type=confirm）时，authority / write_boundary 两个
  以"需作者确认"为 block 理由的 gate 视为确认已满足而放行，其余 gate 照常评估
  （multi-step、forbidden semantics、policy、budget 等仍会拦，确认不等于 gate 一定通过）。
  """

  alias NovelApplication.CapabilityRegistry
  alias NovelDomain.BehaviorState
  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.DialogueFrame
  alias NovelDomain.GateResult
  alias NovelDomain.MicroPlan

  @gate_order_version "adr-0005-v1"

  @gates [
    {0, :correlation},
    {1, :envelope_validation},
    {2, :behavior_compatibility},
    {3, :action_scope},
    {4, :slot_contract_validation},
    {5, :authority},
    {6, :policy_safety},
    {7, :budget},
    {8, :toolbox_availability},
    {9, :write_boundary},
    {10, :trace_readiness},
    {11, :turn_result_compat}
  ]

  @action_types [
    :candidate_generation,
    :tentative_artifact,
    :state_change_request,
    :clarification_request,
    :confirmation_request,
    :capability_invocation,
    :agent_run_start
  ]

  @doc "Gate order version recorded on DecisionTrace / TurnResult trace summary."
  @spec gate_order_version() :: String.t()
  def gate_order_version, do: @gate_order_version

  @doc "Stable gate specs `%{order, gate}` in evaluation order."
  @spec gate_specs() :: [%{order: non_neg_integer(), gate: atom()}]
  def gate_specs do
    Enum.map(@gates, fn {order, gate} -> %{order: order, gate: gate} end)
  end

  @doc "Gate names in evaluation order."
  @spec gate_names() :: [atom()]
  def gate_names, do: Enum.map(@gates, fn {_order, gate} -> gate end)

  @doc """
  Run gates 0–11 in order.

  Returns:

  - `{:pass, results}` — all gates passed（含 pass_with_note）；
  - `{:block, gate_name, reason, results}` — first blocking gate, results include it；
  - `{:replay_existing, gate_name, decision_ref, results}` — 幂等 lineage 命中时短路。

  `context` 支持的可选键：

  - `:frame` — 当前 DialogueFrame（correlation / turn_result_compat 交叉校验）；
  - `:open_behavior` — 当前未闭合 BehaviorState（behavior_compatibility）；
  - `:behavior_resolution` — 本轮输入对 open behavior 的解析（`:author_confirmed` 等）；
  - `:budget` — `%{remaining: %{tool_calls:, provider_calls:}, exhausted?: bool}`（budget）；
  - `:trace_ready?` — trace 写入通道是否可用（trace_readiness）；
  - `:idempotency` — `%{key: String.t(), replay_decision_ref: String.t() | nil}`（correlation）。
  """
  @type gate_results :: [GateResult.t()]
  @type eval_result ::
          {:pass, gate_results()}
          | {:block, atom(), String.t(), gate_results()}
          | {:replay_existing, atom(), String.t(), gate_results()}
  @spec evaluate(MicroPlan.t(), ConfirmationBinding.t() | nil, map()) :: eval_result()
  def evaluate(%MicroPlan{} = plan, binding \\ nil, context \\ %{}) do
    context = normalize_context(context)

    @gates
    |> Enum.map(fn {order, gate} -> {order, gate} end)
    |> run_gates(plan, binding, context, [])
  end

  # ── gate runner ─────────────────────────────────

  defp run_gates([], _plan, _binding, _context, results),
    do: {:pass, Enum.reverse(results)}

  defp run_gates([{order, gate} | rest], plan, binding, context, results) do
    result = evaluate_gate(gate, order, plan, binding, context)

    cond do
      GateResult.replay?(result) ->
        {:replay_existing, gate, result.reason, Enum.reverse([result | results])}

      GateResult.blocking?(result) ->
        {:block, gate, result.reason, Enum.reverse([result | results])}

      true ->
        run_gates(rest, plan, binding, context, [result | results])
    end
  end

  # ── gate 0: correlation / idempotency ───────────

  defp evaluate_gate(:correlation, order, plan, binding, context) do
    input_refs = %{
      turn_id: plan.turn_id,
      frame_ref: plan.frame_ref,
      plan_id: plan.plan_id
    }

    missing =
      for {key, value} <- [
            frame_ref: plan.frame_ref,
            turn_id: plan.turn_id,
            plan_id: plan.plan_id
          ],
          blank?(value),
          do: key

    mismatch = correlation_mismatch(plan, Map.get(context, :frame), binding)

    cond do
      missing != [] ->
        GateResult.block(
          :correlation,
          order,
          :hard_block,
          "missing_required_refs",
          "missing required refs: #{Enum.join(missing, ", ")}",
          input_refs: input_refs
        )

      mismatch != nil ->
        GateResult.block(
          :correlation,
          order,
          :hard_block,
          "correlation_ref_mismatch",
          mismatch,
          input_refs: input_refs
        )

      true ->
        correlation_lineage(plan, binding, context, input_refs, order)
    end
  end

  # 幂等 lineage：真实 key 已由 Channel/ActionIdempotencyService 校验；gate 只负责
  # 把 lineage 记入 trace，并在显式 replay 证据存在时短路复用已有 decision。
  # ── gate 1: envelope validation ─────────────────

  defp evaluate_gate(:envelope_validation, order, plan, _binding, _context) do
    input_refs = %{
      plan_id: plan.plan_id,
      action_count: length(plan.proposed_actions),
      frame_type: nil
    }

    cond do
      plan.proposed_actions == [] ->
        GateResult.block(
          :envelope_validation,
          order,
          :hard_block,
          "missing_proposed_actions",
          "planner output has no proposed actions",
          input_refs: input_refs
        )

      plan.stop_after_next_action == false ->
        GateResult.block(
          :envelope_validation,
          order,
          :hard_block,
          "stop_after_next_action_required",
          "planner output must be bounded to the next action",
          input_refs: input_refs
        )

      true ->
        case MicroPlan.check_forbidden(plan) do
          :ok ->
            GateResult.pass(:envelope_validation, order, input_refs: input_refs)

          {:error, terms} ->
            GateResult.block(
              :envelope_validation,
              order,
              :hard_block,
              "forbidden_planner_semantics",
              "forbidden planner semantics: #{Enum.join(terms, ", ")}",
              input_refs: Map.put(input_refs, :forbidden_terms, terms)
            )
        end
    end
  end

  # ── gate 2: behavior compatibility ──────────────

  defp evaluate_gate(:behavior_compatibility, order, _plan, binding, context) do
    case Map.get(context, :open_behavior) do
      nil ->
        GateResult.pass(:behavior_compatibility, order)

      %BehaviorState{lifecycle_status: status} when status not in [:open, :awaiting_author] ->
        GateResult.pass(:behavior_compatibility, order)

      %{} = behavior ->
        behavior_compatibility_resolution(order, behavior, binding, context)

      _other ->
        GateResult.pass(:behavior_compatibility, order)
    end
  end

  # ── gate 3: action scope ────────────────────────

  defp evaluate_gate(:action_scope, order, plan, _binding, _context) do
    if MicroPlan.multi_step?(plan) do
      GateResult.block(
        :action_scope,
        order,
        :soft_block,
        "multi_step_plan_requires_downgrade",
        "multi-step plan requires downgrade: #{length(plan.proposed_actions)} actions proposed",
        input_refs: %{action_count: length(plan.proposed_actions)}
      )
    else
      GateResult.pass(:action_scope, order)
    end
  end

  # ── gate 4: slot / contract validation ──────────

  defp evaluate_gate(:slot_contract_validation, order, plan, _binding, _context) do
    invalid_actions =
      plan.proposed_actions
      |> Enum.with_index()
      |> Enum.flat_map(fn {action, index} -> action_contract_errors(action, index) end)

    invalid_state_changes =
      plan.state_changes_requested
      |> Enum.with_index()
      |> Enum.flat_map(fn {change, index} -> state_change_contract_errors(change, index) end)

    errors = invalid_actions ++ invalid_state_changes

    if errors == [] do
      GateResult.pass(:slot_contract_validation, order,
        input_refs: %{action_count: length(plan.proposed_actions)}
      )
    else
      GateResult.block(
        :slot_contract_validation,
        order,
        :soft_block,
        "proposed_action_contract_invalid",
        "proposed action contract invalid: #{Enum.join(errors, "; ")}",
        input_refs: %{errors: errors}
      )
    end
  end

  # ── gate 5: authority ───────────────────────────

  defp evaluate_gate(:authority, order, plan, binding, _context) do
    cond do
      not MicroPlan.high_risk?(plan) ->
        GateResult.pass(:authority, order)

      confirmed?(binding) ->
        GateResult.pass_with_note(:authority, order, "high_risk_resolved_by_confirmation_binding")

      true ->
        action_summaries = Enum.map_join(plan.proposed_actions, "；", & &1.summary)

        GateResult.block(
          :authority,
          order,
          :soft_block,
          "high_risk_requires_author_confirmation",
          "检测到高风险行动，需作者确认：#{action_summaries}",
          input_refs: %{risk_hint: plan.risk_hint},
          author_visible: true
        )
    end
  end

  # ── gate 6: policy / safety ─────────────────────

  defp evaluate_gate(:policy_safety, order, plan, _binding, _context) do
    production_state_changes =
      Enum.filter(plan.state_changes_requested, fn change ->
        is_map(change) and change[:write_intent] == :production_candidate
      end)

    if production_state_changes == [] do
      GateResult.pass(:policy_safety, order,
        input_refs: %{state_change_count: length(plan.state_changes_requested)}
      )
    else
      GateResult.block(
        :policy_safety,
        order,
        :soft_block,
        "state_change_requires_adoption_boundary",
        "state changes requested by the planner are candidate-only; production writes must pass the adoption boundary",
        input_refs: %{production_state_change_count: length(production_state_changes)}
      )
    end
  end

  # ── gate 7: budget ──────────────────────────────

  defp evaluate_gate(:budget, order, plan, _binding, context) do
    case Map.get(context, :budget) do
      nil ->
        GateResult.pass_with_note(:budget, order, "run_budget_not_attached")

      %{} = budget ->
        budget_gate_result(order, plan, budget)
    end
  end

  # ── gate 8: toolbox availability ────────────────

  defp evaluate_gate(:toolbox_availability, order, plan, _binding, context) do
    resolver = Map.get(context, :capability_resolver) || (&CapabilityRegistry.dispatchable?/1)

    capability_names =
      plan.proposed_actions
      |> Enum.filter(fn action ->
        is_map(action) and action[:action_type] == :capability_invocation
      end)
      |> Enum.map(fn action -> action[:target_ref] end)
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    unknown = Enum.reject(capability_names, fn name -> resolver.(name) end)

    if unknown == [] do
      GateResult.pass(:toolbox_availability, order, input_refs: %{capabilities: capability_names})
    else
      GateResult.block(
        :toolbox_availability,
        order,
        :recoverable_failure,
        "capability_not_registered",
        "capability not registered: #{Enum.join(unknown, ", ")}",
        input_refs: %{capabilities: unknown}
      )
    end
  end

  # ── gate 9: write / adoption boundary ───────────

  defp evaluate_gate(:write_boundary, order, plan, binding, _context) do
    cond do
      MicroPlan.production_candidate_count(plan) == 0 ->
        GateResult.pass(:write_boundary, order)

      confirmed?(binding) ->
        GateResult.pass_with_note(
          :write_boundary,
          order,
          "write_boundary_resolved_by_confirmation"
        )

      true ->
        GateResult.block(
          :write_boundary,
          order,
          :soft_block,
          "production_candidate_requires_adoption_boundary",
          "production candidate write not allowed without adoption boundary check",
          input_refs: %{production_candidate_count: MicroPlan.production_candidate_count(plan)}
        )
    end
  end

  # ── gate 10: trace readiness ────────────────────

  defp evaluate_gate(:trace_readiness, order, _plan, _binding, context) do
    case Map.fetch(context, :trace_ready?) do
      {:ok, false} ->
        GateResult.block(
          :trace_readiness,
          order,
          :recoverable_failure,
          "trace_not_writable",
          "decision trace cannot be persisted for this turn",
          input_refs: %{}
        )

      {:ok, true} ->
        GateResult.pass(:trace_readiness, order)

      :error ->
        GateResult.pass_with_note(:trace_readiness, order, "trace_readiness_not_attached")
    end
  end

  # ── gate 11: TurnResult compatibility ───────────

  defp evaluate_gate(:turn_result_compat, order, _plan, _binding, context) do
    case Map.get(context, :frame) do
      %DialogueFrame{} = frame ->
        turn_result_compat_result(order, frame)

      _other ->
        GateResult.pass_with_note(:turn_result_compat, order, "frame_not_attached")
    end
  end

  defp correlation_lineage(_plan, binding, context, input_refs, order) do
    idempotency = Map.get(context, :idempotency) || %{}
    replay_ref = map_get(idempotency, :replay_decision_ref)

    key =
      map_get(idempotency, :key) ||
        if match?(%ConfirmationBinding{}, binding), do: binding.idempotency_key

    cond do
      is_binary(replay_ref) and replay_ref != "" ->
        GateResult.replay_existing(:correlation, order, replay_ref,
          input_refs: Map.put(input_refs, :replay_decision_ref, replay_ref)
        )

      is_binary(key) and key != "" ->
        GateResult.pass_with_note(:correlation, order, "idempotency_lineage:#{key}",
          input_refs: Map.put(input_refs, :idempotency_key, key)
        )

      true ->
        GateResult.pass_with_note(:correlation, order, "idempotency_lineage_not_attached",
          input_refs: input_refs
        )
    end
  end

  defp correlation_mismatch(_plan, nil, _binding), do: nil

  defp correlation_mismatch(plan, %DialogueFrame{} = frame, _binding) do
    cond do
      plan.frame_ref != frame.frame_id ->
        "plan.frame_ref does not match current frame"

      plan.turn_id != frame.turn_id ->
        "plan.turn_id does not match current frame turn"

      true ->
        nil
    end
  end

  defp correlation_mismatch(_plan, _frame, _binding), do: nil

  defp behavior_compatibility_resolution(order, behavior, binding, context) do
    behavior_ref = map_get(behavior, :behavior_id) || map_get(behavior, :behavior_ref)
    resolution = Map.get(context, :behavior_resolution)

    cond do
      resolution != nil ->
        GateResult.pass_with_note(
          :behavior_compatibility,
          order,
          "behavior_resolved:#{resolution}",
          input_refs: %{behavior_ref: behavior_ref}
        )

      match?(%ConfirmationBinding{}, binding) and
        is_binary(behavior_ref) and binding.behavior_ref == behavior_ref ->
        GateResult.pass_with_note(
          :behavior_compatibility,
          order,
          "behavior_resolved_by_confirmation_binding",
          input_refs: %{behavior_ref: behavior_ref}
        )

      true ->
        GateResult.block(
          :behavior_compatibility,
          order,
          :soft_block,
          "open_behavior_requires_resolution",
          "an open author-blocking behavior must be resolved before a new action scope",
          input_refs: %{behavior_ref: behavior_ref}
        )
    end
  end

  defp action_contract_errors(action, index) when is_map(action) do
    errors = []

    errors =
      if blank?(action[:action_id]),
        do: ["action[#{index}].action_id missing" | errors],
        else: errors

    errors =
      if action[:action_type] in @action_types,
        do: errors,
        else: ["action[#{index}].action_type invalid: #{inspect(action[:action_type])}" | errors]

    errors =
      if is_binary(action[:summary]) and action[:summary] != "",
        do: errors,
        else: ["action[#{index}].summary missing" | errors]

    errors =
      if action[:write_intent] in [:none, :tentative, :production_candidate],
        do: errors,
        else: [
          "action[#{index}].write_intent invalid: #{inspect(action[:write_intent])}" | errors
        ]

    errors
  end

  defp action_contract_errors(_action, index), do: ["action[#{index}] is not a map"]

  defp state_change_contract_errors(change, index) when is_map(change) do
    errors = []

    errors =
      if blank?(change[:target]),
        do: ["state_change[#{index}].target missing" | errors],
        else: errors

    errors =
      if blank?(change[:change]),
        do: ["state_change[#{index}].change missing" | errors],
        else: errors

    if change[:write_intent] in [:none, :tentative, :production_candidate],
      do: errors,
      else: [
        "state_change[#{index}].write_intent invalid: #{inspect(change[:write_intent])}" | errors
      ]
  end

  defp state_change_contract_errors(_change, index), do: ["state_change[#{index}] is not a map"]

  defp needs_tool?(plan) do
    Enum.any?(plan.proposed_actions, fn action ->
      is_map(action) and action[:action_type] in [:capability_invocation, :agent_run_start]
    end)
  end

  defp turn_result_compat_result(order, frame) do
    if turn_result_shape_valid?(frame) do
      GateResult.pass_with_note(
        :turn_result_compat,
        order,
        "truthfulness_enforced_by_turn_result_builder",
        input_refs: %{frame_ref: frame.frame_id}
      )
    else
      GateResult.block(
        :turn_result_compat,
        order,
        :hard_block,
        "turn_result_shape_incompatible",
        "dialogue frame cannot back a truthful TurnResult",
        input_refs: %{frame_ref: frame.frame_id, turn_id: frame.turn_id}
      )
    end
  end

  defp turn_result_shape_valid?(%DialogueFrame{} = frame) do
    is_binary(frame.frame_id) and frame.frame_id != "" and
      is_binary(frame.turn_id) and frame.turn_id != "" and
      is_map(frame.author_visible_draft) and
      is_binary(map_get(frame.author_visible_draft, :message)) and
      map_get(frame.author_visible_draft, :message) != ""
  end

  defp budget_gate_result(order, plan, budget) do
    remaining = map_get(budget, :remaining) || %{}
    tool_calls = map_get(remaining, :tool_calls)
    provider_calls = map_get(remaining, :provider_calls)

    cond do
      map_get(budget, :exhausted?) == true ->
        budget_block(order, "run_budget_exhausted", "agent run budget is exhausted", remaining)

      needs_tool?(plan) and is_integer(tool_calls) and tool_calls <= 0 ->
        budget_block(
          order,
          "run_budget_tool_calls_exhausted",
          "agent run tool budget is exhausted",
          remaining
        )

      is_integer(provider_calls) and provider_calls <= 0 ->
        budget_block(
          order,
          "run_budget_provider_calls_exhausted",
          "agent run provider budget is exhausted",
          remaining
        )

      true ->
        GateResult.pass_with_note(:budget, order, "run_budget_remaining",
          input_refs: %{remaining: remaining}
        )
    end
  end

  defp budget_block(order, reason_code, reason, remaining) do
    GateResult.block(:budget, order, :recoverable_failure, reason_code, reason,
      input_refs: %{remaining: remaining}
    )
  end

  # ── helpers ─────────────────────────────────────

  defp confirmed?(%ConfirmationBinding{} = binding), do: ConfirmationBinding.confirm?(binding)
  defp confirmed?(_binding), do: false

  defp normalize_context(context) when is_map(context), do: context
  defp normalize_context(_context), do: %{}

  defp map_get(map, key) when is_map(map) do
    case map do
      %{^key => value} -> value
      _ -> Map.get(map, Atom.to_string(key))
    end
  end

  defp map_get(_map, _key), do: nil

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false
end
