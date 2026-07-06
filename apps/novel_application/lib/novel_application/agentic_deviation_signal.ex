defmodule NovelApplication.AgenticDeviationSignal do
  @moduledoc """
  Deterministic ADR-0023 deviation signal detector for plan-driven AgentRun flows.
  """

  alias NovelDomain.{AgentObservation, AgentRun}

  @actionable_quality_actions ~w(confirm block)

  @type signal :: %{
          required(:signal) => String.t(),
          required(:ref) => String.t(),
          required(:summary) => String.t(),
          optional(:source) => String.t(),
          optional(:payload) => map()
        }

  @spec next(AgentRun.t(), map(), [map()], non_neg_integer(), keyword()) :: signal() | nil
  def next(%AgentRun{} = run, snapshot, plan_steps, cursor, opts \\ []) do
    stage_state = stage_state(snapshot)
    handled = handled_refs(stage_state)

    [
      stage_deviation(stage_state),
      quality_deviation(snapshot),
      deterministic_gap_deviation(snapshot),
      step_precondition_deviation(
        run,
        stage_state,
        plan_steps,
        cursor,
        Keyword.get(opts, :step_preconditions, %{})
      ),
      budget_deviation(run, plan_steps, cursor)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.find(fn deviation -> not MapSet.member?(handled, deviation.ref) end)
  end

  @spec revision_reason(signal()) :: String.t()
  def revision_reason(%{signal: signal, summary: summary}) do
    "#{signal} 偏离信号：#{summary}"
  end

  @spec reason_codes(signal()) :: [String.t()]
  def reason_codes(%{signal: signal}) do
    ["agentic_deviation", "agentic_deviation:#{signal}", "agent_plan_revised"]
  end

  @spec stage_state_patch(signal(), map()) :: map()
  def stage_state_patch(%{ref: ref}, stage_state \\ %{}) do
    refs =
      stage_state
      |> handled_refs()
      |> MapSet.put(ref)
      |> MapSet.to_list()
      |> Enum.sort()

    %{agentic_deviation_handled_refs: refs}
  end

  defp stage_deviation(stage_state) when is_map(stage_state) do
    case map_get(stage_state, :agentic_deviation) do
      deviation when is_map(deviation) ->
        build_deviation(
          map_get(deviation, :signal),
          map_get(deviation, :ref) || map_get(deviation, :source_ref),
          map_get(deviation, :summary),
          map_get(deviation, :source),
          deviation
        )

      _ ->
        nil
    end
  end

  defp quality_deviation(snapshot) do
    snapshot
    |> observations()
    |> Enum.find_value(fn
      %AgentObservation{observation_type: :quality_review, structured_payload: payload} =
          observation ->
        action = payload |> map_get(:policy_action) |> string_value()

        if action in @actionable_quality_actions do
          build_deviation(
            "D2",
            observation.observation_id,
            "质量复核要求行动：#{action}",
            "quality_review",
            payload
          )
        end

      _ ->
        nil
    end)
  end

  defp deterministic_gap_deviation(snapshot) do
    snapshot
    |> observations()
    |> Enum.find_value(fn
      %AgentObservation{structured_payload: payload} = observation when is_map(payload) ->
        case map_get(payload, :deterministic_gap) || map_get(payload, :missing_policy) do
          value when value in [true, "true", :missing_policy, "missing_policy"] ->
            build_deviation(
              "D7",
              observation.observation_id,
              observation.summary,
              "deterministic_gap",
              payload
            )

          _ ->
            nil
        end

      _ ->
        nil
    end)
  end

  # D1（step 无法启动的确定性早检）：模型起草的计划漏掉了产出前置输入的步骤时，
  # 下一步在派发前就已注定失败。这里按 flow 声明的 step_preconditions 在执行前
  # 检出，走 replan 通道给模型一次改道机会，而不是执行期硬 run_failed
  # （ADR-0023 D1：「替代现状直接 run_failed」）。
  defp step_precondition_deviation(%AgentRun{} = run, stage_state, plan_steps, cursor, preconditions)
       when is_list(plan_steps) and is_integer(cursor) and is_map(preconditions) and
              preconditions != %{} do
    with step when is_map(step) <- Enum.at(plan_steps, cursor),
         target when is_binary(target) <- string_value(map_get(step, :target_tool_ref)),
         required when is_list(required) and required != [] <-
           Map.get(preconditions, target, []) do
      missing =
        Enum.reject(required, fn key ->
          Map.has_key?(stage_state, key) or Map.has_key?(stage_state, Atom.to_string(key))
        end)

      case missing do
        [] ->
          nil

        missing ->
          missing_keys = Enum.map(missing, &to_string/1)

          build_deviation(
            "D1",
            "precondition:#{run.run_id}:#{cursor}:#{target}",
            "计划第 #{cursor + 1} 步 #{target} 缺少前置输入（#{Enum.join(missing_keys, ", ")}）：产出这些输入的步骤未被排入计划。",
            "step_precondition",
            %{
              target_tool_ref: target,
              cursor: cursor,
              missing_stage_state_keys: missing_keys
            }
          )
      end
    else
      _ -> nil
    end
  end

  defp step_precondition_deviation(_run, _stage_state, _plan_steps, _cursor, _preconditions),
    do: nil

  defp budget_deviation(%AgentRun{} = run, plan_steps, cursor)
       when is_list(plan_steps) and is_integer(cursor) do
    pending_steps = max(length(plan_steps) - cursor, 0)

    cond do
      pending_steps <= 0 ->
        nil

      remaining_steps(run) < pending_steps ->
        build_deviation(
          "D5",
          "budget:steps:#{run.run_id}:#{cursor}",
          "剩余 step 预算不足以走完当前计划。",
          "budget",
          %{remaining_steps: remaining_steps(run), pending_steps: pending_steps}
        )

      remaining_tool_calls(run) < pending_tool_steps(plan_steps, cursor) ->
        build_deviation(
          "D5",
          "budget:tool_calls:#{run.run_id}:#{cursor}",
          "剩余 tool 预算不足以走完当前计划。",
          "budget",
          %{
            remaining_tool_calls: remaining_tool_calls(run),
            pending_tool_steps: pending_tool_steps(plan_steps, cursor)
          }
        )

      true ->
        nil
    end
  end

  defp budget_deviation(_run, _plan_steps, _cursor), do: nil

  defp remaining_steps(%AgentRun{budget: budget, consumed_budget: consumed}),
    do: remaining(budget, consumed, :max_steps, :steps)

  defp remaining_tool_calls(%AgentRun{budget: budget, consumed_budget: consumed}),
    do: remaining(budget, consumed, :max_tool_calls, :tool_calls)

  defp remaining(budget, consumed, max_key, consumed_key),
    do: max(int_value(budget, max_key, 0) - int_value(consumed, consumed_key, 0), 0)

  defp pending_tool_steps(plan_steps, cursor) do
    plan_steps
    |> Enum.drop(cursor)
    |> Enum.count(&(map_get(&1, :kind) in [:act, "act"]))
  end

  defp build_deviation(signal, ref, summary, source, payload)
       when is_binary(signal) and signal != "" and is_binary(ref) and ref != "" and
              is_binary(summary) and summary != "" do
    %{
      signal: signal,
      ref: ref,
      summary: summary,
      source: source || signal,
      payload: payload || %{}
    }
  end

  defp build_deviation(_signal, _ref, _summary, _source, _payload), do: nil

  defp observations(snapshot) when is_map(snapshot) do
    case Map.get(snapshot, :observations) do
      observations when is_list(observations) -> observations
      _ -> []
    end
  end

  defp stage_state(snapshot) when is_map(snapshot) do
    case Map.get(snapshot, :stage_state) do
      stage_state when is_map(stage_state) -> stage_state
      _ -> %{}
    end
  end

  defp stage_state(_snapshot), do: %{}

  defp handled_refs(stage_state) when is_map(stage_state) do
    stage_state
    |> map_get(:agentic_deviation_handled_refs)
    |> case do
      refs when is_list(refs) -> refs
      _ -> []
    end
    |> Enum.map(&to_string/1)
    |> MapSet.new()
  end

  defp handled_refs(_stage_state), do: MapSet.new()

  defp int_value(map, key, default) when is_map(map) do
    case map_get(map, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp int_value(_map, _key, default), do: default

  defp string_value(value) when is_binary(value), do: String.trim(value)
  defp string_value(value) when is_atom(value), do: Atom.to_string(value)
  defp string_value(_value), do: nil

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
