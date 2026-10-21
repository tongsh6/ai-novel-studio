defmodule NovelApplication.AgentRunBudget do
  @moduledoc """
  Pure execution-budget policy for a drafted AgentPlan.

  Budget is derived from the plan's step/tool/provider cost, then capped by
  author limits and absolute hard safety caps. Planning-phase cost is not part
  of this execution budget; callers should account for judgment/plan drafting
  separately.
  """

  @default_hard_caps %{
    max_steps: 50,
    max_tool_calls: 50,
    max_provider_calls: 100,
    max_replans: 1
  }

  @type cost :: %{
          steps: non_neg_integer(),
          tool_calls: non_neg_integer(),
          provider_calls: non_neg_integer()
        }
  @type hard_caps :: %{
          max_steps: pos_integer(),
          max_tool_calls: pos_integer(),
          max_provider_calls: pos_integer(),
          max_replans: non_neg_integer()
        }
  @type author_limits :: %{optional(:max_steps) => pos_integer() | nil}
  @type result :: %{
          budget: map(),
          required: cost(),
          shortfall: cost(),
          over_budget?: boolean()
        }

  @spec for_plan([map()], keyword()) :: result()
  def for_plan(plan_steps, opts \\ []) when is_list(plan_steps) do
    hard_caps = Map.merge(@default_hard_caps, Map.new(Keyword.get(opts, :hard_caps, %{})))
    author_limits = Keyword.get(opts, :author_limits, %{})

    overhead =
      Map.new(
        Keyword.get(opts, :execution_overhead, %{steps: 0, tool_calls: 0, provider_calls: 0})
      )

    required =
      plan_steps
      |> Enum.reduce(%{steps: 0, tool_calls: 0, provider_calls: 0}, fn step, acc ->
        cost = step_cost(step)

        %{
          steps: acc.steps + cost.steps,
          tool_calls: acc.tool_calls + cost.tool_calls,
          provider_calls: acc.provider_calls + cost.provider_calls
        }
      end)
      |> add_cost(overhead)

    budget =
      %{
        max_steps: min(required.steps, hard_caps.max_steps),
        max_tool_calls: min(required.tool_calls, hard_caps.max_tool_calls),
        max_provider_calls: min(required.provider_calls, hard_caps.max_provider_calls),
        max_replans: hard_caps.max_replans
      }
      |> apply_author_limits(author_limits)

    shortfall = %{
      steps: max(required.steps - budget.max_steps, 0),
      tool_calls: max(required.tool_calls - budget.max_tool_calls, 0),
      provider_calls: max(required.provider_calls - budget.max_provider_calls, 0)
    }

    %{
      budget: budget,
      required: required,
      shortfall: shortfall,
      over_budget?:
        shortfall.steps > 0 or shortfall.tool_calls > 0 or shortfall.provider_calls > 0
    }
  end

  @doc """
  Expand an existing run budget to fit the drafted plan.

  Author max_steps is a hard cap and may shrink the effective step budget; the
  runtime must surface the resulting shortfall instead of silently expanding.
  """
  @spec expand(map(), [map()], keyword()) :: map()
  def expand(existing, plan_steps, opts \\ []) when is_map(existing) and is_list(plan_steps) do
    result = for_plan(plan_steps, opts)
    author_limits = Keyword.get(opts, :author_limits, %{})

    existing
    |> Map.put(:max_steps, max(Map.get(existing, :max_steps, 0), result.budget.max_steps))
    |> Map.put(
      :max_tool_calls,
      max(Map.get(existing, :max_tool_calls, 0), result.budget.max_tool_calls)
    )
    |> Map.put(
      :max_provider_calls,
      max(Map.get(existing, :max_provider_calls, 0), result.budget.max_provider_calls)
    )
    |> apply_author_step_cap(author_limits)
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

  defp apply_author_step_cap(budget, author_limits) do
    case map_get(author_limits, :max_steps) do
      value when is_integer(value) and value > 0 ->
        %{budget | max_steps: min(budget.max_steps, value)}

      _ ->
        budget
    end
  end

  defp apply_author_limits(budget, author_limits) do
    case map_get(author_limits, :max_steps) do
      value when is_integer(value) and value > 0 ->
        %{budget | max_steps: min(budget.max_steps, value)}

      _ ->
        budget
    end
  end

  defp step_cost(step) do
    target = map_get(step, :target_tool_ref)
    kind = map_get(step, :kind)

    cond do
      target == "prose_writing" ->
        %{steps: 1, tool_calls: 1, provider_calls: 2}

      target == "chapter_mission" ->
        %{steps: 1, tool_calls: 0, provider_calls: 1}

      target == "context_assemble" ->
        %{steps: 1, tool_calls: 1, provider_calls: 0}

      kind in [:explore, "explore"] ->
        %{steps: 1, tool_calls: 0, provider_calls: 0}

      kind in [:act, "act"] ->
        %{steps: 1, tool_calls: 1, provider_calls: 1}

      true ->
        %{steps: 1, tool_calls: 0, provider_calls: 0}
    end
  end

  defp add_cost(left, right) do
    %{
      steps: left.steps + Map.get(right, :steps, 0),
      tool_calls: left.tool_calls + Map.get(right, :tool_calls, 0),
      provider_calls: left.provider_calls + Map.get(right, :provider_calls, 0)
    }
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
