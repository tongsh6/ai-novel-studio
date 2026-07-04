defmodule NovelApplication.AgentRunProseDraftingFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-prose-flow"
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"

  test "bounded prose run exposes context, strategy, prose quality, and finalization steps" do
    parent = self()

    writer = fn prompt ->
      if String.contains?(prompt, "AgentRun 下一步规划器") do
        {:ok,
         %{
           content:
             NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
         }}
      else
        send(parent, {:writer_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-agent-prose-writer",
           content:
             Jason.encode!(%{
               items: [
                 %{
                   item_id: "agent-prose-item",
                   title: "第01章：开端",
                   body: @bad_prose,
                   rationale: "首稿候选。"
                 }
               ],
               self_report: %{
                 assumptions: [],
                 intended_reader_effect: "压迫感",
                 used_context_refs: ["prose_execution_brief"],
                 risk_flags: []
               }
             })
         }}
      end
    end

    evaluator = fn prompt ->
      send(parent, {:evaluator_prompt, prompt})

      {:ok,
       %{
         provider_call_ref: "pc-agent-prose-evaluator",
         content:
           Jason.encode!(%{
             "findings" => [
               %{
                 "quality_gate_ref" => "quality_gate.character_logic",
                 "validator_ref" => "validator.character_agency",
                 "severity" => "warn",
                 "action" => "adoption_review",
                 "summary" => "主角缺乏主动目标"
               }
             ]
           })
       }}
    end

    input = %{
      text: "先写第01章正文草稿，再做质量复核，检查是否有问题。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-flow",
      turn_id: "turn-agent-prose-flow",
      quality_provider_execution: %Execution{result_fn: evaluator},
      chapter_prose_reader: fn _work_id, _chapter -> "" end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert planned.run_attrs.profile_ref == ProseDraftingWithQuality.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :plan_drafted, context_step}
    assert context_step.summary =~ "读取正文写作上下文"
    assert context_step.payload.target_tool_ref == "context_assemble"
    assert is_list(context_step.payload.plan_steps)

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      context_step.payload.author_narrative_source
    )

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "正文写作上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装正文写作上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :plan_drafted, prose_step}, 500
    assert prose_step.summary =~ "生成正文草稿"
    assert prose_step.payload.target_tool_ref == "prose_writing"
    assert is_list(prose_step.payload.plan_steps)

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      prose_step.payload.author_narrative_source
    )

    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "正文写作能力"
    assert_receive {:writer_prompt, writer_prompt}, 500
    assert writer_prompt =~ "用户创作简述："
    assert writer_prompt =~ "场级执行简述"
    assert_receive {:evaluator_prompt, evaluator_prompt}, 500
    assert evaluator_prompt =~ "质量评审"
    refute evaluator_prompt =~ "用户创作简述："
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "质量复核已完成"
    assert_receive {:agent_event, :exploration_observed, quality_event}, 500
    assert quality_event.summary =~ "质量复核已完成"
    assert_receive {:agent_event, :exploration_observed, observation_event}, 500
    assert observation_event.summary =~ "正文草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, prose_decision}, 500
    assert prose_decision.payload.loop_decision_type == :goal_satisfied
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 5
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))
    assert Enum.any?(state.observations, &(&1.observation_type == :quality_review))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "prose_drafting_with_quality_v1"
    assert turn_result.tool_result.tool_name == "prose_writing"
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false

    assert [%{adoption_status: :tentative, artifact_type: :prose_fragment}] =
             turn_result.adoption_state.pending

    assert turn_result.quality_review.review_status == "completed"
    assert turn_result.quality_review.findings != []
    assert turn_result.trace_summary.writer_provider_call_ref == "pc-agent-prose-writer"
    assert turn_result.trace_summary.evaluator_provider_call_ref == "pc-agent-prose-evaluator"
    assert turn_result.trace_summary.provider_call_budget.writer == 1
    assert turn_result.trace_summary.provider_call_budget.evaluator == 1
    assert Enum.any?(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  test "continuation decision injects prior prose into writer and marks pending artifact for append adoption" do
    parent = self()
    prior_prose = "他在第一夜数清了灵气账单上的每一笔亏空。"

    writer = fn prompt ->
      if String.contains?(prompt, "AgentRun 下一步规划器") do
        {:ok,
         %{
           content:
             NovelApplication.TestAgenticLoopFixtures.reasoning_tail(
               continuation_next_step_decision(prompt)
             )
         }}
      else
        send(parent, {:writer_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-agent-prose-cont-writer",
           content:
             Jason.encode!(%{
               items: [
                 %{
                   item_id: "agent-prose-cont-item",
                   title: "第01章：开端",
                   body: "他把亏空的名字一笔一笔誊到旧账页背面。",
                   rationale: "续写候选。"
                 }
               ],
               self_report: %{
                 assumptions: [],
                 intended_reader_effect: "压迫感",
                 used_context_refs: ["prose_execution_brief"],
                 risk_flags: []
               }
             })
         }}
      end
    end

    evaluator = fn _prompt ->
      {:ok, %{provider_call_ref: "pc-agent-prose-cont-eval", content: Jason.encode!(%{"findings" => []})}}
    end

    input = %{
      text: "接着第01章：开端往下写一段正文，自然衔接前文。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-cont",
      turn_id: "turn-agent-prose-cont",
      quality_provider_execution: %Execution{result_fn: evaluator},
      chapter_prose_reader: fn _work_id, chapter ->
        if chapter == "第01章：开端", do: prior_prose, else: ""
      end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:writer_prompt, writer_prompt}, 2_000
    assert writer_prompt =~ prior_prose

    assert_receive {:agent_event, :artifact_created, artifact_event}, 2_000
    assert_receive {:agent_event, :run_completed, _}, 2_000

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id

    assert [pending] = turn_result.adoption_state.pending
    assert pending.artifact_type == :prose_fragment
    assert pending.authoring_intent == :continuation
    assert pending.target_chapter == "第01章：开端"
  end

  defp continuation_next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("续写候选已生成并复核，本轮目标已经满足。")

      String.contains?(prompt, "prose_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "作者要求接着第01章继续写，按续写生成正文并复核。",
          "prose_writing",
          write_intent: "tentative",
          next_action_extra: %{
            "authoring_intent" => "continuation",
            "target_chapter" => "第01章：开端",
            "requested_chapter_raw" => "第01章"
          }
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取正文写作上下文。",
          "context_assemble"
        )
    end
  end

  defp next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。")

      String.contains?(prompt, "prose_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "prose_writing",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "prose_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取正文写作上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_prose_context"]
        )
    end
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [
        %{
          title: "第01章：开端",
          seq: 1,
          summary: "主角第一次进入封闭空间。",
          has_prose: false,
          plan_direction: %{
            "chapter_role" => "开端",
            "plot_progress" => "主角进入异常房间并发现压力来源",
            "character_change" => "从被动观察转向主动寻找出口",
            "information_release" => "房间和旧公司实验有关",
            "foreshadowing_action" => "茶杯上有旧编号",
            "emotion" => "压抑、警觉"
          }
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end
end
