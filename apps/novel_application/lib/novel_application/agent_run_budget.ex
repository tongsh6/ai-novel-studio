defmodule NovelApplication.AgentRunBudget do
  @moduledoc """
  唯一 run 入场资源政策与显式作者扩额。

  入场 grant 不由模型计划、局部交换次数或路由切换重新授予。
  既有实际入口数值见 UA-01 §6.1 / B91 §10.3。
  """

  alias NovelCommon.Contracts.ProviderRun
  alias NovelDomain.AgentRun
  alias NovelPersistence.ProviderRunLog

  @doc "当前 task 的真实 Provider 准入由所属 AgentRunServer 同步裁决。"
  def admission_callback(server, %AgentRun{} = expected) do
    fn initialized, context, source_check ->
      GenServer.call(
        server,
        {:admit_provider, expected, initialized, context, source_check},
        :infinity
      )
    end
  end

  @doc "只在 Server 的当前命令序中消费有效 grant；不能依赖调用方旧预算。"
  def admit_provider(
        state,
        caller,
        %AgentRun{} = expected,
        %ProviderRun{} = initialized,
        context,
        source_check
      ) do
    run = state.run

    cond do
      caller != state.current_task_pid or is_nil(state.current_task_ref) ->
        {:error, :provider_task_not_current}

      not same_run_goal?(run, expected, context) ->
        {:error, :provider_scope_stale}

      run.interrupt_state.status in [:pause_requested, :cancel_requested] ->
        {:error, :provider_run_interrupted}

      true ->
        admit_current_task(
          state.current_task_kind,
          run,
          expected,
          initialized,
          context,
          source_check
        )
    end
  end

  defp admit_current_task(:step, run, expected, initialized, context, nil) do
    if run.status == :running and run.phase == :executing and
         expected.current_step_ref == run.current_step_ref and
         context[:step_id] == run.current_step_ref do
      ProviderRunLog.admit_execution(initialized, context, run.budget.max_provider_calls)
    else
      {:error, :provider_task_not_current}
    end
  end

  defp admit_current_task(
         %{type: :transcript_maintenance} = task,
         run,
         _expected,
         initialized,
         context,
         source_check
       )
       when is_function(source_check, 0) do
    if is_nil(context[:step_id]) and task.goal_version == run.goal.version and
         task.status == run.status do
      ProviderRunLog.admit_operation(
        initialized,
        context,
        run.budget.max_provider_calls,
        source_check
      )
    else
      {:error, :provider_task_not_current}
    end
  end

  defp admit_current_task(_kind, _run, _expected, _initialized, _context, _source_check),
    do: {:error, :provider_task_not_current}

  defp same_run_goal?(run, expected, context) do
    expected.goal.version == run.goal.version and
      expected.run_id == run.run_id and context[:agent_run_id] == run.run_id and
      Enum.all?([:workspace_id, :work_id, :session_id, :parent_turn_ref], fn key ->
        Map.get(expected, key) == Map.get(run, key) and Map.get(context, key) == Map.get(run, key)
      end)
  end

  # CP1b 迁移期旧结果投影只用于尚未收敛的结算消费者；不是派发授权。
  def observed_provider_calls(events) do
    events
    |> Enum.filter(fn event ->
      event.event_type == :provider_progress and
        NovelApplication.AgentRunMaintenance.counts_provider_call?(event.payload)
    end)
    |> Enum.map(
      &(Map.get(&1.payload, :provider_call_ref) || Map.get(&1.payload, "provider_call_ref"))
    )
    |> Enum.reject(&is_nil/1)
    |> MapSet.new()
    |> MapSet.size()
  end

  @default_hard_caps %{
    max_steps: 50,
    max_tool_calls: 50,
    max_provider_calls: 100,
    max_replans: 1
  }

  # CP0 已核定的实际入场额度；不是任务必须消费的调用次数。
  # tuple: {execution units, tools, providers, replans, pending artifacts}
  @entry_grants %{
    profile_routing: {28, 6, 33, 1, 3},
    character_design_with_context: {5, 5, 8, 1, 1},
    prose_drafting_with_quality: {6, 3, 11, 1, 1},
    judgment_plan: {7, 6, 17, 1, 3},
    plot_outline_with_context: {5, 3, 10, 1, 1},
    character_evolution_with_context: {5, 3, 10, 1, 1},
    world_building_with_context: {5, 3, 10, 1, 1},
    prose_revision_from_findings: {6, 3, 8, 1, 3},
    tool_confirmation: {4, 1, 15, 0, 3},
    tool_confirmation_action: {4, 1, 14, 0, 3},
    readonly_batch_context: {4, 6, 7, 1, 3},
    ledger_reconciliation: {4, 4, 6, 1, 1},
    fact_inventory: {4, 2, 7, 1, 60}
  }

  @doc "根任务已准入额度；作者显式执行单位限制可以收紧，不由自然语言猜测。"
  @spec entry(atom(), map() | nil) :: map()
  def entry(profile, author_limits \\ nil) do
    {steps, tools, providers, replans, pending} = Map.fetch!(@entry_grants, profile)

    grant = %{
      max_steps: steps,
      max_tool_calls: tools,
      max_provider_calls: providers,
      max_replans: replans,
      max_pending_artifacts: pending
    }

    case map_get(author_limits, :max_steps) do
      value when is_integer(value) and value > 0 ->
        grant
        |> Map.put(:author_max_steps, value)
        |> Map.put(:max_steps, min(steps, value))

      _ ->
        grant
    end
  end

  @doc "角色选择只收紧当前业务限制，不覆盖根资源或已生效的作者扩额。"
  @spec restrict_for_profile(map(), atom()) :: map()
  def restrict_for_profile(grant, profile) when is_map(grant) do
    limits = entry(profile)

    Enum.reduce([:max_pending_artifacts, :max_replans], grant, fn key, current ->
      limit = Map.fetch!(limits, key)
      Map.update(current, key, limit, &min(&1, limit))
    end)
  end

  @doc """
  Expand a run budget after an explicit author recovery action.

  `:next_step` authorizes one more execution step (one tool call, at most two
  provider calls); `:remaining_plan` authorizes enough worst-case cost for all
  plan steps. Both are absolute-hard-cap checked and leave `max_replans`
  unchanged. The returned budget carries an override marker so a later plan
  patch does not re-apply an older author step cap.
  """
  @spec authorized_expand(
          map(),
          map(),
          [map()],
          :next_step
          | :remaining_plan
          | {:steps, pos_integer()}
          | {:single_step, pos_integer()}
        ) ::
          {:ok, map()} | {:error, :hard_cap_reached | :invalid_recovery_mode}
  def authorized_expand(existing, consumed, plan_steps, mode)
      when is_map(existing) and is_map(consumed) and is_list(plan_steps) do
    with {:ok, {step_delta, tool_delta, provider_delta}} <- recovery_delta(plan_steps, mode) do
      steps = execution_steps_value(consumed)
      tools = consumed_value(consumed, :tool_calls)
      providers = consumed_value(consumed, :provider_calls)

      target = %{
        max_steps: max(map_get(existing, :max_steps) || 0, steps + step_delta),
        max_tool_calls: max(map_get(existing, :max_tool_calls) || 0, tools + tool_delta),
        max_provider_calls:
          max(map_get(existing, :max_provider_calls) || 0, providers + provider_delta),
        max_replans: map_get(existing, :max_replans) || @default_hard_caps.max_replans,
        author_budget_override: true,
        author_budget_override_mode: recovery_mode_label(mode)
      }

      if within_hard_caps?(target) do
        {:ok, Map.merge(existing, target)}
      else
        {:error, :hard_cap_reached}
      end
    end
  end

  defp recovery_delta([], _mode), do: {:error, :invalid_recovery_mode}
  # step delta 额外 +1：执行完选中步骤后还要一次收束/完成判断。
  defp recovery_delta(_plan_steps, :next_step), do: {:ok, {2, 2, 3}}

  defp recovery_delta(_plan_steps, {:steps, count})
       when is_integer(count) and count > 0 do
    {:ok, {count + 1, count + 1, count * 2 + 1}}
  end

  defp recovery_delta(_plan_steps, {:single_step, count})
       when is_integer(count) and count > 0 do
    {:ok, {2, 1, 2}}
  end

  defp recovery_delta(plan_steps, :remaining_plan) do
    count = length(plan_steps)
    {:ok, {count + 1, count + 1, count * 2 + 1}}
  end

  defp recovery_delta(_plan_steps, _mode), do: {:error, :invalid_recovery_mode}

  defp consumed_value(map, key) do
    case map_get(map, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> 0
    end
  end

  defp execution_steps_value(map) do
    case map_get(map, :execution_steps) do
      value when is_integer(value) and value >= 0 -> value
      _ -> consumed_value(map, :steps)
    end
  end

  defp recovery_mode_label({:steps, count}), do: "steps:#{count}"
  defp recovery_mode_label({:single_step, count}), do: "single_step:#{count}"
  defp recovery_mode_label(mode), do: Atom.to_string(mode)

  defp within_hard_caps?(budget) do
    budget.max_steps <= @default_hard_caps.max_steps and
      budget.max_tool_calls <= @default_hard_caps.max_tool_calls and
      budget.max_provider_calls <= @default_hard_caps.max_provider_calls
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
