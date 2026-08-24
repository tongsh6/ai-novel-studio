defmodule NovelApplication.DialoguePlanningService do
  @moduledoc """
  user_message 入口的 AgentRun 启动边界。

  UA-01 收口后，作者输入不再先走同步 `DialogueGateway` 再按裁决决定是否起 run。
  本服务只负责把非空输入固化为 AgentRun 启动载体（run_attrs + runtime spec），
  后续 frame / plan / decision / tool / reply 都在 AgentRun lifecycle 内发生，并通过
  author-safe agent_event / agent_run_state 投影给 UI。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.AgentRunFlows.CharacterDesignWithContext
  alias NovelApplication.AgentRunFlows.CharacterEvolutionWithContext
  alias NovelApplication.AgentRunFlows.FactInventory
  alias NovelApplication.AgentRunFlows.JudgmentPlan
  alias NovelApplication.AgentRunFlows.LedgerReconciliation
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.AgentRunFlows.ProseRevisionFromFindings
  alias NovelApplication.AgentRunFlows.ProviderProgress
  alias NovelApplication.AgentRunFlows.ReadonlyBatchContext
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.ChapterListBudget
  alias NovelApplication.ContextAssembler
  alias NovelApplication.DialogueGateway
  alias NovelApplication.ExplorationService
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentPlan, AgentStep}
  alias NovelDomain.{CandidateDirection, DialogueContext, DialogueFrame}

  @profile_routing_allowed_tools ["judgment"]
  @profile_routing_profile_ref "judgment_loop_v1"
  @character_allowed_tools ["character_roster", "character_design"]
  @character_profile_ref CharacterDesignWithContext.profile_ref()
  @prose_allowed_tools ["prose_writing"]
  @prose_profile_ref ProseDraftingWithQuality.profile_ref()
  @plot_outline_allowed_tools ["plot_outline"]
  @judgment_plan_profile_ref JudgmentPlan.profile_ref()
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
  @ledger_reconciliation_profile_ref LedgerReconciliation.profile_ref()
  @ledger_reconciliation_allowed_tools ["ledger_reconcile"]
  @fact_inventory_profile_ref FactInventory.profile_ref()
  @fact_inventory_allowed_tools ["fact_inventory"]

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
          | :ledger_reconciliation
          | :fact_inventory

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

  # 判断循环入口无预制计划轨道（ADR-0025 N-PLAN）：轨道 = judgment 事件链；
  # 机械准备（上下文组装）与判断①由 next_step_planner 按循环推进，不排 app 步骤。
  # 计划形状复用 pending_model_plan（与创作 profile"计划待模型产生"同一语义）。
  defp agent_run_agent_plan(run_id, :profile_routing),
    do: {:ok, pending_model_plan(run_id)}

  defp agent_run_agent_plan(run_id, :character_design_with_context),
    do: {:ok, pending_model_plan(run_id)}

  defp agent_run_agent_plan(run_id, :prose_drafting_with_quality),
    do: {:ok, pending_model_plan(run_id)}

  defp agent_run_agent_plan(run_id, :judgment_plan),
    do: {:ok, pending_model_plan(run_id)}

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

  defp agent_run_agent_plan(run_id, :prose_revision_from_findings),
    do: {:ok, pending_model_plan(run_id)}

  defp agent_run_agent_plan(run_id, :provider_progress) do
    {:ok, pending_model_plan(run_id)}
  end

  defp agent_run_agent_plan(run_id, :readonly_batch_context) do
    {:ok, pending_model_plan(run_id)}
  end

  defp agent_run_agent_plan(run_id, :ledger_reconciliation) do
    {:ok, pending_model_plan(run_id)}
  end

  defp agent_run_agent_plan(run_id, :fact_inventory) do
    {:ok, pending_model_plan(run_id)}
  end

  defp pending_model_plan(run_id) do
    %{
      plan_id: "ap_#{run_id}",
      run_ref: run_id,
      version: 1,
      goal_version: 1,
      steps: []
    }
  end

  defp plan_id(plan) when is_map(plan), do: Map.get(plan, :plan_id) || Map.get(plan, "plan_id")
  defp plan_id(_plan), do: nil

  defp plan_version(plan) when is_map(plan),
    do: Map.get(plan, :version) || Map.get(plan, "version") || 1

  defp plan_version(_plan), do: 1

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
      trigger: map_get(input, :trigger),
      plan: agent_plan,
      plan_ref: plan_id(agent_plan),
      plan_version: plan_version(agent_plan),
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

  # ── 判断①循环（ADR-0025：机械准备 → 判断① → reply 终结 / 切能力 profile / 探索回环 / 停等） ──
  #
  # 路由语义并入判断①：action=execute/plan + capability 等价旧路由选 profile；
  # action=reply 回复内联终结（简单对话 2 次调用）；action=await_author 停等作者。
  # CP5a 内部翼：action=explore 按 explore_request 跑只读检索（ExplorationService，
  # 0 提供者调用），观察写进 stage_state 回环再判断；回合硬上限后判断不再开放
  # explore 选项（被迫四选一收束）。

  @max_explore_rounds 2

  # 判断①能力目录（prompt 目录 + schema enum + 解析校验三处同源；dispatch 表
  # @judgment_capability_profiles 是超集——provider_progress 不在作者可选目录）。
  @judgment_capabilities ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)

  @judgment_capability_profiles %{
    "character_design" => :character_design_with_context,
    "character_evolution" => :character_evolution_with_context,
    "prose_writing" => :prose_drafting_with_quality,
    "plot_outline" => :plot_outline_with_context,
    "world_building" => :world_building_with_context,
    "work_archive_read" => :readonly_batch_context,
    "provider_progress" => :provider_progress
  }

  defp judgment_loop_next_step(run, sequence, snapshot, provider_execution, input) do
    state = judgment_stage_state(snapshot)

    cond do
      judgment_settled(state) == "completed" ->
        judgment_terminal(run, sequence, :complete, "本轮回应已生成。")

      judgment_settled(state) == "awaiting_author" ->
        judgment_terminal(run, sequence, :await_author, "等待作者说明后继续。")

      judgment_context(state) == nil ->
        judgment_context_next_step(run, sequence, input)

      true ->
        judgment_next_step(run, sequence, provider_execution, input, state)
    end
  end

  defp judgment_stage_state(snapshot) when is_map(snapshot),
    do: Map.get(snapshot, :stage_state) || Map.get(snapshot, "stage_state") || %{}

  defp judgment_stage_state(_snapshot), do: %{}

  defp judgment_settled(state),
    do: Map.get(state, :judgment_settled) || Map.get(state, "judgment_settled")

  defp judgment_context(state),
    do: Map.get(state, :judgment_context) || Map.get(state, "judgment_context")

  defp judgment_explorations(state) do
    case Map.get(state, :judgment_explorations) || Map.get(state, "judgment_explorations") do
      explorations when is_list(explorations) -> explorations
      _ -> []
    end
  end

  # 探索目录段（explore 开放时给判断 prompt）+ 已有观察段（机械渲染，
  # 结构词家族 + 出处 refs——观察正文是检索结果字节，非系统代笔叙述）。
  defp exploration_sections(explorations, explore_open?) do
    catalog = if explore_open?, do: "\n\n" <> ExplorationService.catalog_section(), else: ""

    observations =
      case explorations do
        [] ->
          ""

        list ->
          rendered =
            list
            |> Enum.with_index(1)
            |> Enum.map_join("\n\n", fn {observation, index} ->
              "### 观察 #{index}（#{observation.tool}「#{observation.query}」）\n#{observation.summary}"
            end)

          "\n\n## 探索观察（已检索到的作品事实）\n\n" <> rendered
      end

    catalog <> observations
  end

  defp judgment_terminal(run, sequence, kind, summary) do
    decision =
      judgment_mech_decision(run, sequence, "judgment_settle", summary, [
        "judgment_" <> Atom.to_string(kind)
      ])

    with {:ok, decision} <- decision do
      {kind, decision, %{provider_call_count: 0, suppress_plan_event: true}}
    end
  end

  # 机械准备：组装作品上下文（0 调用、确定性——永不问模型）。
  defp judgment_context_next_step(run, sequence, input) do
    with {:ok, decision} <-
           judgment_mech_decision(run, sequence, "context_assemble", "组装当前作品上下文。", [
             "judgment_mechanical_prep"
           ]) do
      {:execute, judgment_context_step(input), decision,
       %{provider_call_count: 0, suppress_plan_event: true}}
    end
  end

  defp judgment_context_step(input) do
    fn run, sequence, snapshot ->
      text = effective_author_text(input, run)
      ws_id = map_get(input, :workspace_id) || run.workspace_id
      turn_id = map_get(input, :turn_id) || run.parent_turn_ref

      # 业务日志 turn/session 关联（与旧 conversation context 步同款）：缺失会让
      # context.assemble.done 等 JSONL 失去 per-turn 关联，外部验收无法归组。
      NovelCommon.LogContext.put_turn(
        ws_id,
        map_get(input, :work_id) || run.work_id || ws_id,
        turn_id,
        map_get(input, :session_id) || run.session_id
      )

      context =
        ContextAssembler.assemble_for_input(
          ws_id,
          text,
          context_fetcher_or_default(map_get(input, :context_fetcher)),
          session_id: map_get(input, :session_id),
          assembly_policy: NovelApplication.current_assembly_policy()
        )

      emit_judgment_stage(snapshot, :goal_understood, "已组装当前作品上下文。", ["context_assembled"], %{
        stage: :context_assembled,
        context_ref_count: length(context.context_refs || [])
      })

      {:ok,
       %{
         step: judgment_agent_step(run, sequence, "组装创作上下文"),
         observations: [
           judgment_observation(run, sequence, "已组装本轮创作上下文。", "context:#{turn_id}", %{
             stage: :context_assembled
           })
         ],
         stage_state: %{judgment_context: context, judgment_input: input},
         provider_call_count: 0,
         progress_signature: "#{run.run_id}:judgment_context:#{turn_id}"
       }}
    end
  end

  # 判断①：两段式（call1 叙事流式 + call2 judgment_decision），随后按 action 分发。
  defp judgment_next_step(run, sequence, provider_execution, input, state) do
    with {:ok, decision} <-
           judgment_mech_decision(run, sequence, "judgment", "判断本轮形态。", [
             "judgment_requested"
           ]) do
      {:execute, judgment_step(provider_execution, input, state), decision,
       %{provider_call_count: 0, suppress_plan_event: true}}
    end
  end

  defp judgment_step(provider_execution, input, state) do
    fn run, sequence, snapshot ->
      # LogContext 是进程本地的；判断步与 context 步在不同 step task 进程，
      # 必须各自设置 turn 关联（否则 judgment.decided.done 等业务日志失联）。
      NovelCommon.LogContext.put_turn(
        map_get(input, :workspace_id) || run.workspace_id,
        map_get(input, :work_id) || run.work_id || run.workspace_id,
        map_get(input, :turn_id) || run.parent_turn_ref,
        map_get(input, :session_id) || run.session_id
      )

      # llm 调用日志步名（live 取证用；旧 planner 为 form_frame，判断循环为 judgment）。
      NovelCommon.LogContext.put_step("judgment")

      context = judgment_context(state)
      explorations = judgment_explorations(state)
      protocol_input = judgment_protocol_input(input, run, context, explorations)

      case JudgmentProtocol.request_judgment(provider_execution, snapshot, protocol_input) do
        {:ok, %{action: "explore"} = judgment} ->
          emit_judgment_decided(snapshot, judgment)
          judgment_explore_result(judgment, run, sequence, input, context, snapshot, explorations)

        {:ok, judgment} ->
          emit_judgment_decided(snapshot, judgment)
          dispatch_judgment(judgment, run, sequence, input, context)

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp judgment_protocol_input(input, run, context, explorations) do
    explore_open? = length(explorations) < @max_explore_rounds

    author_text = effective_author_text(input, run)

    %{
      author_text: author_text,
      context_block:
        judgment_context_block(context, author_text) <>
          exploration_sections(explorations, explore_open?),
      options:
        [capabilities: @judgment_capabilities] ++
          if(explore_open?,
            do: [explore: true, explore_tools: ExplorationService.tool_names()],
            else: []
          )
    }
  end

  # 业务日志（ADR-0018 观测族）：判断结构落地事实——frame 语义并入判断后，
  # 取代旧 planner.form_frame.done 的 JSONL 覆盖；frame_type/candidate_count 记
  # 解析与兜底之后的最终口径（外部验收据此归组）。
  defp log_judgment_decided(judgment, frame_type, candidate_count) do
    LogEmit.emit(:judgment, :decided, :done, %{
      action: judgment.action,
      capability: judgment.capability,
      frame_type: to_string(frame_type),
      candidate_count: candidate_count,
      reason_code: judgment.reason
    })
  end

  defp dispatch_judgment(%{action: "reply"} = judgment, run, sequence, input, context),
    do: finalize_judgment_reply(judgment, run, sequence, input, context, :completed)

  defp dispatch_judgment(%{action: "await_author"} = judgment, run, sequence, input, context),
    do: finalize_judgment_reply(judgment, run, sequence, input, context, :awaiting_author)

  # CP4（ADR-0025 决策 2）：plan ≠ execute——判"复杂"进跨能力真计划 profile，
  # 计划由模型基于能力目录制定（judgment_plan flow 内起草，plan_drafted 照发）。
  defp dispatch_judgment(%{action: "plan"} = judgment, run, sequence, input, _context),
    do: judgment_switch_result(:judgment_plan, judgment, input, run, sequence)

  defp dispatch_judgment(%{action: "execute"} = judgment, run, sequence, input, _context) do
    case Map.fetch(@judgment_capability_profiles, judgment.capability || "") do
      {:ok, profile} ->
        judgment_switch_result(profile, judgment, input, run, sequence)

      :error ->
        {:error, {:unknown_judgment_capability, judgment.capability}}
    end
  end

  defp dispatch_judgment(judgment, _run, _sequence, _input, _context),
    do: {:error, {:unknown_judgment_action, judgment.action}}

  # reply / await_author 终结：判断结构机械转换 DialogueFrame（frame 语义并入判断①），
  # 下游 Trace / TurnResultBuilder / 持久化副作用沿用零改动；正文=call1 输出（N-NARR 字节绑定）。
  defp finalize_judgment_reply(judgment, run, sequence, input, context, settle) do
    turn_id = map_get(input, :turn_id) || run.parent_turn_ref
    ws_id = map_get(input, :workspace_id) || run.workspace_id
    frame = judgment_frame(judgment, turn_id, ws_id, context)
    candidates = judgment_candidates(judgment, frame.frame_id)
    log_judgment_decided(judgment, frame.frame_type, length(candidates))

    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: turn_id}, context)

    turn_result =
      frame
      |> TurnResultBuilder.build(trace_summary, candidates)
      |> scope_judgment_turn_result(input, run)
      |> AgentFinalizer.attach_run_summary(judgment_run_summary(run, settle))

    # DS03：steer 后（goal.version > 1）的再次 settle 只补 assistant entry——
    # 作者补充的 user beat 已由 steer 时刻的独立 interaction 落库（persist_author_steer），
    # 这里再写 user 会在 transcript 中重复同一句补充。
    DialogueGateway.persist_turn_side_effects(
      {:ok, turn_result, trace, candidates, context},
      ws_id,
      map_get(input, :session_id),
      effective_author_text(input, run),
      map_get(input, :trace_persister),
      map_get(input, :memory_recorder),
      %{
        candidate_selection: map_get(input, :candidate_selection),
        suppress_user_entry: run.goal.version > 1
      }
    )

    {:ok,
     %{
       step: judgment_agent_step(run, sequence, "判断并生成本轮回应"),
       observations: [
         judgment_observation(run, sequence, judgment.narrative, "judgment:#{turn_id}", %{
           stage: :judgment_decided,
           action: judgment.action
         })
       ],
       turn_result: turn_result,
       stage_state: %{judgment_settled: settle_state(settle)},
       provider_call_count: judgment.provider_call_count,
       progress_signature: "#{run.run_id}:judgment:#{turn_id}"
     }}
  end

  defp settle_state(:completed), do: "completed"
  defp settle_state(:awaiting_author), do: "awaiting_author"

  defp effective_author_text(input, run) do
    goal_text = run.goal.text |> to_string() |> String.trim()
    original_text = map_get(input, :text)

    cond do
      run.goal.version > 1 and goal_text != "" -> goal_text
      is_binary(original_text) and String.trim(original_text) != "" -> String.trim(original_text)
      true -> goal_text
    end
  end

  # CP5a explore：按 explore_request 跑只读检索（同判断步内联执行，0 提供者调用），
  # 观察追加进 stage_state（shallow merge 整表替换，故带旧值重建）后回环——planner
  # 不见 settle 会再入判断步。explore_request 缺失（模型选了 explore 但没点名工具/
  # 查询）按 S2 韧性降级停等，不伪造检索。工具失败记为观察（诚实呈现，下一轮判断
  # 自行换面或停等），不硬失败整个 run。
  defp judgment_explore_result(
         %{explore_request: nil} = judgment,
         run,
         sequence,
         input,
         context,
         _snapshot,
         _explorations
       ) do
    degraded = %{judgment | reason: "explore_request_missing"}
    finalize_judgment_reply(degraded, run, sequence, input, context, :awaiting_author)
  end

  defp judgment_explore_result(judgment, run, sequence, input, _context, snapshot, explorations) do
    %{tool: tool, query: query} = judgment.explore_request
    work_id = map_get(input, :work_id) || run.work_id || run.workspace_id
    log_judgment_decided(judgment, "judgment_explore", 0)

    observation =
      case ExplorationService.run(work_id, tool, query) do
        {:ok, observation} ->
          observation

        {:error, reason} ->
          %{tool: tool, query: query, summary: "探索工具执行失败：#{inspect(reason)}", refs: []}
      end

    emit_judgment_stage(
      snapshot,
      :exploration_observed,
      "已检索 #{tool}「#{query}」。",
      ["exploration_observed", tool],
      %{
        stage: :exploration_observed,
        tool: tool,
        query: query,
        refs: observation.refs,
        summary: observation.summary
      }
    )

    {:ok,
     %{
       step: judgment_agent_step(run, sequence, "探索：#{tool}「#{query}」"),
       observations: [
         judgment_observation(
           run,
           sequence,
           observation.summary,
           "explore:#{tool}:#{sequence}",
           %{
             stage: :exploration_observed,
             tool: tool,
             query: query
           }
         )
       ],
       stage_state: %{judgment_explorations: explorations ++ [observation]},
       provider_call_count: judgment.provider_call_count,
       progress_signature: "#{run.run_id}:explore:#{sequence}:#{tool}:#{query}"
     }}
  end

  # execute/plan：切换到能力 profile（等价旧路由；计划起草→机械 cursor 沿用）。
  defp judgment_switch_result(profile, judgment, input, run, sequence) do
    log_judgment_decided(judgment, "judgment_" <> judgment.action, 0)
    selection = judgment_selection(judgment, profile)

    with {:ok, target_plan} <- agent_run_agent_plan(run.run_id, profile) do
      {:ok,
       %{
         step: judgment_agent_step(run, sequence, "判断进入#{selection.profile_ref}"),
         observations: [
           judgment_observation(
             run,
             sequence,
             judgment.narrative,
             "profile:#{selection.profile_ref}",
             %{
               stage: :judgment_decided,
               action: judgment.action,
               profile_ref: selection.profile_ref
             }
           )
         ],
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
           plan_ref: plan_id(target_plan),
           plan_version: plan_version(target_plan),
           budget: routed_profile_budget(run.goal.text, profile, input)
         },
         provider_call_count: judgment.provider_call_count,
         progress_signature: "#{run.run_id}:judgment_switch:#{selection.profile_ref}"
       }}
    end
  end

  defp judgment_selection(judgment, profile) do
    %{
      profile_ref: profile_ref(profile),
      source: "judgment_loop",
      reason_codes: ["model_profile_selected", "judgment_" <> judgment.action],
      matched_terms: [],
      summary: judgment.narrative,
      confidence: 1.0
    }
  end

  defp judgment_run_summary(run, settle) do
    %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      parent_turn_ref: run.parent_turn_ref,
      profile_ref: run.profile_ref,
      status: settle
    }
  end

  # 探索意图：有效候选或"意图给候选但结构坏了"都算（坏结构由兜底候选降级承接）。
  defp judgment_exploration?(judgment),
    do: judgment.candidate_directions != [] or judgment[:candidate_directions_present] == true

  # 判断结构 → DialogueFrame 机械转换（非预制创作决策：全部字段来自模型判断输出）。
  defp judgment_frame(judgment, turn_id, ws_id, context) do
    frame_type =
      if judgment_exploration?(judgment) do
        :creative_exploration
      else
        reply_frame_type(judgment.frame_type)
      end

    context_ref =
      case context do
        %DialogueContext{workspace_id: id} when is_binary(id) -> "context:#{id}"
        _ -> nil
      end

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: NovelFoundation.ID.unique("frame"),
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: frame_type,
      source_refs: %{
        author_input_ref: "author_input:#{turn_id}",
        dialogue_context_ref: context_ref
      },
      dialogue_goal: %{summary: judgment.dialogue_goal || "回应作者本轮输入"},
      tool_need: %{needs_tool: false, reason_code: reply_reason_code(frame_type)},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: judgment.narrative},
      evidence_summary: %{judgment: true, action: judgment.action, context_used: context != nil},
      uncertainty: []
    }
  end

  defp reply_frame_type("creative_exploration"), do: :creative_exploration
  defp reply_frame_type("question_answer"), do: :question_answer
  defp reply_frame_type("meta_discussion"), do: :meta_discussion
  defp reply_frame_type(_), do: :casual_reply

  defp reply_reason_code(:creative_exploration), do: :exploratory_only
  defp reply_reason_code(:meta_discussion), do: :user_requested_discussion
  defp reply_reason_code(_), do: :no_tool_needed

  # 候选随判断结构携带（S2 保全）：字节绑定 provider tool arguments（I1/I3 语义不变）。
  # 判定探索但有效候选为空（坏结构/空标题）→ 应用兜底候选（与 frame 路径同一份，
  # Planner.fallback_candidates——S2 韧性语义平移）。
  defp judgment_candidates(%{candidate_directions: directions} = judgment, frame_id) do
    candidates =
      directions
      |> Enum.map(fn c ->
        %CandidateDirection{
          direction_id: NovelFoundation.ID.unique("dir"),
          title: c |> map_get(:title) |> to_string() |> String.trim(),
          pitch: c |> map_get(:pitch) |> to_string() |> String.trim(),
          tone_tags: map_get(c, :tone_tags) || [],
          source_frame_ref: frame_id,
          risk_hint: :low,
          adoption_status: :not_adopted
        }
      end)
      |> Enum.filter(&(&1.title != "" and &1.pitch != ""))

    if candidates == [] and judgment_exploration?(judgment) do
      NovelApplication.Planner.fallback_candidates(frame_id)
    else
      candidates
    end
  end

  defp scope_judgment_turn_result(turn_result, input, run) do
    turn_result
    |> Map.put_new(:workspace_id, map_get(input, :workspace_id) || run.workspace_id)
    |> Map.put_new(:work_id, map_get(input, :work_id) || run.work_id || run.workspace_id)
    |> Map.put_new(:session_id, map_get(input, :session_id) || run.session_id)
  end

  # 判断①的作品上下文段（机械准备渲染）+ CP1 能力目录（不含检索，explore 由 CP5 打开）。
  defp judgment_context_block(context, author_text) do
    [
      judgment_work_section(context),
      judgment_chapters_section(context, author_text),
      judgment_conversation_section(context),
      judgment_capability_catalog()
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  defp judgment_work_section(%DialogueContext{current_work_snapshot: snapshot})
       when is_map(snapshot) and map_size(snapshot) > 0 do
    # 缺席字段诚实缺席（06 §5.0）：nil/空串不渲染占位行（CA01 创作锚字段可选）。
    "## 当前作品上下文\n" <>
      (snapshot
       |> Enum.reject(fn {_key, value} -> value in [nil, ""] end)
       |> Enum.map_join("\n", fn {key, value} -> "- #{key}: #{value}" end))
  end

  defp judgment_work_section(_context),
    do: "## 当前作品上下文\n（无——这是新对话或尚未创建作品）"

  # T2a（call2 病灶结构性收口）：章节段有界投影——超限时首章+最近 N+作者点名章。
  # Order 7-④（M2 实锤：标头"已写章节共17章"实际12章有正文）：标头区分已写/
  # 计划中，未写正文的章标注「（计划中）」——判断器对写作进度的认知不再被计划章污染。
  defp judgment_chapters_section(
         %DialogueContext{current_chapters: [_ | _] = chapters} = context,
         author_text
       ) do
    {listed, omitted} = ChapterListBudget.project(chapters, author_text)
    planned = planned_chapter_titles(context)
    written_count = length(chapters) - MapSet.size(planned)

    annotated =
      Enum.map(listed, fn title ->
        if MapSet.member?(planned, title), do: "#{title}（计划中）", else: title
      end)

    "## 章节列表（共 #{length(chapters)} 章：已写 #{written_count} 章，计划中 #{MapSet.size(planned)} 章）\n" <>
      ChapterListBudget.render_lines(annotated, omitted, length(chapters)) <>
      "\n（回答写作进度时以「已写」计数为准；标注（计划中）的章尚无正文。各章正文细节不在本段内。）"
  end

  defp judgment_chapters_section(_context, _author_text), do: ""

  defp planned_chapter_titles(%DialogueContext{structured_chapters: structured})
       when is_list(structured) do
    structured
    |> Enum.reject(&Map.get(&1, :has_prose, false))
    |> Enum.map(& &1.title)
    |> MapSet.new()
  end

  defp planned_chapter_titles(_context), do: MapSet.new()

  defp judgment_conversation_section(%DialogueContext{conversation_summary: summary})
       when is_binary(summary) and summary != "" do
    "## 会话摘要\n#{summary}"
  end

  defp judgment_conversation_section(_context), do: ""

  defp judgment_capability_catalog do
    """
    ## 可用能力（判断"单动作执行"或"制定计划"时的目标集）
    - character_design：设计新角色/反派（产出待采纳候选）
    - character_evolution：更新角色当前状态、关系变化（产出待采纳演化记录）
    - prose_writing：写/续写章节正文（产出待采纳草稿）
    - plot_outline：规划章节大纲、卷纲、分章结构（产出待采纳大纲）
    - world_building：世界观、设定、伏笔、写作规则（产出待采纳设定）
    - work_archive_read：只读查看作品档案（角色列表、结构、统计；不产出候选）
    """
    |> String.trim()
  end

  defp emit_judgment_decided(snapshot, judgment) do
    emit_judgment_stage(
      snapshot,
      :judgment_decided,
      judgment.narrative,
      ["judgment_decided", "judgment_" <> judgment.action],
      %{
        stage: :judgment_decided,
        action: judgment.action,
        capability: judgment.capability,
        reason: judgment.reason,
        candidate_count: length(judgment.candidate_directions),
        author_narrative: judgment.narrative,
        author_narrative_source: judgment.narrative_source
      },
      judgment_event_visibility(judgment)
    )
  end

  defp judgment_event_visibility(%{narrative_source: source}) do
    if AgentNarrativeSource.provider_output_source?(source), do: :author, else: :developer
  end

  defp emit_judgment_stage(snapshot, type, summary, reason_codes, payload, visibility \\ :author) do
    case Map.get(snapshot, :stage_sink) do
      sink when is_function(sink, 1) ->
        sink.(%{
          event_type: type,
          visibility: visibility,
          summary: summary,
          reason_codes: reason_codes,
          refs: [],
          payload: payload
        })

        :ok

      _ ->
        :ok
    end
  end

  defp judgment_mech_decision(run, sequence, target, summary, reason_codes) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :execute_step,
      summary: summary,
      target_tool_ref: target,
      write_intent: :none,
      risk_hint: :low,
      reason_codes: reason_codes,
      observation_refs: [],
      confidence: 1.0
    })
  end

  defp judgment_agent_step(run, sequence, goal) do
    slug =
      goal
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9一-龥]+/u, "_")
      |> String.trim("_")

    {:ok, step} =
      AgentStep.new(%{
        step_id: run.current_step_ref || "step_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        goal: goal,
        status: :completed,
        observation_refs: [],
        state_snapshot_ref:
          Enum.join(
            ["agent_snapshot", run.work_id, run.session_id, run.run_id, "step", sequence],
            ":"
          ),
        idempotency_key:
          "#{run.run_id}:#{sequence}:judgment_loop:#{slug}:goal_v#{run.goal.version}"
      })

    step
  end

  defp judgment_observation(run, sequence, summary, source_ref, payload) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_judgment",
        run_ref: run.run_id,
        step_ref: run.current_step_ref || "step_#{run.run_id}_#{sequence}",
        observation_type: :custom,
        source_ref: source_ref,
        summary: summary,
        structured_payload: payload,
        evidence_refs: [source_ref],
        confidence: 1.0
      })

    observation
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

  defp profile_for_ref(@character_profile_ref), do: {:ok, :character_design_with_context}
  defp profile_for_ref(@prose_profile_ref), do: {:ok, :prose_drafting_with_quality}
  defp profile_for_ref(@judgment_plan_profile_ref), do: {:ok, :judgment_plan}
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
      "judgment_plan" => :judgment_plan,
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
      :judgment_plan,
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

    # +2 = 判断循环入场开销：机械准备 1 step（0 调用）+ 判断① 1 step（两段式 2 调用）；
    # 两段式规划开销已在 run_budget/3 补足
    %{
      base
      | max_steps: base.max_steps + 2,
        max_provider_calls: base.max_provider_calls + 2
    }
  end

  defp max_budget(budgets, key) do
    budgets
    |> Enum.map(&Map.fetch!(&1, key))
    |> Enum.max()
  end

  defp prose_drafting_next_step_planner(context, context_fetcher, provider_execution, input) do
    ProseDraftingWithQuality.next_step_planner(%{
      context: context,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      quality_provider_execution: map_get(input, :quality_provider_execution),
      trace_persister: map_get(input, :trace_persister),
      memory_recorder: map_get(input, :memory_recorder),
      chapter_prose_reader: map_get(input, :chapter_prose_reader),
      chapter_summary_reader: map_get(input, :chapter_summary_reader),
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader),
      # WR01/WR01b：写前推理的账面/进度读端口与暂定使命写端口（测试可注入，生产走 persistence）。
      ledger_reader: map_get(input, :ledger_reader),
      written_progress_reader: map_get(input, :written_progress_reader),
      chapter_mission_writer: map_get(input, :chapter_mission_writer)
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
          judgment_loop_next_step(run, sequence, snapshot, provider_execution, input)

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
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader)
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
         :judgment_plan,
         _text,
         context,
         context_fetcher,
         provider_execution,
         input
       ) do
    JudgmentPlan.next_step_planner(%{
      context: context,
      context_fetcher:
        context_fetcher_or_default(map_get(input, :context_fetcher) || context_fetcher),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution),
      chapter_prose_reader: map_get(input, :chapter_prose_reader),
      chapter_summary_reader: map_get(input, :chapter_summary_reader),
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader)
    })
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
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader),
      # WR02：规划前推理的账面/进度读端口（测试可注入）。
      ledger_reader: map_get(input, :ledger_reader),
      written_progress_reader: map_get(input, :written_progress_reader),
      # CA04 G2：规划带作品事实/风格。
      memory_reader: map_get(input, :memory_reader)
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
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader)
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
      character_reader: map_get(input, :character_reader),
      assumption_reader: map_get(input, :assumption_reader)
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
      memory_recorder: map_get(input, :memory_recorder),
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
      planner_provider_execution: map_get(input, :planner_provider_execution),
      provider_capabilities_fn: map_get(input, :provider_capabilities_fn)
    })
  end

  defp agent_next_step_planner(
         :readonly_batch_context,
         _text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    ReadonlyBatchContext.next_step_planner(%{
      readers: map_get(input, :readonly_readers),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution)
    })
  end

  defp agent_next_step_planner(
         :ledger_reconciliation,
         _text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    LedgerReconciliation.next_step_planner(%{
      reconcile_fn: map_get(input, :reconcile_fn),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution)
    })
  end

  defp agent_next_step_planner(
         :fact_inventory,
         _text,
         _context,
         _context_fetcher,
         provider_execution,
         input
       ) do
    FactInventory.next_step_planner(%{
      material_reader: map_get(input, :material_reader),
      skeleton_reader: map_get(input, :skeleton_reader),
      assumption_writer: map_get(input, :assumption_writer),
      provider_execution: provider_execution,
      planner_provider_execution: map_get(input, :planner_provider_execution)
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

  defp run_budget(text, profile, _input) do
    plan_overhead_budget(run_budget(text, profile))
  end

  # 判断②续行余量（ADR-0025 CP3）：起草两段式多 1 次 reasoning 调用；模型计划修订
  # 已被判断②取代——每次续行 = 判断②两段 2 + 续行重产出步（占 1 步 1 工具、prose
  # 双调用上界 2），三维各按 max_replans 补足 backstop 余量（上限是兜底不是配额）。
  # 作者显式"最多一步"预算（max_steps: 1 指纹）是硬约束：停等后无续行，不加余量，
  # 只补起草 reasoning。
  defp plan_overhead_budget(%{max_steps: 1} = base) do
    %{base | max_provider_calls: base.max_provider_calls + 1}
  end

  defp plan_overhead_budget(base) do
    %{
      base
      | max_provider_calls: base.max_provider_calls + 1 + base.max_replans * 4,
        max_steps: base.max_steps + base.max_replans,
        max_tool_calls: base.max_tool_calls + base.max_replans
    }
  end

  defp run_budget(text, :profile_routing) do
    routed =
      [
        run_budget(text, :character_design_with_context),
        run_budget(text, :prose_drafting_with_quality),
        run_budget(text, :plot_outline_with_context),
        run_budget(text, :character_evolution_with_context),
        run_budget(text, :world_building_with_context),
        run_budget(text, :provider_progress),
        run_budget(text, :readonly_batch_context)
      ]

    # +2 = 判断循环入场开销：机械准备 1 step（0 调用）+ 判断①两段式 2 调用；
    # 两段式规划开销由 run_budget/3 的 plan_overhead_budget 统一补足。
    # CP5a 探索余量（上界 backstop 非配额）：每回合 = 探索步 1 step（0 调用）+
    # 再判断 1 step 2 调用，@max_explore_rounds 回合封顶。
    explore_allowance = @max_explore_rounds * 2

    %{
      max_steps: max_budget(routed, :max_steps) + 2 + explore_allowance,
      max_tool_calls: max_budget(routed, :max_tool_calls),
      max_provider_calls: max_budget(routed, :max_provider_calls) + 2 + explore_allowance,
      max_replans: max_budget(routed, :max_replans),
      max_pending_artifacts: max_budget(routed, :max_pending_artifacts)
    }
  end

  defp run_budget(text, :character_design_with_context) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 1,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    else
      %{
        max_steps: 4,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    end
  end

  # WR01：正文 run 多一步写前推理（chapter_mission，1 调用）——max_steps 4→5、
  # max_provider_calls 5→6；作者显式一步预算不变（一步预算是硬约束，不排推理步）。
  defp run_budget(text, :prose_drafting_with_quality) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 2,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    else
      %{
        max_steps: 5,
        max_tool_calls: 2,
        max_provider_calls: 6,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    end
  end

  defp run_budget(_text, :judgment_plan) do
    # CP4 跨能力真计划：起草 2 + 至多 5 能力步（每步至多 2 调用）；多产物上限 3。
    %{
      max_steps: 6,
      max_tool_calls: 5,
      max_provider_calls: 12,
      max_replans: 1,
      max_pending_artifacts: 3
    }
  end

  defp run_budget(text, :plot_outline_with_context) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 1,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    else
      %{
        max_steps: 4,
        max_tool_calls: 2,
        max_provider_calls: 5,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    end
  end

  defp run_budget(text, :character_evolution_with_context) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 1,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    else
      %{
        max_steps: 4,
        max_tool_calls: 2,
        max_provider_calls: 5,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    end
  end

  defp run_budget(text, :world_building_with_context) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 1,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    else
      %{
        max_steps: 4,
        max_tool_calls: 2,
        max_provider_calls: 5,
        max_replans: 1,
        max_pending_artifacts: 1
      }
    end
  end

  defp run_budget(text, :prose_revision_from_findings) do
    if one_step_budget?(text) do
      %{
        max_steps: 1,
        max_tool_calls: 1,
        max_provider_calls: 1,
        max_replans: 1,
        max_pending_artifacts: 3
      }
    else
      %{
        max_steps: 5,
        max_tool_calls: 2,
        max_provider_calls: 3,
        max_replans: 1,
        max_pending_artifacts: 3
      }
    end
  end

  defp run_budget(_text, :provider_progress) do
    %{
      max_steps: 2,
      max_tool_calls: 1,
      max_provider_calls: 2,
      max_replans: 1,
      max_pending_artifacts: 3
    }
  end

  defp run_budget(_text, :readonly_batch_context) do
    %{
      max_steps: 3,
      max_tool_calls: 5,
      max_provider_calls: 2,
      max_replans: 1,
      max_pending_artifacts: 3
    }
  end

  # 全书审读（CP4c-2）：机械审读 1 步 + 收尾 1 步；模型只起草计划（provider 1 调用
  # 由 plan_overhead_budget 补足）。恰一 tentative 报告走 repo 物化不占 artifact 位。
  defp run_budget(_text, :ledger_reconciliation) do
    %{
      max_steps: 3,
      max_tool_calls: 3,
      max_provider_calls: 1,
      max_replans: 1,
      max_pending_artifacts: 1
    }
  end

  # 设定盘点（VS-00G CP4b-2）：本 profile 的业务调用上界为提炼 2 次（坏 JSON 修正）；
  # 模型计划起草/续行余量统一由 plan_overhead_budget/1 补足。盘点可同批产多条
  # character/rule/foreshadowing seed，因此 pending backstop 高于单候选创作 profile。
  defp run_budget(_text, :fact_inventory) do
    %{
      max_steps: 3,
      max_tool_calls: 1,
      max_provider_calls: 2,
      max_replans: 1,
      max_pending_artifacts: 60
    }
  end

  defp profile_ref(:profile_routing), do: @profile_routing_profile_ref
  defp profile_ref(:character_design_with_context), do: @character_profile_ref
  defp profile_ref(:prose_drafting_with_quality), do: @prose_profile_ref
  defp profile_ref(:judgment_plan), do: @judgment_plan_profile_ref
  defp profile_ref(:plot_outline_with_context), do: @plot_outline_profile_ref
  defp profile_ref(:character_evolution_with_context), do: @character_evolution_profile_ref
  defp profile_ref(:world_building_with_context), do: @world_building_profile_ref
  defp profile_ref(:prose_revision_from_findings), do: @revision_profile_ref
  defp profile_ref(:provider_progress), do: @provider_progress_profile_ref
  defp profile_ref(:readonly_batch_context), do: @readonly_batch_profile_ref
  defp profile_ref(:ledger_reconciliation), do: @ledger_reconciliation_profile_ref
  defp profile_ref(:fact_inventory), do: @fact_inventory_profile_ref

  defp allowed_tools(:profile_routing), do: @profile_routing_allowed_tools
  defp allowed_tools(:character_design_with_context), do: @character_allowed_tools
  defp allowed_tools(:prose_drafting_with_quality), do: @prose_allowed_tools

  defp allowed_tools(:judgment_plan),
    do:
      ~w(character_roster character_design character_evolution plot_outline world_building prose_writing)

  defp allowed_tools(:plot_outline_with_context), do: @plot_outline_allowed_tools
  defp allowed_tools(:character_evolution_with_context), do: @character_evolution_allowed_tools
  defp allowed_tools(:world_building_with_context), do: @world_building_allowed_tools
  defp allowed_tools(:prose_revision_from_findings), do: @revision_allowed_tools
  defp allowed_tools(:provider_progress), do: @provider_progress_allowed_tools
  defp allowed_tools(:readonly_batch_context), do: @readonly_batch_allowed_tools
  defp allowed_tools(:ledger_reconciliation), do: @ledger_reconciliation_allowed_tools
  defp allowed_tools(:fact_inventory), do: @fact_inventory_allowed_tools

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
