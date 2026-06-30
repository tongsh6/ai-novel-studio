defmodule NovelApplication.AgentRunCharacterEvolutionFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-character-evolution-flow"

  test "bounded character evolution run exposes context, strategy, tool execution, and finalization steps" do
    parent = self()

    complete_fn = fn prompt ->
      if String.contains?(prompt, "AgentRun 下一步规划器") do
        {:ok, %{content: Jason.encode!(next_step_decision(prompt))}}
      else
        send(parent, {:provider_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-agent-character-evolution-writer",
           content:
             Jason.encode!([
               %{
                 "item_id" => "evo-lin-current-state",
                 "title" => "林烬：右臂重伤",
                 "body" => "林烬在矿区冲突后右臂重伤，短期内无法继续正面突袭。",
                 "memory_subtype" => "CURRENT_STATE",
                 "rationale" => "该状态限制后续行动方式，并推动他转向策略布局。"
               }
             ])
         }}
      end
    end

    input = %{
      text: "更新林烬的当前状态：他在这一章右臂重伤了。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-character-evolution-flow",
      turn_id: "turn-agent-character-evolution-flow"
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :character_evolution_with_context,
        input,
        context(),
        %Execution{complete_fn: complete_fn}
      )

    assert planned.run_attrs.profile_ref == CharacterEvolutionWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :step_proposed, context_step}
    assert context_step.summary =~ "组装角色演化上下文"
    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "角色演化上下文"
    assert_receive {:agent_event, :observation_recorded, context_observation}, 500
    assert context_observation.summary =~ "已组装角色演化上下文"
    assert_receive {:agent_event, :plan_created, context_decision}, 500
    assert "agent_next_step_decided" in context_decision.reason_codes

    assert_receive {:agent_event, :step_proposed, evolution_step}, 500
    assert evolution_step.summary =~ "制定角色演化执行策略"
    assert_receive {:agent_event, :plan_created, plan_event}, 500
    assert plan_event.summary =~ "已根据观察制定下一步计划"
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "角色演化能力"
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "当前 AgentStep"
    assert provider_prompt =~ "角色演化"
    assert provider_prompt =~ "林烬"
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "角色演化记忆草稿已生成"
    assert_receive {:agent_event, :observation_recorded, tool_observation}, 500
    assert tool_observation.summary =~ "待采纳角色演化记忆草稿"

    assert_receive {:agent_event, :observation_recorded, artifact_observation}, 500
    assert artifact_observation.summary =~ "角色演化记忆草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :step_proposed, final_step}, 500
    assert final_step.summary =~ "确认角色演化目标"
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
    assert turn_result.agent_run.profile_ref == "character_evolution_with_context_v1"
    assert turn_result.tool_result.tool_name == "character_evolution"
    assert turn_result.tool_result.output.artifact_type == :character_evolution_seed
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false
    refute Map.has_key?(turn_result, :quality_review)

    assert [%{adoption_status: :tentative, artifact_type: :character_evolution_seed} = pending] =
             turn_result.adoption_state.pending

    [item] = pending.payload.items
    assert item.memory_subtype == "CURRENT_STATE"

    assert turn_result.trace_summary.writer_provider_call_ref ==
             "pc-agent-character-evolution-writer"

    assert turn_result.trace_summary.provider_call_budget.writer == 1
    assert turn_result.trace_summary.provider_call_budget.evaluator == 0
  end

  defp next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        %{
          "decision_type" => "goal_satisfied",
          "summary" => "已生成待采纳角色演化候选，本轮目标已经满足。",
          "target_tool_ref" => nil,
          "write_intent" => "none",
          "risk_hint" => "low",
          "reason_codes" => ["goal_satisfied"],
          "confidence" => 1.0
        }

      String.contains?(prompt, "character_evolution_context /") ->
        %{
          "decision_type" => "execute_step",
          "summary" => "基于已读取的角色上下文生成角色演化草稿。",
          "target_tool_ref" => "character_evolution",
          "write_intent" => "tentative",
          "risk_hint" => "low",
          "reason_codes" => ["agentic_next_step", "character_evolution_context_consumed"],
          "confidence" => 1.0
        }

      true ->
        %{
          "decision_type" => "execute_step",
          "summary" => "先读取角色演化上下文。",
          "target_tool_ref" => "context_assemble",
          "write_intent" => "none",
          "risk_hint" => "low",
          "reason_codes" => ["agentic_next_step", "missing_character_evolution_context"],
          "confidence" => 1.0
        }
    end
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: [],
      structured_chapters: [
        %{
          title: "第01章：矿区冲突",
          seq: 1,
          summary: "林烬在冲突中为保护同伴受伤。",
          has_prose: true
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end
end
