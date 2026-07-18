defmodule NovelApplication.AgentRunWorldBuildingFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext

  @work "work-agent-world-flow"

  test "bounded world building run uses a model-drafted plan before context and world building execution" do
    parent = self()

    result_fn = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok, Map.put(world_building_plan_draft(), :provider_call_id, "pc-agent-world-planner")}

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
             provider_call_id: "pc-agent-world-writer",
             content:
               Jason.encode!([
                 %{
                   "item_id" => "foreshadowing-star-bridge",
                   "title" => "星桥旧账",
                   "body" => "一条跨三卷回收的伏笔线索，先以商队账册出现，后续牵出星桥封锁真相。",
                   "rationale" => "让世界设定、角色债务和后续悬念共享同一条因果线。"
                 }
               ])
           }}
      end
    end

    input = %{
      text: "请设计一个跨三卷回收的伏笔线索。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-world-flow",
      turn_id: "turn-agent-world-flow"
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :world_building_with_context,
        input,
        context(),
        %Execution{result_fn: result_fn}
      )

    assert planned.run_attrs.profile_ref == WorldBuildingWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    # CP2b：机械步序不发 plan_drafted（付费伪计划已消灭），
    # 无计划 run 的轨道 = judgment 事件链。

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "世界设定上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装世界设定上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert plan_event.payload.target_tool_ref == "world_building"
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "世界设定能力"
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "当前 AgentStep"
    assert provider_prompt =~ "伏笔"
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "世界设定草稿已生成"
    assert_receive {:agent_event, :exploration_observed, tool_observation}, 500
    assert tool_observation.summary =~ "待采纳世界设定候选"

    assert_receive {:agent_event, :exploration_observed, artifact_observation}, 500
    assert artifact_observation.summary =~ "世界设定草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, world_decision}, 500
    assert world_decision.payload.loop_decision_type == :goal_satisfied
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
    assert turn_result.agent_run.profile_ref == "world_building_with_context_v1"
    assert turn_result.tool_result.tool_name == "world_building"
    assert turn_result.tool_result.output.artifact_type == :foreshadowing_seed
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false

    assert [%{adoption_status: :tentative, artifact_type: :foreshadowing_seed}] =
             turn_result.adoption_state.pending

    assert turn_result.trace_summary.writer_provider_call_ref == "pc-agent-world-writer"
    assert turn_result.trace_summary.provider_call_budget.writer == 1
  end

  test "bounded world building run keeps writing rule artifact type through the same loop" do
    parent = self()

    result_fn = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok,
           Map.put(
             world_building_plan_draft(),
             :provider_call_id,
             "pc-agent-world-style-rule-planner"
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
             provider_call_id: "pc-agent-world-style-rule-writer",
             content:
               Jason.encode!([
                 %{
                   "item_id" => "style-rule-cold-clue",
                   "title" => "风格规则：冷线索优先",
                   "body" => "风格规则：后续创作先呈现可验证线索，再解释情绪判断。\n适用文本范围：悬疑推进段落。\n禁止事项：不得直接替角色下结论。",
                   "rationale" => "让后续写作保持冷峻、可追踪的叙事质感。"
                 }
               ])
           }}
      end
    end

    input = %{
      text: "请制定一条后续创作必须遵守的写作规则和文风约束。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-world-style-rule-flow",
      turn_id: "turn-agent-world-style-rule-flow"
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :world_building_with_context,
        input,
        context(),
        %Execution{result_fn: result_fn}
      )

    assert planned.run_attrs.profile_ref == WorldBuildingWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    artifact_event = receive_agent_event(:artifact_created)
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "artifact_type：style_rule_seed"
    assert provider_prompt =~ "写作规则"
    receive_agent_event(:run_completed)

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    # CP2b：机械计划 0 调用，仅 writer 1 调用。
    assert state.run.consumed_budget.provider_calls == 1

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "world_building_with_context_v1"
    assert turn_result.tool_result.tool_name == "world_building"
    assert turn_result.tool_result.output.artifact_type == :style_rule_seed
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false

    assert [%{adoption_status: :tentative, artifact_type: :style_rule_seed}] =
             turn_result.adoption_state.pending

    assert turn_result.trace_summary.writer_provider_call_ref ==
             "pc-agent-world-style-rule-writer"
  end

  defp plan_draft_prompt?(prompt), do: prompt_contains?(prompt, "AgentRun 计划起草器")

  defp world_building_plan_draft do
    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取世界设定上下文，再生成世界设定、伏笔或规则草稿。",
      [
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "context_assemble",
          "context_assemble",
          "先读取世界设定上下文。",
          success_criteria: ["world_building_context_observation_created"]
        ),
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "world_building",
          "world_building",
          "基于已读取的世界设定上下文生成世界设定、伏笔或规则草稿。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["tentative_world_building_seed_created"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "world_building_plan_drafted"]
    )
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳世界设定候选，本轮目标已经满足。")

      String.contains?(prompt, "已组装世界设定上下文") or
          String.contains?(prompt, "stage_state_keys: context") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的作品设定上下文生成世界设定草稿。",
          "world_building",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "world_building_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取作品设定上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_world_building_context"]
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
          title: "第00章：星桥旧账",
          seq: 0,
          summary: "主角所在商队持有一份来源不明的星桥账册。",
          has_prose: false
        }
      ],
      context_refs: [
        %ContextSourceRef{
          context_ref: "world-setting-star-bridge",
          source_type: :current_work,
          source_id: "world-setting-star-bridge",
          summary: "星桥被帝国封锁，普通商队只能通过灰市航线绕行。"
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp receive_agent_event(type, timeout \\ 1_000) do
    receive do
      {:agent_event, ^type, event} ->
        event

      {:agent_event, _other_type, _event} ->
        receive_agent_event(type, timeout)
    after
      timeout -> flunk("expected #{inspect(type)} agent event")
    end
  end
end
