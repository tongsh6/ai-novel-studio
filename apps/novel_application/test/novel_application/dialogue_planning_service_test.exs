defmodule NovelApplication.DialoguePlanningServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunFlows.ConversationTurn
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
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

  test "普通用户输入直接规划为 bounded conversation AgentRun，不在 run 外调用 provider" do
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
    assert spec.run_attrs.profile_ref == ConversationTurn.profile_ref()
    assert spec.run_attrs.parent_turn_ref == "turn-agent"
    assert spec.run_attrs.goal.text == "聊聊这个故事的创作方向"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "规划结果把 provider execution dependency 交给 conversation profile" do
    provider_execution = %Execution{
      complete_fn: fn prompt ->
        content =
          if agent_next_step_prompt?(prompt) do
            Jason.encode!(conversation_next_step_decision(prompt))
          else
            @conversation_frame_json
          end

        {:ok, %{content: content}}
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

    assert {:execute, context_step, _decision} =
             spec.next_step_planner.(run, 1, %{stage_state: %{}, observations: [], events: []})

    assert {:ok, context_result} =
             context_step.(run, 1, %{stage_state: %{}, observations: [], events: []})

    assert {:execute, frame_step, _decision} =
             spec.next_step_planner.(run, 2, %{
               stage_state: context_result.stage_state,
               observations: context_result.observations,
               events: []
             })

    assert {:ok, frame_result} =
             frame_step.(
               run,
               2,
               %{stage_state: context_result.stage_state}
             )

    assert frame_result.stage_state.frame.frame_type == :casual_reply
  end

  test "复合角色任务直接选择角色 AgentRun profile，但不在 run 外调用 provider" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "先看看现有角色阵容，然后设计一个反派",
                 workspace_id: "ws-character",
                 work_id: "work-character",
                 session_id: "session-character",
                 turn_id: "turn-character"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.run_attrs.profile_ref == "character_design_with_context_v1"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "正文草稿任务直接选择正文质量 AgentRun profile，但不在 run 外调用 provider" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "写下一章",
                 workspace_id: "ws-prose",
                 work_id: "work-prose",
                 session_id: "session-prose",
                 turn_id: "turn-prose"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.run_attrs.profile_ref == "prose_drafting_with_quality_v1"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
    assert spec.run_attrs.budget.max_steps == 4
    assert spec.run_attrs.budget.max_provider_calls == 5

    assert [
             %{milestone_id: "assemble_prose_context"},
             %{milestone_id: "plan_gate_and_draft_prose_with_quality"},
             %{milestone_id: "confirm_prose_goal"}
           ] = spec.run_attrs.plan.milestones
  end

  test "章节大纲规划任务直接选择大纲 AgentRun profile，但不在 run 外调用 provider" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "请基于当前作品规划十二章章节大纲",
                 workspace_id: "ws-outline",
                 work_id: "work-outline",
                 session_id: "session-outline",
                 turn_id: "turn-outline"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.run_attrs.profile_ref == PlotOutlineWithContext.profile_ref()
    assert spec.run_attrs.authority_scope.allowed_tools == ["plot_outline"]
    assert spec.run_attrs.budget.max_steps == 4
    assert spec.run_attrs.budget.max_tool_calls == 2
    assert spec.run_attrs.budget.max_provider_calls == 4
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)

    assert [
             %{milestone_id: "assemble_outline_context"},
             %{milestone_id: "plan_gate_and_generate_outline"},
             %{milestone_id: "confirm_outline_goal"}
           ] = spec.run_attrs.plan.milestones
  end

  test "角色演化任务直接选择角色演化 AgentRun profile，但不在 run 外调用 provider" do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "更新林烬的当前状态：他在这一章右臂重伤了",
                 workspace_id: "ws-evolution",
                 work_id: "work-evolution",
                 session_id: "session-evolution",
                 turn_id: "turn-evolution"
               },
               nil,
               fn _prompt -> flunk("planning must not call provider before AgentRun starts") end
             )

    assert spec.run_attrs.profile_ref == CharacterEvolutionWithContext.profile_ref()
    assert spec.run_attrs.authority_scope.allowed_tools == ["character_evolution"]
    assert spec.run_attrs.budget.max_steps == 4
    assert spec.run_attrs.budget.max_tool_calls == 2
    assert spec.run_attrs.budget.max_provider_calls == 4
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)

    assert [
             %{milestone_id: "assemble_character_evolution_context"},
             %{milestone_id: "plan_gate_and_generate_character_evolution"},
             %{milestone_id: "confirm_character_evolution_goal"}
           ] = spec.run_attrs.plan.milestones
  end

  test "无工具问答也起 conversation AgentRun，不保留同步 TurnResult 回退" do
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

    assert spec.run_attrs.profile_ref == ConversationTurn.profile_ref()
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
    assert spec.run_attrs.budget.max_steps == 4
    assert spec.run_attrs.authority_scope.allowed_tools == ["prose_writing"]
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  defp agent_next_step_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun 下一步规划器")

  defp agent_next_step_prompt?(_prompt), do: false

  defp conversation_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    if String.contains?(observations, "创作上下文") do
      %{
        "decision_type" => "execute_step",
        "summary" => "基于已组装上下文形成对话认知帧。",
        "target_tool_ref" => "dialogue_frame",
        "write_intent" => "none",
        "risk_hint" => "low",
        "reason_codes" => ["agentic_next_step", "conversation_context_consumed"],
        "confidence" => 1.0
      }
    else
      %{
        "decision_type" => "execute_step",
        "summary" => "先组装当前作品的创作上下文。",
        "target_tool_ref" => "context_assemble",
        "write_intent" => "none",
        "risk_hint" => "low",
        "reason_codes" => ["agentic_next_step", "missing_conversation_context"],
        "confidence" => 1.0
      }
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end
end
