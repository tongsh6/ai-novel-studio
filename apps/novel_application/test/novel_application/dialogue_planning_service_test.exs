defmodule NovelApplication.DialoguePlanningServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.DialoguePlanningService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun

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
    assert spec.run_attrs.profile_ref == "judgment_loop_v1"
    assert spec.run_attrs.authority_scope.allowed_tools == ["judgment"]
    assert spec.run_attrs.parent_turn_ref == "turn-agent"
    assert spec.run_attrs.goal.text == "聊聊这个故事的创作方向"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "判断 reply 内联终结：简单对话恰 2 次调用产出 casual_reply TurnResult" do
    narrative = "你想聊聊创作方向；当前信息足够，我直接回应你。\n\n可以从主角的日常细节切入，先立住人物再展开冲突。"

    provider_execution =
      judgment_execution("reply", nil, narrative: narrative, reply_included: true)

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

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end

    {context_result, judgment_result} = drive_judgment(spec, run, sink)

    # 简单对话 = 判断①两段式恰 2 次调用；无 profile 切换
    assert judgment_result.provider_call_count == 2
    refute Map.get(judgment_result, :run_patch)

    turn_result = judgment_result.turn_result
    assert turn_result.assistant_message.text == narrative
    assert turn_result.frame_summary.frame_type == :casual_reply
    assert turn_result.agent_run.run_id == run.run_id
    assert turn_result.truthfulness.tool_called == false

    # 收束：判断已终结 → 下一迭代 complete（0 调用）
    merged = Map.merge(context_result.stage_state, judgment_result.stage_state)

    assert {:complete, _decision, complete_meta} =
             spec.next_step_planner.(run, 3, %{
               stage_state: merged,
               observations: [],
               events: [],
               stage_sink: sink
             })

    assert complete_meta.provider_call_count == 0
  end

  test "判断 reply 可携带候选方向（S2 候选随判断结构携带）" do
    narrative = "你在比较方向；我给你两个可选切入。\n\n方向一从底层账单切入，方向二从矿区追击切入。"

    provider_execution =
      judgment_execution("reply", nil,
        narrative: narrative,
        reply_included: true,
        candidate_directions: [
          %{"title" => "底层账单切入", "pitch" => "从灵气欠费的日常压迫感开场", "tone_tags" => ["压抑"]},
          %{"title" => "矿区追击切入", "pitch" => "从一场短促追击直接进入冲突", "tone_tags" => ["紧张"]}
        ]
      )

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "我想写赛博修仙方向，给我几个切入候选",
                 workspace_id: "ws-cand",
                 work_id: "work-cand",
                 session_id: "session-cand",
                 turn_id: "turn-cand"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    {_context_result, judgment_result} = drive_judgment(spec, run, sink)

    turn_result = judgment_result.turn_result
    assert turn_result.frame_summary.frame_type == :creative_exploration
    assert [first, second] = turn_result.candidate_directions
    assert first.title == "底层账单切入"
    assert second.title == "矿区追击切入"
    assert first.adoption_status == :not_adopted
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

  test "user_message 判断不接受客户端 profile_ref 覆盖" do
    narrative = "你想随便聊聊；不需要动用创作能力。\n\n今天可以放松节奏，先聊聊你想推进的段落。"

    provider_execution =
      judgment_execution("reply", nil, narrative: narrative, reply_included: true)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "随便聊聊今天的创作节奏",
                 profile_ref: "prose_drafting_with_quality_v1",
                 agent_profile: "character_design_with_context_v1",
                 workspace_id: "ws-profile-causal",
                 work_id: "work-profile-causal",
                 session_id: "session-profile-causal",
                 turn_id: "turn-profile-causal"
               },
               nil,
               provider_execution
             )

    assert spec.run_attrs.profile_ref == "judgment_loop_v1"

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    {_context_result, judgment_result} = drive_judgment(spec, run, sink)

    # 客户端 profile_ref 覆盖被忽略：判断 reply 终结，无 profile 切换
    refute Map.get(judgment_result, :run_patch)
    assert judgment_result.turn_result.assistant_message.text == narrative
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

    assert routed_run.budget.max_steps == 6
    assert routed_run.budget.max_provider_calls == 9
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
    assert routed_run.budget.max_steps == 6
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 9

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
    assert routed_run.budget.max_steps == 6
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 9

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
    assert routed_run.budget.max_steps == 6
    assert routed_run.budget.max_tool_calls == 2
    assert routed_run.budget.max_provider_calls == 9

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

    assert spec.run_attrs.profile_ref == "judgment_loop_v1"
    assert spec.run_attrs.authority_scope.allowed_tools == ["judgment"]
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

  # 判断循环（ADR-0025 CP1）：机械准备（0 调用）→ 判断①两段式（2 调用）→
  # execute/plan 切换到能力 profile（等价旧路由语义）。
  defp assert_user_message_routes_to(input, expected_profile_ref) do
    provider_execution =
      judgment_execution("execute", capability_for_profile_ref(expected_profile_ref))

    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, nil, provider_execution)
    assert spec.run_attrs.profile_ref == "judgment_loop_v1"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    {_context_result, judgment_result} = drive_judgment(spec, run, sink)

    assert judgment_result.provider_call_count == 2

    routed_run = apply_run_patch(run, judgment_result.run_patch)
    assert routed_run.profile_ref == expected_profile_ref
    assert routed_run.authority_scope.profile_selection.profile_ref == expected_profile_ref
    assert routed_run.authority_scope.profile_selection.source == "judgment_loop"
    assert "model_profile_selected" in routed_run.authority_scope.profile_selection.reason_codes

    {spec, routed_run, judgment_result}
  end

  # 驱动判断循环前两步：机械准备 context（0 调用）→ 判断①。
  defp drive_judgment(spec, run, sink) do
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, context_decision, context_meta} =
             spec.next_step_planner.(run, 1, empty)

    assert context_decision.target_tool_ref == "context_assemble"
    assert context_meta.provider_call_count == 0
    assert {:ok, context_result} = context_step.(run, 1, empty)
    assert context_result.provider_call_count == 0

    snapshot = %{
      stage_state: context_result.stage_state,
      observations: context_result.observations,
      events: [],
      stage_sink: sink
    }

    assert {:execute, judgment_step, judgment_decision, judgment_meta} =
             spec.next_step_planner.(run, 2, snapshot)

    assert judgment_decision.target_tool_ref == "judgment"
    assert judgment_meta.provider_call_count == 0
    assert {:ok, judgment_result} = judgment_step.(run, 2, snapshot)

    {context_result, judgment_result}
  end

  defp capability_for_profile_ref("character_design_with_context_v1"), do: "character_design"
  defp capability_for_profile_ref("prose_drafting_with_quality_v1"), do: "prose_writing"
  defp capability_for_profile_ref("plot_outline_with_context_v1"), do: "plot_outline"

  defp capability_for_profile_ref("character_evolution_with_context_v1"),
    do: "character_evolution"

  defp capability_for_profile_ref("world_building_with_context_v1"), do: "world_building"

  # 判断①两段式替身：叙事调用（无 tools）返回 content + provider_output（叙事字节绑定），
  # 结构调用（forced tool）返回 judgment_decision tool call。
  defp judgment_execution(action, capability, opts \\ []) do
    narrative =
      Keyword.get(opts, :narrative, "我理解你的意图，这是一个明确的创作动作，我直接执行。")

    arguments =
      %{
        "action" => action,
        "reason" => "test_judgment",
        "reply_included" => Keyword.get(opts, :reply_included, false)
      }
      |> then(fn args -> if capability, do: Map.put(args, "capability", capability), else: args end)
      |> then(fn args ->
        case Keyword.get(opts, :candidate_directions) do
          directions when is_list(directions) ->
            Map.put(args, "candidate_directions", directions)

          _ ->
            args
        end
      end)

    %Execution{
      result_fn: fn prompt ->
        cond do
          judgment_prompt?(prompt) and NovelAgent.Provider.tool_call_prompt?(prompt) ->
            {:ok,
             %{
               content: "",
               tool_calls: [%{"name" => "judgment_decision", "arguments" => arguments}],
               provider_output: judgment_provider_output("pcall-judgment-decision", "")
             }}

          judgment_prompt?(prompt) ->
            {:ok,
             %{
               content: narrative,
               tool_calls: [],
               provider_output: judgment_provider_output("pcall-judgment-narrative", narrative)
             }}

          true ->
            flunk("unexpected provider call in judgment loop test")
        end
      end
    }
  end

  defp judgment_prompt?(prompt), do: prompt_contains?(prompt, "创作判断器")

  defp judgment_provider_output(call_ref, text) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-judgment",
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: text},
        refs: [call_ref]
      })

    output
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

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
end
