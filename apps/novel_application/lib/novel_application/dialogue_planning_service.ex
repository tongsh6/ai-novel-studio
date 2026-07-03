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
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentPlan}

  @profile_routing_allowed_tools ["profile_route"]
  @profile_routing_profile_ref "profile_routing_v1"
  @character_allowed_tools ["character_roster", "character_design"]
  @character_profile_ref CharacterDesignWithContext.profile_ref()
  @prose_allowed_tools ["prose_writing"]
  @prose_profile_ref ProseDraftingWithQuality.profile_ref()
  @plot_outline_allowed_tools ["plot_outline"]
  @plot_outline_profile_ref PlotOutlineWithContext.profile_ref()
  @character_evolution_allowed_tools ["character_evolution"]
  @character_evolution_profile_ref CharacterEvolutionWithContext.profile_ref()
  @world_building_allowed_tools ["world_building"]
  @world_building_profile_ref WorldBuildingWithContext.profile_ref()
  @revision_allowed_tools ["prose_writing"]
  @revision_profile_ref ProseRevisionFromFindings.profile_ref()
  @provider_progress_allowed_tools ["provider_complete"]
  @provider_progress_profile_ref ProviderProgress.profile_ref()
  @readonly_batch_allowed_tools ["readonly_batch"]
  @readonly_batch_profile_ref ReadonlyBatchContext.profile_ref()
  @conversation_allowed_tools NovelApplication.CapabilityRegistry.list()
                              |> Enum.filter(&NovelApplication.CapabilityRegistry.dispatchable?/1)
  @conversation_profile_ref ConversationTurn.profile_ref()

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
         :profile_routing,
         input
         |> Map.put(:context_fetcher, context_fetcher),
         nil,
         provider_execution
       )}
    end
  end

  def plan_agent_run(_input, _context_fetcher, _provider_execution),
    do: {:error, :invalid_agent_run_input}

  @typedoc "AgentRun profile；user_message 默认进入 conversation_turn，显式 flow 测试可直建特定 profile。"
  @type profile ::
          :profile_routing
          | :character_design_with_context
          | :prose_drafting_with_quality
          | :plot_outline_with_context
          | :character_evolution_with_context
          | :world_building_with_context
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

    run_id = NovelFoundation.ID.unique("run")
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

  defp allocate_turn_id, do: NovelFoundation.ID.unique("turn")

  # ── profile 选择在 AgentRun 内作为第一轮模型裁决发生；这里不再用关键词预先裁决 ──

  defp agent_run_agent_plan(run_id, :profile_routing) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("route_profile", :explore, "读取作者输入并由模型选择本轮工作流", [
          "profile_routed"
        ]),
        plan_step("continue_selected_profile", :explore, "进入被选择的 AgentRun profile", [
          "selected_profile_plan_attached"
        ])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :character_design_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("inspect_roster", :explore, "读取当前角色阵容", [
          "character_roster_observation_exists"
        ]),
        plan_step("design_character", :act, "基于角色阵容设计新的主要反派", [
          "tentative_character_seed_exists"
        ]),
        plan_step("finalize", :explore, "汇总结果给作者", ["turn_result_emitted"])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :prose_drafting_with_quality) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("assemble_prose_context", :explore, "planner 可按观察读取正文写作上下文", [
          "dialogue_context_attached"
        ]),
        plan_step(
          "plan_gate_and_draft_prose_with_quality",
          :act,
          "planner 可选择 prose_writing，并重新经过 Orchestrator 后生成正文草稿和质量复核",
          ["tentative_prose_fragment_exists", "quality_review_exists"]
        ),
        plan_step("confirm_prose_goal", :explore, "由 goal_satisfied 或 awaiting_author 裁决收束", [
          "turn_result_emitted"
        ])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :plot_outline_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("assemble_outline_context", :explore, "planner 可按观察读取章节大纲规划上下文", [
          "dialogue_context_attached"
        ]),
        plan_step(
          "plan_gate_and_generate_outline",
          :act,
          "planner 可选择 plot_outline，并重新经过 Orchestrator 后生成草稿",
          ["outline_micro_plan_exists", "allow_tool_decision_exists"]
        ),
        plan_step("confirm_outline_goal", :explore, "由 goal_satisfied 或 awaiting_author 裁决收束", [
          "turn_result_emitted"
        ])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :character_evolution_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step(
          "assemble_character_evolution_context",
          :explore,
          "planner 可按观察读取角色演化上下文",
          ["dialogue_context_attached"]
        ),
        plan_step(
          "plan_gate_and_generate_character_evolution",
          :act,
          "planner 可选择 character_evolution，并重新经过 Orchestrator 后生成草稿",
          ["character_evolution_micro_plan_exists", "allow_tool_decision_exists"]
        ),
        plan_step(
          "confirm_character_evolution_goal",
          :explore,
          "由 goal_satisfied 或 awaiting_author 裁决收束",
          ["turn_result_emitted"]
        )
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :world_building_with_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step(
          "assemble_world_building_context",
          :explore,
          "planner 可按观察读取世界设定上下文",
          ["dialogue_context_attached"]
        ),
        plan_step(
          "plan_gate_and_generate_world_building",
          :act,
          "planner 可选择 world_building，并重新经过 Orchestrator 后生成草稿",
          ["world_building_micro_plan_exists", "allow_tool_decision_exists"]
        ),
        plan_step(
          "confirm_world_building_goal",
          :explore,
          "由 goal_satisfied 或 awaiting_author 裁决收束",
          [
            "turn_result_emitted"
          ]
        )
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :prose_revision_from_findings) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("load_revision_source", :explore, "planner 可按观察读取待修订草稿和质量发现", [
          "revision_source_loaded"
        ]),
        plan_step(
          "plan_and_gate_revision",
          :explore,
          "planner 可选择 revision_plan，并重新经过 Orchestrator 完成授权判断",
          ["revision_micro_plan_exists", "allow_tool_decision_exists"]
        ),
        plan_step("generate_revision", :act, "planner 可选择 prose_writing 生成修订候选草稿", [
          "tentative_revision_fragment_exists"
        ]),
        plan_step("finalize_revision", :explore, "planner 可选择 revision_finalize 或以停止裁决收束", [
          "turn_result_emitted"
        ])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :provider_progress) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("provider_progress", :explore, "调用 provider 并展示安全进度", [
          "provider_progress_events_visible"
        ]),
        plan_step("finalize", :explore, "汇总 provider 进度结果", ["turn_result_emitted"])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :readonly_batch_context) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("readonly_batch_read", :explore, "并行读取只读上下文", [
          "readonly_batch_observations_exist"
        ]),
        plan_step("readonly_batch_finalize", :explore, "汇总只读上下文", [
          "readonly_batch_turn_result_emitted"
        ])
      ]
    })
  end

  defp agent_run_agent_plan(run_id, :conversation_turn) do
    AgentPlan.new(%{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: [
        plan_step("assemble_context", :explore, "planner 可按观察读取创作上下文", [
          "dialogue_context_attached"
        ]),
        plan_step("form_frame", :explore, "planner 可选择 dialogue_frame 形成对话认知帧", [
          "dialogue_frame_validated"
        ]),
        plan_step("plan_and_gate", :explore, "planner 可选择 strategy_gate 完成执行策略与系统裁决", [
          "planner_or_reply_route_decided"
        ]),
        plan_step("finalize_turn", :explore, "planner 可选择 response_finalize，或以停止裁决收束", [
          "turn_result_emitted"
        ])
      ]
    })
  end

  defp plan_step(step_id, kind, description, success_criteria) do
    %{
      step_id: step_id,
      kind: kind,
      status: :pending,
      description: description,
      success_criteria: success_criteria,
      depends_on: []
    }
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
      authority_scope: authority_scope(profile, input),
      budget: run_budget(text, profile, input)
    }
  end

  defp authority_scope(profile, input) do
    %{
      production_write: false,
      allowed_tools: allowed_tools(profile),
      profile_selection: profile_selection(profile, input)
    }
    |> maybe_put_fact(:work_revision, map_get(input, :work_revision))
    |> maybe_put_fact(:target_revision_ref, map_get(input, :target_revision_ref))
    |> maybe_put_fact(:target_revision, map_get(input, :target_revision))
  end

  defp maybe_put_fact(scope, key, value) do
    case nonblank_value(value) do
      nil -> scope
      fact_value -> Map.put(scope, key, fact_value)
    end
  end

  defp nonblank_value(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_value(nil), do: nil
  defp nonblank_value(value), do: value

  defp profile_selection(profile, input) do
    case map_get(input, :profile_selection) do
      selection when is_map(selection) ->
        selection

      _ ->
        default_profile_selection(profile)
    end
  end

  defp default_profile_selection(:profile_routing) do
    %{
      profile_ref: @profile_routing_profile_ref,
      source: "agent_run_entry",
      reason_codes: ["profile_routing_required"],
      matched_terms: []
    }
  end

  defp default_profile_selection(profile) do
    %{
      profile_ref: profile_ref(profile),
      source: "application_profile",
      reason_codes: ["explicit_application_profile"],
      matched_terms: []
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

  defp profile_route_next_step(run, sequence, snapshot, provider_execution, input) do
    result_fn =
      provider_execution
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :planner)
      |> Execution.result_fn()

    with result_fn when is_function(result_fn, 1) <- result_fn,
         {:ok, %{content: content}} <- result_fn.(profile_routing_prompt(run, input)),
         {:ok, parsed} <- parse_json(content),
         {:ok, profile, selection} <- build_profile_selection(parsed),
         {:ok, decision} <- profile_route_decision(run, sequence, selection) do
      {:execute, profile_route_step(profile, selection, input), decision,
       %{provider_call_count: 1}}
    else
      nil -> {:error, :provider_execution_required}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:invalid_profile_route_decision, other}}
    end
  end

  defp profile_route_step(profile, selection, input) do
    fn run, sequence, snapshot ->
      with {:ok, target_plan} <- agent_run_agent_plan(run.run_id, profile) do
        emit_profile_route_event(snapshot, selection)
        observation = profile_route_observation(run, sequence, selection)

        {:ok,
         %{
           observations: [observation],
           stage_state: %{
             routed_profile: Atom.to_string(profile),
             routed_profile_ref: selection.profile_ref,
             profile_selection: selection
           },
           run_patch: %{
             profile_ref: selection.profile_ref,
             authority_scope:
               authority_scope(profile, Map.put(input, :profile_selection, selection)),
             plan: target_plan,
             plan_ref: target_plan.plan_id,
             plan_version: target_plan.version,
             budget: routed_profile_budget(run.goal.text, profile, input)
           },
           progress_signature: "#{run.run_id}:profile_route:#{selection.profile_ref}"
         }}
      end
    end
  end

  defp emit_profile_route_event(_snapshot, _selection), do: :ok

  defp profile_route_observation(run, sequence, selection) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_profile_route",
        run_ref: run.run_id,
        step_ref: run.current_step_ref || "step_#{run.run_id}_#{sequence}",
        observation_type: :custom,
        source_ref: "profile:#{selection.profile_ref}",
        summary: selection.summary,
        structured_payload: %{
          profile_ref: selection.profile_ref,
          source: selection.source,
          reason_codes: selection.reason_codes,
          matched_terms: selection.matched_terms
        },
        evidence_refs: ["profile:#{selection.profile_ref}"],
        confidence: selection.confidence
      })

    observation
  end

  defp profile_route_decision(run, sequence, selection) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :execute_step,
      summary: selection.summary,
      target_tool_ref: "profile_route",
      write_intent: :none,
      risk_hint: :low,
      reason_codes: ["profile_route_decided" | selection.reason_codes],
      observation_refs: [],
      confidence: selection.confidence
    })
  end

  defp build_profile_selection(parsed) when is_map(parsed) do
    profile_ref =
      parsed
      |> map_get(:profile_ref)
      |> case do
        nil -> map_get(parsed, :selected_profile_ref)
        value -> value
      end
      |> normalize_profile_ref()

    with {:ok, profile} <- profile_for_ref(profile_ref) do
      summary =
        parsed
        |> map_get(:summary)
        |> normalize_summary("已选择 #{profile_ref} 工作流。")

      selection = %{
        profile_ref: profile_ref,
        source: "model_profile_router",
        reason_codes:
          parsed
          |> map_get(:reason_codes)
          |> string_list()
          |> ensure_reason_code("model_profile_selected"),
        matched_terms: parsed |> map_get(:matched_terms) |> string_list(),
        summary: summary,
        confidence: parsed |> map_get(:confidence) |> confidence()
      }

      {:ok, profile, selection}
    end
  end

  defp build_profile_selection(_parsed), do: {:error, :profile_route_json_object_required}

  defp profile_routing_prompt(run, input) do
    """
    你是小说创作系统的 AgentRun profile router。你只决定本轮应该进入哪个 AgentRun profile。
    你不批准工具执行，不生成作品内容，不调用工具；后续 profile 仍会逐步规划并重新经过系统裁决。

    ## 作者输入
    #{map_get(input, :text) || run.goal.text}

    ## 可选 profile
    - conversation_turn_v1: 普通对话、问答、方向讨论、无需直接生成待采纳创作候选。
    - character_design_with_context_v1: 需要先看现有角色阵容，再设计/新增角色或反派。
    - prose_drafting_with_quality_v1: 写正文、续写章节、生成正文草稿，并需要质量复核。
    - plot_outline_with_context_v1: 规划章节大纲、卷纲、分章结构。
    - character_evolution_with_context_v1: 更新角色当前状态、关系变化、成长/黑化/受伤等演化记忆候选。
    - world_building_with_context_v1: 世界观、设定、伏笔、线索、写作规则、风格规则候选。
    - provider_progress_v1: 明确要求演示 provider 进度、流式事件或取消边界。
    - readonly_batch_context_v1: 明确要求只读批量查看作品/角色/规则/上下文。

    ## 决策要求
    - 只能从上面的 profile_ref 中选一个。
    - 如果作者意图不明确，选择 conversation_turn_v1。
    - 输出只允许严格 JSON，不要解释过程。

    ## 输出格式
    {
      "profile_ref": "conversation_turn_v1",
      "summary": "作者可读的一句话，说明为什么进入该工作流",
      "reason_codes": ["model_profile_selected"],
      "matched_terms": ["从作者输入中支持该选择的短词"],
      "confidence": 0.0
    }
    """
  end

  defp routed_profile(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> case do
      stage_state when is_map(stage_state) ->
        Map.get(stage_state, :routed_profile) || Map.get(stage_state, "routed_profile")

      _ ->
        nil
    end
    |> profile_atom()
  end

  defp routed_profile(_snapshot), do: nil

  defp profile_for_ref(@conversation_profile_ref), do: {:ok, :conversation_turn}
  defp profile_for_ref(@character_profile_ref), do: {:ok, :character_design_with_context}
  defp profile_for_ref(@prose_profile_ref), do: {:ok, :prose_drafting_with_quality}
  defp profile_for_ref(@plot_outline_profile_ref), do: {:ok, :plot_outline_with_context}

  defp profile_for_ref(@character_evolution_profile_ref),
    do: {:ok, :character_evolution_with_context}

  defp profile_for_ref(@world_building_profile_ref), do: {:ok, :world_building_with_context}
  defp profile_for_ref(@provider_progress_profile_ref), do: {:ok, :provider_progress}
  defp profile_for_ref(@readonly_batch_profile_ref), do: {:ok, :readonly_batch_context}
  defp profile_for_ref(value), do: {:error, {:unknown_profile_ref, value}}

  defp profile_atom(value) when is_atom(value) do
    if value in routable_profiles(), do: value, else: nil
  end

  defp profile_atom(value) when is_binary(value) do
    value
    |> String.trim()
    |> profile_atom_from_string()
  end

  defp profile_atom(_value), do: nil

  defp profile_atom_from_string(value) do
    Map.get(profile_atom_lookup(), value) || profile_atom_from_ref(value)
  end

  defp profile_atom_from_ref(value) do
    case profile_for_ref(value) do
      {:ok, profile} -> profile
      _ -> nil
    end
  end

  defp profile_atom_lookup do
    %{
      "conversation_turn" => :conversation_turn,
      "character_design_with_context" => :character_design_with_context,
      "prose_drafting_with_quality" => :prose_drafting_with_quality,
      "plot_outline_with_context" => :plot_outline_with_context,
      "character_evolution_with_context" => :character_evolution_with_context,
      "world_building_with_context" => :world_building_with_context,
      "provider_progress" => :provider_progress,
      "readonly_batch_context" => :readonly_batch_context
    }
  end

  defp routable_profiles do
    [
      :conversation_turn,
      :character_design_with_context,
      :prose_drafting_with_quality,
      :plot_outline_with_context,
      :character_evolution_with_context,
      :world_building_with_context,
      :provider_progress,
      :readonly_batch_context
    ]
  end

  defp routed_profile_budget(text, profile, input) do
    base = run_budget(text, profile, input)

    %{
      base
      | max_steps: base.max_steps + 1,
        max_provider_calls: base.max_provider_calls + 1
    }
  end

  defp max_budget(budgets, key) do
    budgets
    |> Enum.map(&Map.fetch!(&1, key))
    |> Enum.max()
  end

  defp normalize_profile_ref(value) when is_binary(value), do: String.trim(value)

  defp normalize_profile_ref(value) when is_atom(value),
    do: value |> Atom.to_string() |> normalize_profile_ref()

  defp normalize_profile_ref(_value), do: ""

  defp normalize_summary(value, default) when is_binary(value) do
    case String.trim(value) do
      "" -> default
      text -> text
    end
  end

  defp normalize_summary(_value, default), do: default

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp string_list(_values), do: []

  defp ensure_reason_code([], fallback), do: [fallback]
  defp ensure_reason_code(codes, _fallback), do: codes

  defp confidence(value) when is_float(value) and value >= 0.0 and value <= 1.0, do: value
  defp confidence(value) when is_integer(value) and value >= 0 and value <= 1, do: value * 1.0
  defp confidence(_value), do: 1.0

  defp parse_json(content) when is_binary(content) do
    content
    |> strip_code_fence()
    |> find_brace_substring()
    |> Jason.decode()
    |> case do
      {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
      {:ok, _other} -> {:error, :json_object_required}
      {:error, _} -> {:error, :json_parse_failed}
    end
  end

  defp parse_json(_), do: {:error, :json_parse_failed}

  defp strip_code_fence(content) do
    trimmed = String.trim(content)

    cond do
      String.starts_with?(trimmed, "```json") ->
        trimmed
        |> String.replace_prefix("```json", "")
        |> String.replace_suffix("```", "")
        |> String.trim()

      String.starts_with?(trimmed, "```") ->
        trimmed
        |> String.replace_prefix("```", "")
        |> String.replace_suffix("```", "")
        |> String.trim()

      true ->
        trimmed
    end
  end

  defp find_brace_substring(content) do
    case {first_open(content), last_close(content)} do
      {start_pos, end_pos}
      when not is_nil(start_pos) and not is_nil(end_pos) and start_pos < end_pos ->
        String.slice(content, start_pos..end_pos)

      _ ->
        content
    end
  end

  defp first_open(s) do
    case String.split(s, "{", parts: 2) do
      [before, _] -> byte_size(before)
      [_] -> nil
    end
  end

  defp last_close(s) do
    s
    |> String.reverse()
    |> String.split("}", parts: 2)
    |> case do
      [before, _] -> byte_size(s) - byte_size(before) - 1
      [_] -> nil
    end
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
         :profile_routing,
         text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    fn run, sequence, snapshot ->
      case routed_profile(snapshot) do
        nil ->
          profile_route_next_step(run, sequence, snapshot, provider_execution, input)

        routed_profile ->
          run_selected_profile_planner(
            routed_profile,
            run,
            sequence,
            snapshot,
            {text, context, context_fetcher, provider_execution, input}
          )
      end
    end
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
         :world_building_with_context,
         _text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    WorldBuildingWithContext.next_step_planner(%{
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
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    ProseRevisionFromFindings.next_step_planner(%{
      source_turn_result: map_get(input, :source_turn_result),
      action_input: map_get(input, :action_input),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      author_text: text
    })
  end

  defp agent_next_step_planner(
         :provider_progress,
         text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    ProviderProgress.next_step_planner(%{
      text: text,
      provider_execution: provider_execution,
      provider_capabilities_fn: map_get(input, :provider_capabilities_fn)
    })
  end

  defp agent_next_step_planner(
         :readonly_batch_context,
         _text,
         _context,
         _context_fetcher,
         _provider_execution,
         input
       ) do
    ReadonlyBatchContext.next_step_planner(%{
      readers: map_get(input, :readonly_readers)
    })
  end

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

  defp run_selected_profile_planner(
         routed_profile,
         run,
         sequence,
         snapshot,
         {text, context, context_fetcher, provider_execution, input}
       ) do
    planner =
      agent_next_step_planner(
        routed_profile,
        text,
        context,
        context_fetcher,
        provider_execution,
        input
      )

    if is_function(planner, 3) do
      planner.(run, sequence, snapshot)
    else
      {:error, {:selected_profile_planner_missing, routed_profile}}
    end
  end

  defp run_budget(text, profile, input) do
    case profile do
      :conversation_turn ->
        conversation_turn_budget(input)

      _ ->
        run_budget(text, profile)
    end
  end

  defp run_budget(text, :profile_routing) do
    routed =
      [
        run_budget(text, :conversation_turn),
        run_budget(text, :character_design_with_context),
        run_budget(text, :prose_drafting_with_quality),
        run_budget(text, :plot_outline_with_context),
        run_budget(text, :character_evolution_with_context),
        run_budget(text, :world_building_with_context),
        run_budget(text, :provider_progress),
        run_budget(text, :readonly_batch_context)
      ]

    %{
      max_steps: max_budget(routed, :max_steps) + 1,
      max_tool_calls: max_budget(routed, :max_tool_calls),
      max_provider_calls: max_budget(routed, :max_provider_calls) + 1,
      max_replans: max_budget(routed, :max_replans)
    }
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

  defp run_budget(text, :world_building_with_context) do
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
      %{max_steps: 5, max_tool_calls: 2, max_provider_calls: 6, max_replans: 1}
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

  defp profile_ref(:profile_routing), do: @profile_routing_profile_ref
  defp profile_ref(:character_design_with_context), do: @character_profile_ref
  defp profile_ref(:prose_drafting_with_quality), do: @prose_profile_ref
  defp profile_ref(:plot_outline_with_context), do: @plot_outline_profile_ref
  defp profile_ref(:character_evolution_with_context), do: @character_evolution_profile_ref
  defp profile_ref(:world_building_with_context), do: @world_building_profile_ref
  defp profile_ref(:prose_revision_from_findings), do: @revision_profile_ref
  defp profile_ref(:provider_progress), do: @provider_progress_profile_ref
  defp profile_ref(:readonly_batch_context), do: @readonly_batch_profile_ref
  defp profile_ref(:conversation_turn), do: @conversation_profile_ref

  defp allowed_tools(:profile_routing), do: @profile_routing_allowed_tools
  defp allowed_tools(:character_design_with_context), do: @character_allowed_tools
  defp allowed_tools(:prose_drafting_with_quality), do: @prose_allowed_tools
  defp allowed_tools(:plot_outline_with_context), do: @plot_outline_allowed_tools
  defp allowed_tools(:character_evolution_with_context), do: @character_evolution_allowed_tools
  defp allowed_tools(:world_building_with_context), do: @world_building_allowed_tools
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

  defp context_fetcher_or_default(nil), do: fn _ -> {:ok, nil, nil, nil, nil} end
  defp context_fetcher_or_default(fetcher) when is_function(fetcher), do: fetcher

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp contains_any?(text, needles), do: Enum.any?(needles, &String.contains?(text, &1))

  defp normalize_text(text) when is_binary(text), do: String.downcase(text)
  defp normalize_text(_), do: ""
end
