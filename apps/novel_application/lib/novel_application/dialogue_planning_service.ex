defmodule NovelApplication.DialoguePlanningService do
  @moduledoc """
  user_message 入口的 AgentRun 启动边界。

  UA-01 收口后，作者输入不再先走同步 `DialogueGateway` 再按裁决决定是否起 run。
  本服务只负责把非空输入固化为 AgentRun 启动载体（run_attrs + runtime spec），
  后续 frame / plan / decision / tool / reply 都在 AgentRun lifecycle 内发生，并通过
  author-safe agent_event / agent_run_state 投影给 UI。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.CharacterDesignWithContext
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunFlows.ConversationTurn
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.AgentRunFlows.ProseRevisionFromFindings
  alias NovelApplication.AgentRunFlows.ProviderProgress
  alias NovelApplication.AgentRunFlows.ReadonlyBatchContext
  alias NovelApplication.AgentRunSequentialPlanner
  alias NovelDomain.AgentPlan

  @character_allowed_tools ["character_roster", "character_design"]
  @character_profile_ref CharacterDesignWithContext.profile_ref()
  @prose_allowed_tools ["prose_writing"]
  @prose_profile_ref ProseDraftingWithQuality.profile_ref()
  @plot_outline_allowed_tools ["plot_outline"]
  @plot_outline_profile_ref PlotOutlineWithContext.profile_ref()
  @character_evolution_allowed_tools ["character_evolution"]
  @character_evolution_profile_ref CharacterEvolutionWithContext.profile_ref()
  @revision_allowed_tools ["prose_writing"]
  @revision_profile_ref ProseRevisionFromFindings.profile_ref()
  @provider_progress_allowed_tools ["provider_complete"]
  @provider_progress_profile_ref ProviderProgress.profile_ref()
  @readonly_batch_allowed_tools ["readonly_batch"]
  @readonly_batch_profile_ref ReadonlyBatchContext.profile_ref()
  @conversation_allowed_tools NovelApplication.CapabilityRegistry.list()
                              |> Enum.filter(&NovelApplication.CapabilityRegistry.dispatchable?/1)
  @conversation_profile_ref ConversationTurn.profile_ref()
  @explicit_profiles %{
    @character_profile_ref => :character_design_with_context,
    @prose_profile_ref => :prose_drafting_with_quality,
    @plot_outline_profile_ref => :plot_outline_with_context,
    @character_evolution_profile_ref => :character_evolution_with_context,
    @revision_profile_ref => :prose_revision_from_findings,
    @provider_progress_profile_ref => :provider_progress,
    @readonly_batch_profile_ref => :readonly_batch_context,
    @conversation_profile_ref => :conversation_turn,
    character_design_with_context: :character_design_with_context,
    prose_drafting_with_quality: :prose_drafting_with_quality,
    plot_outline_with_context: :plot_outline_with_context,
    character_evolution_with_context: :character_evolution_with_context,
    prose_revision_from_findings: :prose_revision_from_findings,
    provider_progress: :provider_progress,
    readonly_batch_context: :readonly_batch_context,
    conversation_turn: :conversation_turn
  }

  @spec agent_run_candidate?(String.t()) :: boolean()
  def agent_run_candidate?(text) when is_binary(text) do
    String.trim(text) != ""
  end

  def agent_run_candidate?(_), do: false

  @doc """
  user_message 主入口。返回：

    - `{:ok, %{decision: %{decision_type: :allow_agent_run}, run_attrs, next_step_planner, ...}}`：起 bounded run
    - `{:error, reason}`
  """
  @spec plan_agent_run(map(), function() | nil, Execution.dependency()) ::
          {:ok, map()} | {:error, term()}
  def plan_agent_run(
        input,
        context_fetcher \\ nil,
        provider_execution \\ Execution.dependency(purpose: :conversation)
      )

  def plan_agent_run(%{text: text} = input, context_fetcher, provider_execution)
      when is_binary(text) do
    if String.trim(text) == "" do
      {:error, :empty_text}
    else
      {:ok,
       run_spec_for_profile(
         profile_for_input(input),
         Map.put(input, :context_fetcher, context_fetcher),
         nil,
         provider_execution
       )}
    end
  end

  def plan_agent_run(_input, _context_fetcher, _provider_execution),
    do: {:error, :invalid_agent_run_input}

  @typedoc "AgentRun profile；user_message 默认进入 conversation_turn，显式 flow 测试可直建特定 profile。"
  @type profile ::
          :character_design_with_context
          | :prose_drafting_with_quality
          | :plot_outline_with_context
          | :character_evolution_with_context
          | :prose_revision_from_findings
          | :provider_progress
          | :readonly_batch_context
          | :conversation_turn

  @doc """
  为显式 profile 构建 bounded AgentRun 启动 spec（run_attrs + next_step_planner）。

  `build_agent_run/4`（路由命中 allow_agent_run 时）与直接演练某个 flow 的 flow/runtime 测试共用，
  使测试无需经过 AI 判帧即可演练某一 profile 的运行时。
  """
  @spec run_spec_for_profile(profile(), map(), term(), Execution.dependency()) :: map()
  def run_spec_for_profile(
        profile,
        input,
        context,
        provider_execution \\ Execution.dependency(purpose: :conversation)
      ) do
    ws_id = Map.get(input, :workspace_id, "default")
    work_id = Map.get(input, :work_id) || ws_id
    turn_id = Map.get(input, :turn_id) || Map.get(input, "turn_id") || allocate_turn_id()

    session_id =
      Map.get(input, :session_id) || Map.get(input, "session_id") || "session_#{turn_id}"

    origin_frame_ref = Map.get(input, :origin_frame_ref) || "frame_#{turn_id}"
    text = Map.fetch!(input, :text)
    run_mode = run_mode_for_input(input)

    run_id = "run_#{System.unique_integer([:positive, :monotonic])}"
    {:ok, agent_plan} = agent_run_agent_plan(run_id, profile)

    attrs =
      run_attrs(%{
        run_id: run_id,
        workspace_id: ws_id,
        work_id: work_id,
        session_id: session_id,
        turn_id: turn_id,
        origin_frame_ref: origin_frame_ref,
        agent_plan: agent_plan,
        text: text,
        profile: profile,
        run_mode: run_mode,
        input: input
      })

    %{
      route: :agent_run_start,
      run_id: run_id,
      run_attrs: attrs,
      next_step_planner:
        agent_next_step_planner(profile, text, context, nil, provider_execution, input),
      context: context,
      decision: %{decision_type: :allow_agent_run}
    }
  end

  defp allocate_turn_id, do: "turn_#{System.unique_integer([:positive, :monotonic])}"

  # ── profile 选择只决定 AgentRun runtime 形态，不执行 provider / DialogueGateway 主链 ──

  defp profile_for_input(input) do
    text = input |> map_get(:text) |> normalize_text()

    cond do
      explicit_profile(input) != nil ->
        explicit_profile(input)

      readonly_batch_request?(text) ->
        :readonly_batch_context

      provider_progress_request?(text) ->
        :provider_progress

      character_evolution_request?(text) ->
        :character_evolution_with_context

      character_context_design_request?(text) ->
        :character_design_with_context

      plot_outline_request?(text) ->
        :plot_outline_with_context

      prose_drafting_request?(text) ->
        :prose_drafting_with_quality

      true ->
        :conversation_turn
    end
  end

  defp explicit_profile(input) do
    @explicit_profiles[map_get(input, :profile_ref) || map_get(input, :agent_profile)]
  end

  defp character_context_design_request?(text) do
    contains_any?(text, ["角色阵容", "现有角色", "已有角色"]) and
      contains_any?(text, ["设计", "创建", "新增", "生成"]) and
      contains_any?(text, ["角色", "反派", "人物"])
  end

  defp prose_drafting_request?(text) do
    not contains_any?(text, ["不写正文", "不生成正文", "不写章节"]) and
      (contains_any?(text, ["正文草稿", "写下一章", "续写"]) or
         (contains_any?(text, ["生成", "撰写", "写"]) and contains_any?(text, ["正文", "章节"])))
  end

  defp agent_run_agent_plan(run_id, :character_design_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "inspect_roster",
          summary: "读取当前角色阵容",
          success_criteria: ["character_roster_observation_exists"]
        },
        %{
          milestone_id: "design_character",
          summary: "基于角色阵容设计新的主要反派",
          success_criteria: ["tentative_character_seed_exists"]
        },
        %{
          milestone_id: "finalize",
          summary: "汇总结果给作者",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :prose_drafting_with_quality) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "assemble_prose_context",
          summary: "组装正文写作上下文",
          success_criteria: ["dialogue_context_attached"]
        },
        %{
          milestone_id: "plan_gate_and_draft_prose_with_quality",
          summary: "根据观察制定下一步计划、完成裁决并生成正文草稿和质量复核",
          success_criteria: ["tentative_prose_fragment_exists", "quality_review_exists"]
        },
        %{
          milestone_id: "confirm_prose_goal",
          summary: "确认正文草稿目标已满足",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :plot_outline_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "assemble_outline_context",
          summary: "组装章节大纲规划上下文",
          success_criteria: ["dialogue_context_attached"]
        },
        %{
          milestone_id: "plan_gate_and_generate_outline",
          summary: "制定大纲执行策略、完成授权判断并生成草稿",
          success_criteria: ["outline_micro_plan_exists", "allow_tool_decision_exists"]
        },
        %{
          milestone_id: "confirm_outline_goal",
          summary: "确认大纲目标已满足并汇总给作者",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :character_evolution_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "assemble_character_evolution_context",
          summary: "组装角色演化上下文",
          success_criteria: ["dialogue_context_attached"]
        },
        %{
          milestone_id: "plan_gate_and_generate_character_evolution",
          summary: "制定角色演化执行策略、完成授权判断并生成草稿",
          success_criteria: [
            "character_evolution_micro_plan_exists",
            "allow_tool_decision_exists"
          ]
        },
        %{
          milestone_id: "confirm_character_evolution_goal",
          summary: "确认角色演化目标已满足并汇总给作者",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :prose_revision_from_findings) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "load_revision_source",
          summary: "读取待修订草稿和质量发现",
          success_criteria: ["revision_source_loaded"]
        },
        %{
          milestone_id: "plan_and_gate_revision",
          summary: "制定修订执行策略并完成授权判断",
          success_criteria: ["revision_micro_plan_exists", "allow_tool_decision_exists"]
        },
        %{
          milestone_id: "generate_revision",
          summary: "生成修订候选草稿",
          success_criteria: ["tentative_revision_fragment_exists"]
        },
        %{
          milestone_id: "finalize_revision",
          summary: "汇总修订候选给作者",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :provider_progress) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "provider_progress",
          summary: "调用 provider 并展示安全进度",
          success_criteria: ["provider_progress_events_visible"]
        },
        %{
          milestone_id: "finalize",
          summary: "汇总 provider 进度结果",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :readonly_batch_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "readonly_batch_read",
          summary: "并行读取只读上下文",
          success_criteria: ["readonly_batch_observations_exist"]
        },
        %{
          milestone_id: "readonly_batch_finalize",
          summary: "汇总只读上下文",
          success_criteria: ["readonly_batch_turn_result_emitted"]
        }
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :conversation_turn) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      milestones: [
        %{
          milestone_id: "assemble_context",
          summary: "组装创作上下文",
          success_criteria: ["dialogue_context_attached"]
        },
        %{
          milestone_id: "form_frame",
          summary: "形成对话认知帧",
          success_criteria: ["dialogue_frame_validated"]
        },
        %{
          milestone_id: "plan_and_gate",
          summary: "制定执行策略并完成授权判断",
          success_criteria: ["planner_or_reply_route_decided"]
        },
        %{
          milestone_id: "finalize_turn",
          summary: "生成本轮回应并写入可回放留痕",
          success_criteria: ["turn_result_emitted"]
        }
      ]
    })
  end

  defp run_attrs(%{
         run_id: run_id,
         workspace_id: ws_id,
         work_id: work_id,
         session_id: session_id,
         turn_id: turn_id,
         origin_frame_ref: origin_frame_ref,
         agent_plan: agent_plan,
         text: text,
         profile: profile,
         run_mode: run_mode,
         input: input
       }) do
    %{
      run_id: run_id,
      run_mode: run_mode,
      workspace_id: ws_id,
      work_id: work_id,
      session_id: session_id,
      parent_turn_ref: turn_id,
      origin_frame_ref: origin_frame_ref,
      profile_ref: profile_ref(profile),
      plan: agent_plan,
      plan_ref: agent_plan.plan_id,
      plan_version: agent_plan.version,
      goal: %{text: text, version: 1},
      authority_scope: %{production_write: false, allowed_tools: allowed_tools(profile)},
      budget: run_budget(text, profile, input)
    }
  end

  defp run_mode_for_input(input) do
    explicit = map_get(input, :run_mode)

    cond do
      explicit in [:durable, "durable"] ->
        :durable

      explicit in [:bounded, "bounded"] ->
        :bounded

      durable_request?(map_get(input, :text)) ->
        :durable

      true ->
        :bounded
    end
  end

  defp agent_steps(
         :prose_revision_from_findings,
         _text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    ProseRevisionFromFindings.steps(%{
      provider_execution: provider_execution,
      source_turn_result: map_get(input, :source_turn_result),
      action_input: map_get(input, :action_input)
    })
  end

  defp agent_steps(
         :provider_progress,
         text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    ProviderProgress.steps(%{
      text: text,
      provider_execution: provider_execution,
      provider_capabilities_fn: map_get(input, :provider_capabilities_fn)
    })
  end

  defp agent_steps(
         :readonly_batch_context,
         _text,
         _context,
         _context_fetcher,
         _provider_execution,
         input
       ) do
    ReadonlyBatchContext.steps(%{
      readers: map_get(input, :readonly_readers)
    })
  end

  defp prose_drafting_next_step_planner(context, context_fetcher, provider_execution, input) do
    ProseDraftingWithQuality.next_step_planner(%{
      context: context,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      quality_provider_execution: map_get(input, :quality_provider_execution),
      chapter_prose_reader: map_get(input, :chapter_prose_reader),
      chapter_summary_reader: map_get(input, :chapter_summary_reader),
      character_reader: map_get(input, :character_reader)
    })
  end

  defp agent_next_step_planner(
         :character_design_with_context,
         _text,
         context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    CharacterDesignWithContext.next_step_planner(%{
      context: context,
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      character_reader: map_get(input, :character_reader)
    })
  end

  defp agent_next_step_planner(
         :prose_drafting_with_quality,
         _text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    prose_drafting_next_step_planner(context, context_fetcher, provider_execution, input)
  end

  defp agent_next_step_planner(
         :plot_outline_with_context,
         _text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    PlotOutlineWithContext.next_step_planner(%{
      context: context,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      chapter_prose_reader: map_get(input, :chapter_prose_reader),
      chapter_summary_reader: map_get(input, :chapter_summary_reader),
      character_reader: map_get(input, :character_reader)
    })
  end

  defp agent_next_step_planner(
         :character_evolution_with_context,
         _text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    CharacterEvolutionWithContext.next_step_planner(%{
      context: context,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      chapter_prose_reader: map_get(input, :chapter_prose_reader),
      chapter_summary_reader: map_get(input, :chapter_summary_reader),
      character_reader: map_get(input, :character_reader)
    })
  end

  defp agent_next_step_planner(
         :prose_revision_from_findings,
         text,
         context,
         context_fetcher,
         provider_execution,
         input
       ),
       do:
         fixed_step_profile_planner(
           :prose_revision_from_findings,
           text,
           context,
           context_fetcher,
           provider_execution,
           input
         )

  defp agent_next_step_planner(
         :provider_progress,
         text,
         context,
         context_fetcher,
         provider_execution,
         input
       ),
       do:
         fixed_step_profile_planner(
           :provider_progress,
           text,
           context,
           context_fetcher,
           provider_execution,
           input
         )

  defp agent_next_step_planner(
         :readonly_batch_context,
         text,
         context,
         context_fetcher,
         provider_execution,
         input
       ),
       do:
         fixed_step_profile_planner(
           :readonly_batch_context,
           text,
           context,
           context_fetcher,
           provider_execution,
           input
         )

  defp agent_next_step_planner(
         :conversation_turn,
         _text,
         _context,
         context_fetcher,
         provider_execution,
         input
       ) do
    ConversationTurn.next_step_planner(%{
      input: input,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      trace_persister: map_get(input, :trace_persister),
      memory_recorder: map_get(input, :memory_recorder)
    })
  end

  defp agent_next_step_planner(
         _profile,
         _text,
         _context,
         _context_fetcher,
         _provider_execution,
         _input
       ),
       do: nil

  defp fixed_step_profile_planner(
         profile,
         text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    profile
    |> agent_steps(text, context, context_fetcher, provider_execution, input)
    |> AgentRunSequentialPlanner.from_steps()
  end

  defp run_budget(text, profile, input) do
    case profile do
      :conversation_turn ->
        conversation_turn_budget(input)

      _ ->
        run_budget(text, profile)
    end
  end

  defp run_budget(text, :character_design_with_context) do
    if one_step_budget?(text) do
      %{max_steps: 1, max_tool_calls: 1, max_provider_calls: 1, max_replans: 1}
    else
      %{max_steps: 4, max_tool_calls: 4, max_provider_calls: 4, max_replans: 1}
    end
  end

  defp run_budget(text, :prose_drafting_with_quality) do
    if one_step_budget?(text) do
      %{max_steps: 1, max_tool_calls: 1, max_provider_calls: 2, max_replans: 1}
    else
      %{max_steps: 4, max_tool_calls: 2, max_provider_calls: 5, max_replans: 1}
    end
  end

  defp run_budget(text, :plot_outline_with_context) do
    if one_step_budget?(text) do
      %{max_steps: 1, max_tool_calls: 1, max_provider_calls: 1, max_replans: 1}
    else
      %{max_steps: 4, max_tool_calls: 2, max_provider_calls: 4, max_replans: 1}
    end
  end

  defp run_budget(text, :character_evolution_with_context) do
    if one_step_budget?(text) do
      %{max_steps: 1, max_tool_calls: 1, max_provider_calls: 1, max_replans: 1}
    else
      %{max_steps: 4, max_tool_calls: 2, max_provider_calls: 4, max_replans: 1}
    end
  end

  defp run_budget(text, :prose_revision_from_findings) do
    if one_step_budget?(text) do
      %{max_steps: 1, max_tool_calls: 1, max_provider_calls: 1, max_replans: 1}
    else
      %{max_steps: 4, max_tool_calls: 2, max_provider_calls: 2, max_replans: 1}
    end
  end

  defp run_budget(_text, :provider_progress) do
    %{max_steps: 2, max_tool_calls: 1, max_provider_calls: 1, max_replans: 1}
  end

  defp run_budget(_text, :readonly_batch_context) do
    %{max_steps: 3, max_tool_calls: 5, max_provider_calls: 1, max_replans: 1}
  end

  defp run_budget(_text, :conversation_turn) do
    conversation_turn_budget(%{})
  end

  defp conversation_turn_budget(input) do
    if map_get(input, :generate_micro_plan) in [true, "true"] do
      %{max_steps: 5, max_tool_calls: 4, max_provider_calls: 8, max_replans: 1}
    else
      %{max_steps: 5, max_tool_calls: 4, max_provider_calls: 6, max_replans: 1}
    end
  end

  defp profile_ref(:character_design_with_context), do: @character_profile_ref
  defp profile_ref(:prose_drafting_with_quality), do: @prose_profile_ref
  defp profile_ref(:plot_outline_with_context), do: @plot_outline_profile_ref
  defp profile_ref(:character_evolution_with_context), do: @character_evolution_profile_ref
  defp profile_ref(:prose_revision_from_findings), do: @revision_profile_ref
  defp profile_ref(:provider_progress), do: @provider_progress_profile_ref
  defp profile_ref(:readonly_batch_context), do: @readonly_batch_profile_ref
  defp profile_ref(:conversation_turn), do: @conversation_profile_ref

  defp allowed_tools(:character_design_with_context), do: @character_allowed_tools
  defp allowed_tools(:prose_drafting_with_quality), do: @prose_allowed_tools
  defp allowed_tools(:plot_outline_with_context), do: @plot_outline_allowed_tools
  defp allowed_tools(:character_evolution_with_context), do: @character_evolution_allowed_tools
  defp allowed_tools(:prose_revision_from_findings), do: @revision_allowed_tools
  defp allowed_tools(:provider_progress), do: @provider_progress_allowed_tools
  defp allowed_tools(:readonly_batch_context), do: @readonly_batch_allowed_tools
  defp allowed_tools(:conversation_turn), do: @conversation_allowed_tools

  defp one_step_budget?(text) do
    normalized = normalize_text(text)

    contains_any?(normalized, [
      "最多一步",
      "只执行一步",
      "预算一步",
      "仅执行一步",
      "最多 1 步",
      "只执行 1 步",
      "max one step",
      "one step only"
    ])
  end

  defp durable_request?(text) do
    text
    |> normalize_text()
    |> contains_any?([
      "长任务",
      "可恢复",
      "断点续跑",
      "断点恢复",
      "重启后恢复",
      "后台执行",
      "持久运行",
      "durable",
      "resume after reconnect"
    ])
  end

  defp provider_progress_request?(text) do
    contains_any?(text, [
      "provider 进度",
      "模型进度",
      "流式进度",
      "流式事件",
      "取消边界",
      "协作取消",
      "provider progress",
      "streaming progress",
      "UA01CP6SLOW"
    ])
  end

  defp readonly_batch_request?(text) do
    contains_any?(text, ["只读批量", "批量读取", "批量查看", "read-only batch", "readonly batch"]) and
      contains_any?(text, ["上下文", "档案", "角色", "规则", "作品"])
  end

  defp plot_outline_request?(text) do
    contains_any?(text, [
      "章节大纲",
      "章节计划",
      "分章大纲",
      "卷章结构",
      "卷章规划",
      "章纲",
      "plot outline",
      "outline"
    ]) and
      contains_any?(text, [
        "规划",
        "计划",
        "生成",
        "制定",
        "设计",
        "创建",
        "列出",
        "补全",
        "续写",
        "扩展",
        "接着"
      ])
  end

  defp character_evolution_request?(text) do
    contains_any?(text, [
      "角色演化",
      "角色成长",
      "角色状态",
      "当前状态",
      "关系变化",
      "角色关系",
      "人物关系",
      "character evolution",
      "黑化",
      "结盟",
      "反目",
      "受伤",
      "失踪",
      "身份暴露"
    ]) and
      contains_any?(text, [
        "更新",
        "记录",
        "推进",
        "变化",
        "变成",
        "改为",
        "写入",
        "整理",
        "补充",
        "记一下",
        "演化",
        "黑化",
        "结盟",
        "反目",
        "受伤",
        "失踪",
        "暴露"
      ])
  end

  defp context_fetcher_or_default(nil), do: fn _ -> {:ok, nil, nil, nil, nil} end
  defp context_fetcher_or_default(fetcher) when is_function(fetcher), do: fetcher

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp contains_any?(text, needles), do: Enum.any?(needles, &String.contains?(text, &1))

  defp normalize_text(text) when is_binary(text), do: String.downcase(text)
  defp normalize_text(_), do: ""
end
