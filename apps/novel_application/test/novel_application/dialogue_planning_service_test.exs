defmodule NovelApplication.DialoguePlanningServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunFlows.ConversationTurn
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AgentRun

  @conversation_frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户发来普通聊天消息",
    "needs_tool": false,
    "no_tool_reason": "no_tool_needed",
    "execution_readiness": "not_applicable",
    "assistant_message": "收到，我们先聊创作方向。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  test "普通用户输入先规划为 bounded profile routing AgentRun，不在 run 外调用 provider" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "聊聊这个故事的创作方向",
                 workspace_id: "ws-agent",
                 work_id: "work-agent",
                 session_id: "session-agent",
                 turn_id: "turn-agent"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.route == :agent_run_start
    assert spec.decision.decision_type == :allow_agent_run
    assert spec.run_attrs.profile_ref == "profile_routing_v1"
    assert spec.run_attrs.authority_scope.allowed_tools == ["profile_route"]
    assert spec.run_attrs.parent_turn_ref == "turn-agent"
    assert spec.run_attrs.goal.text == "聊聊这个故事的创作方向"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "规划结果把 provider execution dependency 交给 conversation profile" do
    provider_execution = %Execution{
      result_fn: fn prompt ->
        result =
          cond do
            profile_route_prompt?(prompt) ->
              Jason.encode!(profile_route_decision(ConversationTurn.profile_ref()))

            plan_draft_prompt?(prompt) ->
              conversation_plan_draft()

            agent_next_step_prompt?(prompt) ->
              NovelApplication.TestAgenticLoopFixtures.reasoning_tail(
                conversation_next_step_decision(prompt)
              )

            true ->
              @conversation_frame_json
          end

        provider_result(result)
      end
    }

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "聊聊这个故事的创作方向",
                 workspace_id: "ws-agent",
                 work_id: "work-agent",
                 session_id: "session-agent",
                 turn_id: "turn-agent"
               },
               nil,
               provider_execution
             )

    assert is_function(spec.next_step_planner, 3)
    {:ok, run} = AgentRun.new(spec.run_attrs)

    assert {:execute, route_step, _route_decision, route_meta} =
             spec.next_step_planner.(run, 1, %{stage_state: %{}, observations: [], events: []})

    assert route_meta.provider_call_count == 1

    assert {:ok, route_result} =
             route_step.(run, 1, %{stage_state: %{}, observations: [], events: []})

    routed_run = apply_run_patch(run, route_result.run_patch)

    assert routed_run.profile_ref == ConversationTurn.profile_ref()
    stage_sink = fn _event -> :ok end

    assert {:ok, context_result} =
             route_result
             |> Map.fetch!(:stage_state)
             |> then(fn stage_state ->
               assert {:execute, context_step, _decision, context_meta} =
                        spec.next_step_planner.(routed_run, 2, %{
                          stage_state: stage_state,
                          observations: route_result.observations,
                          events: [],
                          stage_sink: stage_sink
                        })

               # 计划起草为两段式调用（流式 reasoning + 结构化 tool call）
               assert context_meta.provider_call_count == 2

               context_step.(routed_run, 2, %{
                 stage_state: stage_state,
                 observations: route_result.observations,
                 events: [],
                 stage_sink: stage_sink
               })
             end)

    merged_stage_state = Map.merge(route_result.stage_state, context_result.stage_state)
    routed_run = apply_run_patch(routed_run, context_result.run_patch)

    assert {:execute, frame_step, _decision, frame_meta} =
             spec.next_step_planner.(routed_run, 3, %{
               stage_state: merged_stage_state,
               observations: route_result.observations ++ context_result.observations,
               events: [],
               stage_sink: stage_sink
             })

    assert frame_meta.provider_call_count == 0

    assert {:ok, frame_result} =
             frame_step.(
               routed_run,
               3,
               %{stage_state: merged_stage_state, stage_sink: stage_sink}
             )

    assert frame_result.stage_state.frame.frame_type == :casual_reply
  end

  test "复合角色任务在 AgentRun 内路由到角色 profile" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "先看看现有角色阵容，然后设计一个反派",
          workspace_id: "ws-character",
          work_id: "work-character",
          session_id: "session-character",
          turn_id: "turn-character"
        },
        "character_design_with_context_v1"
      )

    assert routed_run.authority_scope.allowed_tools == ["character_roster", "character_design"]
  end

  test "user_message profile 选择不接受客户端 profile_ref 覆盖" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "随便聊聊今天的创作节奏",
          profile_ref: "prose_drafting_with_quality_v1",
          agent_profile: "character_design_with_context_v1",
          workspace_id: "ws-profile-causal",
          work_id: "work-profile-causal",
          session_id: "session-profile-causal",
          turn_id: "turn-profile-causal"
        },
        ConversationTurn.profile_ref()
      )

    assert routed_run.profile_ref == ConversationTurn.profile_ref()
  end

  test "正文草稿任务在 AgentRun 内路由到正文质量 profile" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "写下一章",
          workspace_id: "ws-prose",
          work_id: "work-prose",
          session_id: "session-prose",
          turn_id: "turn-prose"
        },
        "prose_drafting_with_quality_v1"
      )

    assert routed_run.budget.max_steps == 5
    assert routed_run.budget.max_provider_calls == 8
    assert routed_run.plan.steps == []
  end

  test "正文草稿意图优先于章节计划上下文词" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "请根据已采纳章节计划生成第02章：矿区追击战：主角在废弃矿区遭遇巡检傀儡。正文草稿，保持为待采纳草稿。",
          workspace_id: "ws-prose-from-plan",
          work_id: "work-prose-from-plan",
          session_id: "session-prose-from-plan",
          turn_id: "turn-prose-from-plan"
        },
        "prose_drafting_with_quality_v1"
      )

    assert routed_run.authority_scope.allowed_tools == ["prose_writing"]
  end

  test "章节大纲规划任务在 AgentRun 内路由到大纲 profile" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "请基于当前作品规划十二章章节大纲",
          workspace_id: "ws-outline",
          work_id: "work-outline",
          session_id: "session-outline",
          turn_id: "turn-outline"
        },
        PlotOutlineWithContext.profile_ref()
      )

    assert routed_run.authority_scope.allowed_tools == ["plot_outline"]
    assert routed_run.budget.max_steps == 5
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 8

    assert [
             %{step_id: "assemble_outline_context", kind: :explore},
             %{step_id: "plan_gate_and_generate_outline", kind: :act},
             %{step_id: "confirm_outline_goal", kind: :explore}
           ] = routed_run.plan.steps
  end

  test "角色演化任务在 AgentRun 内路由到角色演化 profile" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "更新林烬的当前状态：他在这一章右臂重伤了",
          workspace_id: "ws-evolution",
          work_id: "work-evolution",
          session_id: "session-evolution",
          turn_id: "turn-evolution"
        },
        CharacterEvolutionWithContext.profile_ref()
      )

    assert routed_run.authority_scope.allowed_tools == ["character_evolution"]
    assert routed_run.budget.max_steps == 5
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 8

    assert [
             %{step_id: "assemble_character_evolution_context", kind: :explore},
             %{step_id: "plan_gate_and_generate_character_evolution", kind: :act},
             %{step_id: "confirm_character_evolution_goal", kind: :explore}
           ] = routed_run.plan.steps
  end

  test "世界设定和伏笔任务在 AgentRun 内路由到世界设定 profile" do
    {_spec, routed_run, _route_result} =
      assert_user_message_routes_to(
        %{
          text: "设计一个跨三卷回收的伏笔线索",
          workspace_id: "ws-world",
          work_id: "work-world",
          session_id: "session-world",
          turn_id: "turn-world"
        },
        WorldBuildingWithContext.profile_ref()
      )

    assert routed_run.authority_scope.allowed_tools == ["world_building"]
    assert routed_run.budget.max_steps == 5
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 8

    assert [
             %{step_id: "assemble_world_building_context", kind: :explore},
             %{step_id: "plan_gate_and_generate_world_building", kind: :act},
             %{step_id: "confirm_world_building_goal", kind: :explore}
           ] = routed_run.plan.steps
  end

  test "无工具问答也先进入 profile routing AgentRun，不保留同步 TurnResult 回退" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "现在写了多少章了，下一章从哪里开始写",
                 workspace_id: "ws-q",
                 work_id: "work-q",
                 session_id: "session-q",
                 turn_id: "turn-q"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.run_attrs.profile_ref == "profile_routing_v1"
    assert spec.run_attrs.authority_scope.allowed_tools == ["profile_route"]
    assert spec.run_attrs.parent_turn_ref == "turn-q"
  end

  test "one-step budget 收窄显式 profile 的 bounded run budget" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看现有角色阵容，然后设计一个反派，最多一步",
          workspace_id: "ws-budget",
          work_id: "work-budget",
          session_id: "session-budget",
          turn_id: "turn-budget"
        },
        nil,
        fn _ -> {:ok, %{content: "[]"}} end
      )

    assert spec.run_attrs.budget.max_steps == 1
    assert spec.run_attrs.budget.max_tool_calls == 1
  end

  test "空文本被拒绝，不走非 agent 回退" do
    assert DialoguePlanningService.agent_run_candidate?("测试") == true
    assert DialoguePlanningService.agent_run_candidate?("") == false
    assert DialoguePlanningService.plan_agent_run(%{text: ""}) == {:error, :empty_text}
  end

  test "run_spec_for_profile 直接为显式 profile 构建 spec（不经判帧）" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "设计一个反派",
          workspace_id: "ws-direct",
          work_id: "work-direct",
          session_id: "session-direct",
          turn_id: "turn-direct"
        },
        nil,
        fn _ -> {:ok, %{content: "[]"}} end
      )

    assert spec.run_attrs.profile_ref == "character_design_with_context_v1"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "修订动作显式 profile 构建 revision AgentRun spec" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        %{
          text: "按质量发现重写正文草稿",
          workspace_id: "ws-revision",
          work_id: "work-revision",
          session_id: "session-revision",
          turn_id: "turn-source",
          source_turn_result: %{},
          action_input: nil
        },
        nil,
        fn _ -> {:ok, %{content: "{}"}} end
      )

    assert spec.run_attrs.profile_ref == "prose_revision_from_findings_v1"
    assert spec.run_attrs.parent_turn_ref == "turn-source"
    assert spec.run_attrs.budget.max_steps == 5
    assert spec.run_attrs.budget.max_provider_calls == 5
    assert spec.run_attrs.authority_scope.allowed_tools == ["prose_writing"]
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  defp assert_user_message_routes_to(input, expected_profile_ref) do
    provider_execution = %Execution{
      result_fn: fn prompt ->
        assert profile_route_prompt?(prompt)
        {:ok, %{content: Jason.encode!(profile_route_decision(expected_profile_ref))}}
      end
    }

    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, nil, provider_execution)
    assert spec.run_attrs.profile_ref == "profile_routing_v1"
    assert spec.run_attrs.authority_scope.allowed_tools == ["profile_route"]
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)

    {:ok, run} = AgentRun.new(spec.run_attrs)

    assert {:execute, route_step, decision, route_meta} =
             spec.next_step_planner.(run, 1, %{stage_state: %{}, observations: [], events: []})

    assert decision.target_tool_ref == "profile_route"
    assert route_meta.provider_call_count == 1

    assert {:ok, route_result} =
             route_step.(run, 1, %{stage_state: %{}, observations: [], events: []})

    routed_run = apply_run_patch(run, route_result.run_patch)
    assert routed_run.profile_ref == expected_profile_ref
    assert routed_run.authority_scope.profile_selection.profile_ref == expected_profile_ref
    assert routed_run.authority_scope.profile_selection.source == "model_profile_router"
    assert "model_profile_selected" in routed_run.authority_scope.profile_selection.reason_codes

    {spec, routed_run, route_result}
  end

  defp apply_run_patch(run, patch) do
    %{
      run
      | profile_ref: Map.get(patch, :profile_ref) || run.profile_ref,
        authority_scope: Map.get(patch, :authority_scope) || run.authority_scope,
        plan: Map.get(patch, :plan) || run.plan,
        plan_ref: Map.get(patch, :plan_ref) || run.plan_ref,
        plan_version: Map.get(patch, :plan_version) || run.plan_version,
        budget: Map.get(patch, :budget) || run.budget
    }
  end

  defp profile_route_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun profile router")

  defp profile_route_prompt?(_prompt), do: false

  defp profile_route_decision(profile_ref) do
    %{
      "profile_ref" => profile_ref,
      "summary" => "模型选择 #{profile_ref} 工作流。",
      "reason_codes" => ["model_profile_selected"],
      "matched_terms" => ["测试"],
      "confidence" => 1.0
    }
  end

  defp agent_next_step_prompt?(prompt),
    do: prompt_contains?(prompt, "AgentRun 下一步规划器")

  defp plan_draft_prompt?(prompt),
    do: prompt_contains?(prompt, "AgentRun 计划起草器")

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern

  defp conversation_plan_draft do
    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result("先组装上下文，再形成对话帧并完成本轮回应。", [
      NovelApplication.TestAgenticLoopFixtures.plan_step(
        "assemble_conversation_context",
        "context_assemble",
        "组装当前作品上下文",
        success_criteria: ["conversation_context_attached"]
      ),
      NovelApplication.TestAgenticLoopFixtures.plan_step(
        "frame_conversation",
        "dialogue_frame",
        "形成对话认知帧",
        success_criteria: ["dialogue_frame_created"]
      ),
      NovelApplication.TestAgenticLoopFixtures.plan_step(
        "gate_conversation_strategy",
        "strategy_gate",
        "制定执行策略并完成系统裁决",
        success_criteria: ["strategy_gate_completed"]
      ),
      NovelApplication.TestAgenticLoopFixtures.plan_step(
        "finalize_conversation_response",
        "response_finalize",
        "生成本轮回应",
        success_criteria: ["turn_result_ready"]
      )
    ])
  end

  defp conversation_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    if String.contains?(observations, "创作上下文") do
      NovelApplication.TestAgenticLoopFixtures.continue_next(
        "基于已组装上下文形成对话认知帧。",
        "dialogue_frame",
        reason_codes: ["agentic_next_step", "conversation_context_consumed"]
      )
    else
      NovelApplication.TestAgenticLoopFixtures.continue_next(
        "先组装当前作品的创作上下文。",
        "context_assemble",
        reason_codes: ["agentic_next_step", "missing_conversation_context"]
      )
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> prompt_text()
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp provider_result(%{content: _content, tool_calls: _tool_calls} = result), do: {:ok, result}
  defp provider_result(content), do: {:ok, %{content: content}}

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
end
