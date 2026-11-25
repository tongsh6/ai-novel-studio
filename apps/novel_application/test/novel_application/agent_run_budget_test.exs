defmodule NovelApplication.AgentRunBudgetTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunBudget

  defp step(target, kind, attrs \\ %{}) do
    Map.merge(%{target_tool_ref: target, kind: kind}, attrs)
  end

  test "role change retains cumulative grant and explicit author scope, tightening only profile restrictions" do
    grant = AgentRunBudget.entry(:profile_routing, %{max_steps: 1})

    assert grant == %{
             max_steps: 1,
             max_tool_calls: 6,
             max_provider_calls: 33,
             max_replans: 1,
             max_pending_artifacts: 3,
             author_max_steps: 1
           }

    routed = AgentRunBudget.restrict_for_profile(grant, :prose_drafting_with_quality)
    assert routed == %{grant | max_pending_artifacts: 1}

    # A later role change cannot lift an already tightened scope.
    assert AgentRunBudget.restrict_for_profile(routed, :judgment_plan) == routed
    explicit = %{routed | max_provider_calls: 40}
    assert AgentRunBudget.restrict_for_profile(explicit, :prose_drafting_with_quality) == explicit
  end

  test "real confirmation action has its own existing grant, not generic planning overhead" do
    assert AgentRunBudget.entry(:tool_confirmation_action) ==
             %{
               max_steps: 4,
               max_tool_calls: 1,
               max_provider_calls: 14,
               max_replans: 0,
               max_pending_artifacts: 3
             }
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
end
