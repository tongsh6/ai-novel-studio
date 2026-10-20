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
  Expand an existing run budget to fit the drafted plan without shrinking it.

  Used by the runtime after plan draft. Absolute hard caps still apply; author
  limits / D5 semantics are layered in CP2/CP3.
  """
  @spec expand(map(), [map()], keyword()) :: map()
  def expand(existing, plan_steps, opts \\ []) when is_map(existing) and is_list(plan_steps) do
    result = for_plan(plan_steps, opts)

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
