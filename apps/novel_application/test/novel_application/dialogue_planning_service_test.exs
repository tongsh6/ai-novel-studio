defmodule NovelApplication.DialoguePlanningServiceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.ConversationTurn
  alias NovelApplication.DialoguePlanningService

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
    assert length(spec.steps) == 4
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
    assert length(spec.steps) == 2
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
    assert length(spec.steps) == 4
    assert spec.run_attrs.budget.max_steps == 4

    assert [
             %{milestone_id: "assemble_prose_context"},
             %{milestone_id: "plan_and_gate"},
             %{milestone_id: "draft_prose_with_quality"},
             %{milestone_id: "finalize"}
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
    assert length(spec.steps) == 2
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
    assert length(spec.steps) == 4
  end
end
