defmodule NovelApplication.AgentRunCharacterEvolutionFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-character-evolution-flow"

  test "bounded character evolution run uses a model-drafted plan before context and character evolution execution" do
    parent = self()

    result_fn = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok,
           Map.put(
             character_evolution_plan_draft(),
             :provider_call_id,
             "pc-agent-character-evolution-planner"
           )}

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        true ->
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
        %Execution{result_fn: result_fn}
      )

    assert planned.run_attrs.profile_ref == CharacterEvolutionWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    # CP2b：机械步序不发 plan_drafted（付费伪计划已消灭），
    # 无计划 run 的轨道 = judgment 事件链。

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "角色演化上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装角色演化上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert plan_event.payload.target_tool_ref == "character_evolution"
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
    assert_receive {:agent_event, :exploration_observed, tool_observation}, 500
    assert tool_observation.summary =~ "待采纳角色演化记忆草稿"

    assert_receive {:agent_event, :exploration_observed, artifact_observation}, 500
    assert artifact_observation.summary =~ "角色演化记忆草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, evolution_decision}, 500
    assert evolution_decision.payload.loop_decision_type == :goal_satisfied
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    # CP2b：机械计划 0 调用，仅 writer 1 调用。
    assert state.run.consumed_budget.provider_calls == 1
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

  defp plan_draft_prompt?(prompt), do: prompt_contains?(prompt, "AgentRun 计划起草器")

  defp character_evolution_plan_draft do
    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取角色演化上下文，再生成角色演化记忆草稿。",
      [
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "context_assemble",
          "context_assemble",
          "先读取角色演化上下文。",
          success_criteria: ["character_evolution_context_observation_created"]
        ),
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "character_evolution",
          "character_evolution",
          "基于已读取的角色上下文生成角色演化记忆草稿。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["tentative_character_evolution_seed_created"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "character_evolution_plan_drafted"]
    )
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳角色演化候选，本轮目标已经满足。")

      String.contains?(prompt, "character_evolution_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的角色上下文生成角色演化草稿。",
          "character_evolution",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "character_evolution_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取角色演化上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_character_evolution_context"]
        )
    end
  end

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern
  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)

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
