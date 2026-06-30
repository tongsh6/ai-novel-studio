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
        {:ok, %{content: Jason.encode!(next_step_decision(prompt))}}
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
      quality_provider_execution: %Execution{complete_fn: evaluator},
      chapter_prose_reader: fn _work_id, _chapter -> "" end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{complete_fn: writer}
      )

    assert planned.run_attrs.profile_ref == ProseDraftingWithQuality.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :step_proposed, context_step}
    assert context_step.summary =~ "组装正文写作上下文"
    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "正文写作上下文"
    assert_receive {:agent_event, :observation_recorded, context_observation}, 500
    assert context_observation.summary =~ "已组装正文写作上下文"
    assert_receive {:agent_event, :plan_created, context_decision}, 500
    assert "agent_next_step_decided" in context_decision.reason_codes

    assert_receive {:agent_event, :plan_created, plan_event}, 500
    assert plan_event.summary =~ "已根据观察制定下一步计划"
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :step_proposed, prose_step}, 500
    assert prose_step.summary =~ "根据观察制定下一步计划"
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
    assert_receive {:agent_event, :observation_recorded, quality_event}, 500
    assert quality_event.summary =~ "质量复核已完成"
    assert_receive {:agent_event, :observation_recorded, observation_event}, 500
    assert observation_event.summary =~ "正文草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :step_proposed, final_step}, 500
    assert final_step.summary =~ "正文草稿目标"
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

  defp next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        %{
          "decision_type" => "goal_satisfied",
          "summary" => "已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。",
          "target_tool_ref" => nil,
          "write_intent" => "none",
          "risk_hint" => "low",
          "reason_codes" => ["goal_satisfied"],
          "confidence" => 1.0
        }

      String.contains?(prompt, "prose_context /") ->
        %{
          "decision_type" => "execute_step",
          "summary" => "基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "target_tool_ref" => "prose_writing",
          "write_intent" => "tentative",
          "risk_hint" => "low",
          "reason_codes" => ["agentic_next_step", "prose_context_consumed"],
          "confidence" => 1.0
        }

      true ->
        %{
          "decision_type" => "execute_step",
          "summary" => "先读取正文写作上下文。",
          "target_tool_ref" => "context_assemble",
          "write_intent" => "none",
          "risk_hint" => "low",
          "reason_codes" => ["agentic_next_step", "missing_prose_context"],
          "confidence" => 1.0
        }
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
