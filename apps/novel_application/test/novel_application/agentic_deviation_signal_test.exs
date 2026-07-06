defmodule NovelApplication.AgenticDeviationSignalTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgenticDeviationSignal
  alias NovelDomain.{AgentObservation, AgentRun}

  test "detects D1 and D4 stage deviations" do
    assert %{signal: "D1", ref: "tool_result:failed"} =
             AgenticDeviationSignal.next(
               run(),
               %{
                 stage_state: %{
                   agentic_deviation: %{
                     signal: "D1",
                     ref: "tool_result:failed",
                     summary: "工具失败",
                     source: "tool_result"
                   }
                 },
                 observations: []
               },
               [],
               0
             )

    assert %{signal: "D4", ref: "gate:blocked"} =
             AgenticDeviationSignal.next(
               run(),
               %{
                 stage_state: %{
                   agentic_deviation: %{
                     signal: "D4",
                     ref: "gate:blocked",
                     summary: "系统裁决阻止执行",
                     source: "orchestrator_gate"
                   }
                 },
                 observations: []
               },
               [],
               0
             )
  end

  test "detects D2 quality action that requires follow-up" do
    observation =
      observation(:quality_review, "质量复核要求行动。", %{
        policy_action: "confirm",
        finding_count: 1
      })

    assert %{signal: "D2", ref: "obs_quality_review"} =
             AgenticDeviationSignal.next(run(), %{observations: [observation]}, [], 0)
  end

  test "detects D5 budget shortfall against pending plan steps" do
    plan_steps = [
      %{step_id: "context", kind: "explore", target_tool_ref: "context_assemble"},
      %{step_id: "write", kind: "act", target_tool_ref: "prose_writing"}
    ]

    assert %{signal: "D5", summary: summary} =
             AgenticDeviationSignal.next(
               run(%{budget: %{max_steps: 1, max_tool_calls: 4}}),
               %{observations: []},
               plan_steps,
               0
             )

    assert summary =~ "剩余 step 预算不足"
  end

  test "detects D1 step precondition gap before dispatching the step" do
    plan_steps = [
      %{step_id: "context", kind: "explore", target_tool_ref: "context_assemble"},
      %{step_id: "strategy", kind: "explore", target_tool_ref: "strategy_gate"}
    ]

    preconditions = %{"strategy_gate" => [:input, :frame, :context]}

    assert %{signal: "D1", source: "step_precondition", summary: summary, payload: payload} =
             AgenticDeviationSignal.next(
               run(),
               %{stage_state: %{input: %{}, context: %{}}, observations: []},
               plan_steps,
               1,
               step_preconditions: preconditions
             )

    assert summary =~ "strategy_gate"
    assert summary =~ "前置输入"
    assert payload.missing_stage_state_keys == ["frame"]

    # 前置齐备时不触发
    refute AgenticDeviationSignal.next(
             run(),
             %{stage_state: %{input: %{}, frame: %{}, context: %{}}, observations: []},
             plan_steps,
             1,
             step_preconditions: preconditions
           )

    # 未声明前置的步骤不触发
    refute AgenticDeviationSignal.next(
             run(),
             %{stage_state: %{}, observations: []},
             plan_steps,
             0,
             step_preconditions: preconditions
           )
  end

  test "detects D7 deterministic gap observation" do
    observation =
      observation(:custom, "目标章节缺失。", %{
        deterministic_gap: true,
        missing_policy: true
      })

    assert %{signal: "D7", ref: "obs_custom"} =
             AgenticDeviationSignal.next(run(), %{observations: [observation]}, [], 0)
  end

  test "stage state patch suppresses repeated deviation handling" do
    deviation = %{signal: "D4", ref: "gate:blocked", summary: "系统裁决阻止执行"}
    patch = AgenticDeviationSignal.stage_state_patch(deviation)

    refute AgenticDeviationSignal.next(
             run(),
             %{
               stage_state:
                 Map.put(patch, :agentic_deviation, %{
                   signal: "D4",
                   ref: "gate:blocked",
                   summary: "系统裁决阻止执行"
                 }),
               observations: []
             },
             [],
             0
           )
  end

  defp run(attrs \\ %{}) do
    {:ok, run} =
      AgentRun.new(
        Map.merge(
          %{
            run_id: "run_deviation",
            workspace_id: "ws",
            work_id: "work",
            session_id: "session",
            parent_turn_ref: "turn",
            origin_frame_ref: "frame",
            profile_ref: "prose_drafting_with_quality_v1",
            goal: %{text: "测试偏离信号", version: 1},
            authority_scope: %{allowed_tools: ["prose_writing", "context_assemble"]},
            budget: %{
              max_steps: 5,
              max_tool_calls: 4,
              max_provider_calls: 5,
              max_replans: 1,
              max_pending_artifacts: 1
            }
          },
          attrs
        )
      )

    run
  end

  defp observation(type, summary, payload) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{type}",
        run_ref: "run_deviation",
        step_ref: "step_1",
        observation_type: type,
        source_ref: "source:#{type}",
        summary: summary,
        structured_payload: payload,
        evidence_refs: ["source:#{type}"]
      })

    observation
  end
end
