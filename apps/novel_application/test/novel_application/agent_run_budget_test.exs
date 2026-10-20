defmodule NovelApplication.AgentRunBudgetTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunBudget

  defp step(target, kind, attrs \\ %{}) do
    Map.merge(%{target_tool_ref: target, kind: kind}, attrs)
  end

  test "derives a 4-step execution budget from plan costs" do
    plan = [
      step("context_assemble", "explore"),
      step("chapter_mission", "explore"),
      step("prose_writing", "act"),
      step("character_evolution", "act")
    ]

    result = AgentRunBudget.for_plan(plan)

    assert result.required == %{steps: 4, tool_calls: 3, provider_calls: 4}
    assert result.budget.max_steps == 4
    assert result.budget.max_tool_calls == 3
    assert result.budget.max_provider_calls == 4
    refute result.over_budget?
  end

  test "a 7-step plan gets 7 execution steps instead of a hardcoded 6" do
    plan = for index <- 1..7, do: step("context_assemble", "explore", %{step_id: "ctx_#{index}"})

    result = AgentRunBudget.for_plan(plan)

    assert result.budget.max_steps == 7
    assert result.required.steps == 7
    refute result.over_budget?
  end

  test "hard caps produce an explicit step shortfall" do
    plan = for index <- 1..7, do: step("context_assemble", "explore", %{step_id: "ctx_#{index}"})

    result =
      AgentRunBudget.for_plan(plan,
        hard_caps: %{max_steps: 6, max_tool_calls: 50, max_provider_calls: 100}
      )

    assert result.budget.max_steps == 6
    assert result.shortfall.steps == 1
    assert result.over_budget?
  end

  test "author max_steps wins over the plan-derived budget and exposes the gap" do
    plan = [
      step("context_assemble", "explore"),
      step("chapter_mission", "explore"),
      step("prose_writing", "act"),
      step("character_evolution", "act")
    ]

    result = AgentRunBudget.for_plan(plan, author_limits: %{max_steps: 1})

    assert result.budget.max_steps == 1
    assert result.required.steps == 4
    assert result.shortfall.steps == 3
    assert result.over_budget?
  end

  test "execution overhead is separate and counted" do
    result =
      AgentRunBudget.for_plan(
        [step("context_assemble", "explore")],
        execution_overhead: %{steps: 1, tool_calls: 0, provider_calls: 1}
      )

    assert result.required == %{steps: 2, tool_calls: 1, provider_calls: 1}
    assert result.budget.max_steps == 2
  end

  test "expand/3 grows an existing run budget to fit a larger plan" do
    existing = %{max_steps: 6, max_tool_calls: 5, max_provider_calls: 12, max_replans: 1}
    plan = for index <- 1..7, do: step("context_assemble", "explore", %{step_id: "ctx_#{index}"})

    expanded = AgentRunBudget.expand(existing, plan)

    assert expanded.max_steps == 7
    assert expanded.max_tool_calls == 7
    assert expanded.max_replans == 1
  end

  test "expand/3 never shrinks existing budget and respects hard caps" do
    existing = %{max_steps: 10, max_tool_calls: 10, max_provider_calls: 10, max_replans: 1}
    plan = [step("context_assemble", "explore")]

    assert AgentRunBudget.expand(existing, plan).max_steps == 10

    capped =
      AgentRunBudget.expand(existing, plan,
        hard_caps: %{max_steps: 6, max_tool_calls: 5, max_provider_calls: 12}
      )

    assert capped.max_steps == 10
    assert capped.max_tool_calls == 10
  end

  test "author limits detect 最多一步 and cap expanded budget" do
    assert AgentRunBudget.author_limits("请写一章，最多一步") == %{max_steps: 1}
    assert AgentRunBudget.author_limits("请写一章") == %{}

    plan = for index <- 1..7, do: step("context_assemble", "explore", %{step_id: "ctx_#{index}"})
    existing = %{max_steps: 6, max_tool_calls: 5, max_provider_calls: 12, max_replans: 1}

    expanded =
      AgentRunBudget.expand(existing, plan, author_limits: %{max_steps: 1})

    assert expanded.max_steps == 1
  end

  test "authorized next-step recovery adds one step and marks the override" do
    existing = %{max_steps: 1, max_tool_calls: 0, max_provider_calls: 0, max_replans: 1}
    consumed = %{steps: 3, tool_calls: 0, provider_calls: 4}
    plan = [step("context_assemble", "explore"), step("prose_writing", "act")]

    assert {:ok, budget} =
             AgentRunBudget.authorized_expand(existing, consumed, plan, :next_step)

    assert budget.max_steps == 5
    assert budget.max_tool_calls == 2
    assert budget.max_provider_calls == 7
    assert budget.max_replans == 1
    assert budget.author_budget_override == true
    assert budget.author_budget_override_mode == "next_step"
  end

  test "authorized N-step recovery counts execution steps, not planning overhead" do
    existing = %{max_steps: 1, max_tool_calls: 0, max_provider_calls: 0, max_replans: 1}

    consumed = %{
      steps: 3,
      execution_steps: 1,
      tool_calls: 0,
      provider_calls: 4
    }

    plan = [
      step("context_assemble", "explore"),
      step("plot_outline", "act"),
      step("prose_writing", "act"),
      step("character_evolution", "act")
    ]

    assert {:ok, budget} =
             AgentRunBudget.authorized_expand(existing, consumed, plan, {:steps, 2})

    assert budget.max_steps == 4
    assert budget.max_tool_calls == 3
    assert budget.max_provider_calls == 9
    assert budget.author_budget_override_mode == "steps:2"
  end

  test "authorized remaining-plan recovery fits the full plan after consumed planning" do
    existing = %{max_steps: 1, max_tool_calls: 0, max_provider_calls: 0, max_replans: 1}
    consumed = %{steps: 3, tool_calls: 0, provider_calls: 4}

    plan = [
      step("context_assemble", "explore"),
      step("plot_outline", "act"),
      step("prose_writing", "act"),
      step("character_evolution", "act")
    ]

    assert {:ok, budget} =
             AgentRunBudget.authorized_expand(existing, consumed, plan, :remaining_plan)

    assert budget.max_steps == 8
    assert budget.max_tool_calls == 5
    assert budget.max_provider_calls == 13
    assert budget.author_budget_override == true
  end

  test "authorized recovery rejects plans beyond absolute hard caps" do
    existing = %{max_steps: 1, max_tool_calls: 0, max_provider_calls: 0, max_replans: 1}
    consumed = %{steps: 0, tool_calls: 0, provider_calls: 0}
    plan = for index <- 1..51, do: step("context_assemble", "explore", %{step_id: "s#{index}"})

    assert {:error, :hard_cap_reached} =
             AgentRunBudget.authorized_expand(existing, consumed, plan, :remaining_plan)

    assert {:error, :invalid_recovery_mode} =
             AgentRunBudget.authorized_expand(existing, consumed, [], :next_step)
  end

  test "prose_writing costs one tool and two provider calls" do
    result = AgentRunBudget.for_plan([step("prose_writing", "act")])

    assert result.required == %{steps: 1, tool_calls: 1, provider_calls: 2}
    assert result.budget.max_provider_calls == 2
  end
end
