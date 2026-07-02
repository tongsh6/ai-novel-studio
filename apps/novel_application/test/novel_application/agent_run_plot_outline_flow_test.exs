defmodule NovelApplication.AgentRunPlotOutlineFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-outline-flow"

  test "bounded plot outline run exposes context, strategy, tool execution, and finalization steps" do
    parent = self()

    result_fn = fn prompt ->
      if String.contains?(prompt, "AgentRun 下一步规划器") do
        {:ok,
         %{
           content:
             NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
         }}
      else
        send(parent, {:provider_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-agent-outline-writer",
           content:
             Jason.encode!([
               %{
                 "item_id" => "outline-chapter-01",
                 "title" => "第01章：债务入场",
                 "body" => "林烬在矿区债务纠纷中第一次看见旧秩序的裂缝。",
                 "rationale" => "建立主角压力与世界矛盾。"
               }
             ])
         }}
      end
    end

    input = %{
      text: "请基于当前作品规划十二章章节大纲。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-outline-flow",
      turn_id: "turn-agent-outline-flow"
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :plot_outline_with_context,
        input,
        context(),
        %Execution{result_fn: result_fn}
      )

    assert planned.run_attrs.profile_ref == PlotOutlineWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :plan_drafted, context_step}
    assert context_step.summary =~ "读取章节大纲规划上下文"
    assert context_step.payload.target_tool_ref == "context_assemble"
    assert is_list(context_step.payload.plan_steps)

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      context_step.payload.author_narrative_source
    )

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "章节大纲规划上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装章节大纲规划上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    assert_receive {:agent_event, :plan_drafted, outline_step}, 500
    assert outline_step.summary =~ "生成章节大纲草稿"
    assert outline_step.payload.target_tool_ref == "plot_outline"
    assert is_list(outline_step.payload.plan_steps)

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      outline_step.payload.author_narrative_source
    )

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "章节大纲规划能力"
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "当前 AgentStep"
    assert provider_prompt =~ "章节大纲"
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "章节大纲草稿已生成"
    assert_receive {:agent_event, :exploration_observed, tool_observation}, 500
    assert tool_observation.summary =~ "待采纳大纲草稿"

    assert_receive {:agent_event, :exploration_observed, artifact_observation}, 500
    assert artifact_observation.summary =~ "大纲草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, outline_decision}, 500
    assert outline_decision.payload.loop_decision_type == :goal_satisfied
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 4
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "plot_outline_with_context_v1"
    assert turn_result.tool_result.tool_name == "plot_outline"
    assert turn_result.tool_result.output.artifact_type == :outline_draft
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false
    refute Map.has_key?(turn_result, :quality_review)

    assert [%{adoption_status: :tentative, artifact_type: :outline_draft}] =
             turn_result.adoption_state.pending

    assert turn_result.trace_summary.writer_provider_call_ref == "pc-agent-outline-writer"
    assert turn_result.trace_summary.provider_call_budget.writer == 1
    assert turn_result.trace_summary.provider_call_budget.evaluator == 0
  end

  defp next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳大纲候选，本轮目标已经满足。")

      String.contains?(prompt, "outline_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的章节上下文生成章节大纲草稿。",
          "plot_outline",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "outline_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取章节大纲规划上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_outline_context"]
        )
    end
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: [],
      structured_chapters: [
        %{
          title: "第00章：开局设定",
          seq: 0,
          summary: "矿区旧债与主角压力已经建立。",
          has_prose: false
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end
end
