defmodule NovelApplication.AgenticPlanCompletedPrefixTest do
  @moduledoc "Pure completed-prefix preservation; Provider dispatch and canonical IR remain in the planner suite."
  use ExUnit.Case, async: true

  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelDomain.AgentRun

  # The guard consumes only plan and completed-step identity, not provider setup.
  defp prefix_run,
    do: %AgentRun{run_id: "run_plan_draft_test", plan: nil, completed_step_refs: []}

  describe "T3′ 修订前缀确定性校验" do
    alias NovelDomain.AgentPlan

    defp step(id, kind, target) do
      %{
        step_id: id,
        kind: kind,
        status: :completed,
        description: "步骤 #{id}",
        success_criteria: [],
        depends_on: [],
        target_tool_ref: target,
        write_intent: :none,
        risk_hint: :low
      }
    end

    defp run_with(completed_refs, steps) do
      base = prefix_run()

      {:ok, plan} =
        AgentPlan.new(%{
          plan_id: "ap_#{base.run_id}",
          run_ref: base.run_id,
          version: 1,
          goal_version: 1,
          steps: steps
        })

      %{base | plan: plan, completed_step_refs: completed_refs}
    end

    defp revised_plan(steps) do
      {:ok, plan} =
        AgentPlan.new(%{
          plan_id: "ap_revised",
          run_ref: "run_plan_draft_test",
          version: 2,
          goal_version: 1,
          steps: steps
        })

      plan
    end

    test "完整计划保留已完成前缀 → :ok" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1"], current)

      revised =
        revised_plan([
          step("s1", :explore, "context_assemble"),
          step("s2b", :act, "prose_writing")
        ])

      assert :ok = AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end

    test "改写已完成前缀 → 结构错误（走既有纠错重试）" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1"], current)

      revised =
        revised_plan([
          step("renamed", :explore, "chapter_read"),
          step("s3", :act, "prose_writing")
        ])

      assert {:error, :completed_prefix_changed} =
               AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end

    test "只给尾部（无已完成前缀）→ 结构错误（现行 prompt 契约要求完整计划）" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1", "step_s2"], current)

      assert {:error, :completed_prefix_changed} =
               AgenticPlanDraftPlanner.validate_completed_prefix(
                 run,
                 revised_plan([step("tail1", :act, "quality_review")])
               )
    end

    test "无当前 plan 或无已完成步骤 → 不适用（draft 不受影响）" do
      run = prefix_run()
      revised = revised_plan([step("s1", :explore, "context_assemble")])

      assert :ok = AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end
  end
end
