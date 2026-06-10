defmodule NovelApplication.GateOrder do
  @moduledoc """
  Execution Gate Order — 按 ADR-0005 顺序评估 MicroPlan。

  VS-01 只证明 gate 子集。gates 2/4/6/8 为后续 slice 留着位置。

  确认 re-gate（ADR-0009 / VS-03 §5）：作者确认后必须重新跑全部 gate；携带有效
  ConfirmationBinding（answer_type=confirm）时，authority / write_boundary 两个
  以"需作者确认"为 block 理由的 gate 视为确认已满足而放行，其余 gate 照常评估
  （所以 multi-step、forbidden semantics 等仍会拦，确认不等于 gate 一定通过）。
  """

  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.MicroPlan

  @type gate_result :: :pass | {:block, atom(), String.t()}

  @doc """
  Run gates 0-11 in order. Returns {:pass, results} or {:block, gate_name, reason, results}.
  """
  @type gate_results :: [{atom(), :pass}] | [{atom(), :pass | {:block, String.t()}}]
  @type eval_result :: {:pass, gate_results()} | {:block, atom(), String.t(), gate_results()}
  @spec evaluate(MicroPlan.t(), ConfirmationBinding.t() | nil) :: eval_result()
  def evaluate(%MicroPlan{} = plan, binding \\ nil) do
    gates = [
      {:correlation, &gate_correlation/1},
      {:envelope_validation, &gate_envelope/1},
      {:action_scope, &gate_action_scope/1},
      {:authority, &gate_authority(&1, binding)},
      {:budget, &gate_budget/1},
      {:write_boundary, &gate_write_boundary(&1, binding)},
      {:trace_readiness, &gate_trace_readiness/1},
      {:turn_result_compat, &gate_turn_result_compat/1}
    ]

    run_gates(gates, plan, [])
  end

  defp run_gates([], _plan, results), do: {:pass, Enum.reverse(results)}

  defp run_gates([{name, gate} | rest], plan, results) do
    case gate.(plan) do
      :pass ->
        run_gates(rest, plan, [{name, :pass} | results])

      {:block, reason} ->
        {:block, name, reason, Enum.reverse([{name, {:block, reason}} | results])}
    end
  end

  # Gate 0: Correlation / idempotency
  defp gate_correlation(plan) do
    if plan.frame_ref && plan.turn_id && plan.plan_id do
      :pass
    else
      {:block, "missing required refs: frame_ref, turn_id, or plan_id"}
    end
  end

  # Gate 1: Envelope validation — check forbidden planner semantics
  defp gate_envelope(plan) do
    case MicroPlan.check_forbidden(plan) do
      :ok -> :pass
      {:error, terms} -> {:block, "forbidden planner semantics: #{Enum.join(terms, ", ")}"}
    end
  end

  # Gate 3: Action scope — multi-step plans downgraded
  defp gate_action_scope(plan) do
    if MicroPlan.multi_step?(plan) do
      {:block,
       "multi-step plan requires downgrade: #{length(plan.proposed_actions)} actions proposed"}
    else
      :pass
    end
  end

  # Gate 5: Authority — high-risk requires confirmation；有效确认绑定满足该要求。
  defp gate_authority(plan, binding) do
    cond do
      not MicroPlan.high_risk?(plan) ->
        :pass

      confirmed?(binding) ->
        :pass

      true ->
        action_summaries = Enum.map_join(plan.proposed_actions, "；", & &1.summary)
        {:block, "检测到高风险行动，需作者确认：#{action_summaries}"}
    end
  end

  # Gate 7: Budget — high-cost hint blocks
  defp gate_budget(_plan) do
    # VS-01: no real budget check — pass through
    :pass
  end

  # Gate 9: Write / adoption boundary — production_candidate blocked。
  # 确认后放行的只是工具 dispatch；产出仍是 tentative artifact，真正的生产写入
  # 边界由采纳层把守（VS-04 adoption boundary / 覆盖确认）。
  defp gate_write_boundary(plan, binding) do
    cond do
      MicroPlan.production_candidate_count(plan) == 0 ->
        :pass

      confirmed?(binding) ->
        :pass

      true ->
        {:block, "production candidate write not allowed without adoption boundary check"}
    end
  end

  defp confirmed?(%ConfirmationBinding{} = binding), do: ConfirmationBinding.confirm?(binding)
  defp confirmed?(_binding), do: false

  # Gate 10: Trace readiness
  defp gate_trace_readiness(_plan) do
    # VS-01: trace is always in-memory, always ready
    :pass
  end

  # Gate 11: TurnResult compatibility
  defp gate_turn_result_compat(_plan) do
    # VS-01: always compatible since we control the builder
    :pass
  end
end
