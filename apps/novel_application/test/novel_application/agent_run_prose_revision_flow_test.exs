defmodule NovelApplication.AgentRunProseRevisionFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.ProseRevisionFromFindings
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-agent-prose-revision-flow"
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"
  @revised_body "雨水顺着旧窗棂淌下，他攥紧那页残诀，呼吸忽然急促——这一次，他决定不再退。"

  test "bounded revision run exposes source, gate, tool execution, and finalization steps" do
    parent = self()
    source = run_prose_turn()
    revise = revise_action(source)

    action_input = %AuthorActionInput{
      input_id: "in-agent-revise",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    provider = fn prompt ->
      if agent_next_step_prompt?(prompt) do
        {:ok, %{content: Jason.encode!(revision_next_step_decision(prompt))}}
      else
        send(parent, {:revision_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-agent-revision",
           content:
             Jason.encode!(%{
               items: [
                 %{item_id: "agent-rev-item", title: "第01章（修订）", body: @revised_body}
               ],
               self_report: %{
                 assumptions: [],
                 intended_reader_effect: nil,
                 used_context_refs: [],
                 risk_flags: []
               }
             })
         }}
      end
    end

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-revision-flow",
      turn_id: source.turn_id,
      source_turn_result: source,
      action_input: action_input
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil,
        %Execution{complete_fn: provider}
      )

    assert planned.run_attrs.profile_ref == ProseRevisionFromFindings.profile_ref()
    assert is_function(planned.next_step_planner, 3)
    refute Map.has_key?(planned, :steps)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :step_proposed, source_step}
    assert source_step.summary =~ "读取待修订草稿和质量发现"
    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "待修订草稿"
    assert_receive {:agent_event, :observation_recorded, source_observation}, 500
    assert source_observation.summary =~ "已读取待修订草稿"
    assert_receive {:agent_event, :plan_created, source_decision}, 500
    assert "agent_next_step_decided" in source_decision.reason_codes

    assert_receive {:agent_event, :step_proposed, plan_step}, 500
    assert plan_step.summary =~ "制定修订执行策略并完成授权判断"
    assert_receive {:agent_event, :plan_created, plan_event}, 500
    assert plan_event.summary =~ "修订执行计划"
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "已通过修订工具执行授权"
    assert_receive {:agent_event, :observation_recorded, gate_observation}, 500
    assert gate_observation.summary =~ "重新经过 Orchestrator"

    assert_receive {:agent_event, :step_proposed, execute_step}, 500
    assert execute_step.summary =~ "生成修订候选草稿"
    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "正文写作能力"
    assert_receive {:revision_prompt, revision_prompt}, 500
    assert revision_prompt =~ "[质量修订要求]"
    assert revision_prompt =~ @bad_prose
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "修订候选已生成"
    assert_receive {:agent_event, :observation_recorded, execute_observation}, 500
    assert execute_observation.summary =~ "不自动采纳"

    assert_receive {:agent_event, :step_proposed, final_step}, 500
    assert final_step.summary =~ "汇总修订候选给作者"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 4
    assert state.run.consumed_budget.steps == 4
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 6

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "prose_revision_from_findings_v1"
    assert turn_result.trace_summary.decision_type == "revise_from_findings"
    assert turn_result.trace_summary.revision_provider_call_ref == "pc-agent-revision"
    refute Map.has_key?(turn_result, :quality_review)
    refute turn_result.truthfulness.artifact_adopted
    refute turn_result.truthfulness.production_write_performed

    assert [%{adoption_status: :tentative, artifact_type: :prose_fragment}] =
             turn_result.adoption_state.pending
  end

  defp revise_action(turn_result) do
    Enum.find(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  defp agent_next_step_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun 下一步规划器")

  defp revision_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        %{
          decision_type: "goal_satisfied",
          summary: "已生成待采纳修订草稿，本轮目标已经满足。",
          target_tool_ref: nil,
          write_intent: "none",
          risk_hint: "low",
          reason_codes: ["goal_satisfied", "tentative_revision_fragment_created"],
          confidence: 1.0
        }

      String.contains?(observations, "已生成新的修订候选") ->
        %{
          decision_type: "execute_step",
          summary: "汇总修订候选给作者确认。",
          target_tool_ref: "revision_finalize",
          write_intent: "none",
          risk_hint: "low",
          reason_codes: ["agentic_next_step", "revision_candidate_ready"],
          confidence: 1.0
        }

      String.contains?(observations, "重新经过 Orchestrator") ->
        %{
          decision_type: "execute_step",
          summary: "基于修订计划生成正文修订候选。",
          target_tool_ref: "prose_writing",
          write_intent: "tentative",
          risk_hint: "low",
          reason_codes: ["agentic_next_step", "revision_plan_consumed"],
          confidence: 1.0
        }

      String.contains?(observations, "已读取待修订草稿") ->
        %{
          decision_type: "execute_step",
          summary: "制定修订执行策略并重新经过系统裁决。",
          target_tool_ref: "revision_plan",
          write_intent: "none",
          risk_hint: "low",
          reason_codes: ["agentic_next_step", "revision_source_consumed"],
          confidence: 1.0
        }

      true ->
        %{
          decision_type: "execute_step",
          summary: "读取待修订草稿和质量发现。",
          target_tool_ref: "revision_prepare",
          write_intent: "none",
          risk_hint: "low",
          reason_codes: ["agentic_next_step", "missing_revision_source"],
          confidence: 1.0
        }
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp run_prose_turn do
    complete = fn _prompt ->
      {:ok,
       %{
         content:
           Jason.encode!(%{
             items: [%{item_id: "cp3-item", title: "第01章", body: @bad_prose, rationale: nil}],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: [],
               risk_flags: []
             }
           })
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "写第一章正文首稿"},
        provider_execution: %Execution{complete_fn: complete}
      })

    turn_result
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [%{title: "第01章：开端", seq: 1, summary: "主角登场。", has_prose: false}],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      dialogue_goal: %{summary: "写第一章正文首稿"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "准备写正文。"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan do
    %MicroPlan{
      plan_id: "plan-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      frame_ref: "frame-agent-revision-source",
      primary: true,
      plan_goal: %{summary: "写第一章正文首稿"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-agent-revision-source",
          action_type: :capability_invocation,
          summary: "生成正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low
        }
      ],
      stop_after_next_action: true
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      frame_ref: "frame-agent-revision-source",
      plan_ref: "plan-agent-revision-source",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["all_gates_passed"],
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: []
    }
  end
end
