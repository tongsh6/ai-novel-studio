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
  alias NovelApplication.AgentRunFlows.ReadonlyBatchContext
  alias NovelApplication.AgentRunFlows.WorldBuildingWithContext
  alias NovelApplication.ChapterListBudget
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExplorationService
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnInteractionService
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
         |> Map.put(:context_fetcher, context_fetcher)
         |> Map.put_new(:trigger, %{kind: "user_message"}),
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
      interaction_store: Map.get(input, :interaction_store),
      interaction_input: Map.take(input, [:text, :candidate_selection, :generate_micro_plan]),
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

  defp plan_id(plan), do: Map.get(plan, :plan_id) || Map.get(plan, "plan_id")

  defp plan_version(plan), do: Map.get(plan, :version) || Map.get(plan, "version") || 1

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

  # 探索回合：普通探索（不同工具/问题）最多 2 轮；长章分页续读额外给 8 轮额度
  # （B27 CP4 M03：34k 字符长章需 6 页，旧 2 轮上限只读到 12,000 即被迫收束）。
  # 续读额度只在「上一观察仍是同一章未读完的正文页（next_offset 非 nil）」时开放，
  # 读完末页立即关闭；总探索步数仍有硬上界，预算按上界补足。
  @max_explore_rounds 2
  @max_chapter_continuation_rounds 8
  @max_explore_steps @max_explore_rounds + @max_chapter_continuation_rounds

  # 判断循环内联执行的计划步目标（只读、0 provider 调用；B27 CP4 M17）。
  @read_only_plan_targets ~w(context_assemble character_roster prose_search chapter_read archive_read memory_recall)
  @exploration_plan_targets ~w(prose_search chapter_read archive_read memory_recall)

  # 判断①能力目录（prompt 目录 + schema enum + 解析校验三处同源；dispatch 表
  # @judgment_capability_profiles 是按能力分派 profile 的超集，作者可选目录仍以本列表为准）。
  @judgment_capabilities ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)

  @judgment_capability_profiles %{
    "character_design" => :character_design_with_context,
    "character_evolution" => :character_evolution_with_context,
    "prose_writing" => :prose_drafting_with_quality,
    "plot_outline" => :plot_outline_with_context,
    "world_building" => :world_building_with_context,
    "work_archive_read" => :readonly_batch_context
  }

  # Q3a 语义对账只读集：由 dispatch 表编译期推导（profile=readonly_batch_context
  # 的能力），SSOT 单点——新增只读能力自动进对账口径，不另立第二张表。
  @judgment_readonly_capabilities for {cap, :readonly_batch_context} <-
                                        @judgment_capability_profiles,
                                      do: cap

  defp judgment_loop_next_step(run, sequence, snapshot, provider_execution, input) do
    state = judgment_stage_state(snapshot)

    cond do
      judgment_settled(state) == "completed" ->
        judgment_terminal(run, sequence, :complete, "本轮回应已生成。")

      judgment_settled(state) == "awaiting_author" ->
        judgment_terminal(run, sequence, :await_author, "等待作者说明后继续。")

      judgment_context(state) == nil ->
        judgment_context_next_step(run, sequence, input)

      state[:pending_artifact_request] != nil ->
        pending_artifact_next_step(run, sequence, provider_execution, input, state)

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
  # B24 CP2：上一页观察带 next_offset 时补一条续读提示（真实章标题 + 上一页 footer
  # 的 query），让模型知道可以继续读而不是重复同一页；目录 query 说明由
  # ExplorationService.catalog_section 单点产出（I-EXPLORE-READ-7）。
  defp exploration_sections(explorations, budget) do
    catalog = if budget.open?, do: "\n\n" <> ExplorationService.catalog_section(), else: ""

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

          "\n\n## 探索观察（已检索到的作品事实）\n\n" <>
            rendered <> coverage_note(list) <> continue_hint(list, budget)
      end

    catalog <> observations
  end

  # B27 CP4 retest2（task-22）：每轮给出机械覆盖事实（已读字符/总长/未读范围）。
  # 未覆盖末页时明确「不得声称已读全章」；已覆盖全章时明确「已覆盖全章」。
  defp coverage_note(explorations) do
    case List.last(explorations) do
      %{tool: "chapter_read"} = observation -> coverage_text_for(observation)
      _ -> ""
    end
  end

  defp coverage_text_for(observation) do
    total = Map.get(observation, :prose_total_chars)
    read_end = get_in(observation, [:prose_range, :end]) || Map.get(observation, :next_offset)
    coverage_text(total, read_end)
  end

  defp coverage_text(total, read_end)
       when is_integer(total) and is_integer(read_end) and read_end >= total,
       do: "\n\n（覆盖事实：本章正文已读 1–#{total}/#{total} 字符，已覆盖全章。）"

  defp coverage_text(total, read_end) when is_integer(total) and is_integer(read_end) do
    "\n\n（覆盖事实：本章正文已读 1–#{read_end}/#{total} 字符；" <>
      "未读 #{read_end + 1}–#{total} 字符，未覆盖末页——" <>
      "回答全章结论前必须继续读取，或在结论中明确已覆盖范围与未读缺口，" <>
      "不得声称已读全章。）"
  end

  defp coverage_text(_total, _read_end), do: ""

  # B27 CP4 M03：给模型显式「已读覆盖/总长/下一页」事实与续读阶段约束（事实段，
  # 不冒充全文；是否继续取证仍由模型判断）。
  defp continue_hint(explorations, budget) do
    observation = List.last(explorations)
    continuation = Map.get(budget, :continuation)

    if is_map(observation) and is_map(continuation) and
         is_integer(Map.get(continuation, :next_offset)) do
      "\n\n（本章还有未读正文：#{continuation_coverage(continuation)}#{continuation_unread(continuation)}；" <>
        "下一轮用 chapter_read + 上一页【续读】给出的 query 继续读取；不要重复读取同一页。" <>
        "未覆盖末页时不得声称已读全章，需继续读取或以明确缺口收束。#{continuation_stage(budget)}）"
    else
      ""
    end
  end

  defp continuation_coverage(%{total: total, read_end: read_end})
       when is_integer(total) and is_integer(read_end),
       do: "已读约 #{read_end}/#{total} 字符"

  defp continuation_coverage(_continuation), do: "本章尚未读完"

  defp continuation_unread(%{total: total, read_end: read_end})
       when is_integer(total) and is_integer(read_end) and read_end < total,
       do: "；未读 #{read_end + 1}–#{total} 字符"

  defp continuation_unread(_continuation), do: ""

  defp continuation_stage(budget) do
    if Map.get(budget, :continuation_only?, false),
      do: "本轮剩余探索额度只用于该章续读：必须继续读取后续页，读完末页（next_offset 为 null）后再给出结论。",
      else: ""
  end

  # ── B27 CP4 M03/M17：探索预算、计划内联执行、作品事实块 ──

  # 长章续读额度：普通探索 2 轮后，只要上一观察是同一章未读完的正文页
  # （next_offset 非 nil），额外开放最多 @max_chapter_continuation_rounds 轮续读。
  defp exploration_budget(explorations) do
    total = length(explorations)
    normal_open? = total < @max_explore_rounds
    continuation = continuation_target(List.last(explorations))
    extra = max(total - @max_explore_rounds, 0)
    continuation_open? = continuation != nil and extra < @max_chapter_continuation_rounds

    %{
      open?: normal_open? or continuation_open?,
      normal_open?: normal_open?,
      continuation_open?: continuation_open?,
      continuation_only?: not normal_open? and continuation_open?,
      continuation: continuation,
      total: total
    }
  end

  defp continuation_target(observation) when is_map(observation) do
    next_offset = Map.get(observation, :next_offset)

    if is_integer(next_offset) do
      %{
        chapter_ref: Map.get(observation, :chapter_ref),
        next_offset: next_offset,
        total: Map.get(observation, :prose_total_chars),
        read_end: get_in(observation, [:prose_range, :end]) || next_offset
      }
    end
  end

  defp continuation_target(_observation), do: nil

  # 只读计划：全部步 target 都属只读集合；返回需内联执行的探索步（context/roster 已就绪）。
  defp read_only_plan_steps(plan) when is_map(plan) do
    steps =
      case map_get(plan, :steps) do
        steps when is_list(steps) -> steps
        _ -> []
      end

    if steps != [] and
         Enum.all?(steps, &(map_get(&1, :target_tool_ref) in @read_only_plan_targets)) do
      Enum.filter(steps, &(map_get(&1, :target_tool_ref) in @exploration_plan_targets))
    else
      nil
    end
  end

  defp read_only_plan_steps(_plan), do: nil

  # M17：内联执行纯只读计划的探索步，观察写入 stage_state 后回到判断循环收束
  # （下一轮判断给最终作者可见结论/必要提问）。不切 profile、不产生 turn_result。
  defp execute_planned_explorations(
         judgment,
         _plan,
         steps,
         run,
         sequence,
         input,
         _context,
         snapshot
       ) do
    work_id = map_get(input, :work_id) || run.work_id || run.workspace_id
    log_judgment_decided(judgment, "judgment_plan_inline_explore", 0)
    explorations = judgment_explorations(judgment_stage_state(snapshot))

    observations =
      Enum.map(steps, fn step ->
        tool = map_get(step, :target_tool_ref)
        query = map_get(step, :exploration_query) || ""
        observation = run_inline_exploration(work_id, run, tool, query)

        emit_judgment_stage(
          snapshot,
          :exploration_observed,
          ExplorationService.activity_summary(observation),
          ["exploration_observed", tool],
          exploration_event_payload(tool, query, observation)
        )

        observation
      end)

    tools = Enum.map(steps, &map_get(&1, :target_tool_ref)) |> Enum.uniq()

    {:ok,
     %{
       step: judgment_agent_step(run, sequence, "按模型计划完成只读检索（#{length(observations)} 步）"),
       observations: [
         judgment_observation(
           run,
           sequence,
           "计划内只读检索完成：#{Enum.join(tools, " / ")}",
           "explore:plan:#{sequence}",
           %{stage: :exploration_observed, tools: tools, step_count: length(observations)}
         )
       ],
       stage_state: %{judgment_explorations: explorations ++ observations},
       provider_call_count: judgment.provider_call_count,
       progress_signature:
         "#{run.run_id}:explore:plan:#{length(explorations) + length(observations)}"
     }}
  end

  defp run_inline_exploration(work_id, run, tool, query) do
    case ExplorationService.run(work_id, tool, query, run.session_id) do
      {:ok, observation} ->
        observation

      {:error, reason} ->
        %{
          tool: tool,
          query: query,
          summary: "探索工具执行失败：#{inspect(reason)}",
          refs: [],
          activity_summary: ExplorationService.activity_failure_summary(tool)
        }
    end
  end

  # 作品事实块（B27 CP4 M01/M16/M20）：持久化只读投影，回答版本/完成度/统计问题。
  # 与「章节列表」分开：列表是索引，本段是当前 canon 的计数/版本/历史事实。
  defp judgment_work_facts_section(%DialogueContext{} = context) do
    chapters = context.structured_chapters || []
    written = Enum.filter(chapters, &(Map.get(&1, :has_prose) == true))
    snapshot = context.current_work_snapshot || %{}

    if written == [] and map_size(snapshot) == 0 do
      ""
    else
      lines =
        [whole_book_facts_line(snapshot, chapters)] ++
          Enum.map(written, &chapter_facts_line/1) ++
          session_adoption_facts_lines(context)

      "## 作品事实（持久化只读投影；版本/完成度/统计以本段为准，SUPERSEDED 不计入当前）\n" <>
        Enum.join(Enum.reject(lines, &(&1 in [nil, ""])), "\n")
    end
  end

  defp judgment_work_facts_section(_context), do: ""

  defp whole_book_facts_line(snapshot, chapters) do
    total = length(chapters)
    written = Enum.count(chapters, &(Map.get(&1, :has_prose) == true))
    planned = total - written
    chars = chapters |> Enum.map(&(Map.get(&1, :word_count) || 0)) |> Enum.sum()

    target =
      [
        snapshot_value(snapshot, :target_length, "目标总字数"),
        snapshot_value(snapshot, :planned_volumes, "预计卷数"),
        snapshot_value(snapshot, :serial_form, "连载形态")
      ]
      |> Enum.join("；")

    goal = snapshot_value(snapshot, :main_goal, "全书目标")

    "- 全书：#{goal}；#{target}；正文统计：#{total} 章中已写 #{written} 章、计划中 #{planned} 章" <>
      "；当前已采纳正文字符合计 #{chars}"
  end

  defp snapshot_value(snapshot, key, label) do
    case map_get(snapshot, key) do
      value when value in [nil, ""] -> "#{label}=未登记"
      value -> "#{label}=#{value}"
    end
  end

  defp chapter_facts_line(chapter) do
    seq = Map.get(chapter, :seq)
    title = Map.get(chapter, :title) || ""
    accepted = Map.get(chapter, :accepted_draft_count) || 0
    scenes = Map.get(chapter, :scene_count) || 0
    words = Map.get(chapter, :word_count) || 0
    refs = List.wrap(Map.get(chapter, :current_draft_refs))
    superseded = Map.get(chapter, :superseded_draft_count) || 0
    summary_status = Map.get(chapter, :summary_status) || "无当前采纳摘要"
    chapter_status = Map.get(chapter, :chapter_status) || "未知"
    plan_fields = chapter_plan_fields(chapter)

    "- 第#{seq}章「#{title}」：当前已采纳正文 #{accepted}/#{scenes} 场，共 #{words} 字符；" <>
      current_version_segment(refs) <>
      "；章摘要=#{summary_status}；历史 SUPERSEDED 稿 #{superseded} 份（不计入当前）；" <>
      "章状态=#{chapter_status}；章计划字段=#{plan_fields_label(plan_fields)}"
  end

  defp current_version_segment([]), do: "当前版本 refs=（无）"
  defp current_version_segment(refs), do: "当前版本 refs=" <> Enum.join(refs, ", ")

  defp plan_fields_label([]), do: "（未登记）"
  defp plan_fields_label(fields), do: Enum.join(fields, ", ")

  defp chapter_plan_fields(chapter) do
    case Map.get(chapter, :plan_direction) do
      %{} = direction -> direction |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()
      _ -> []
    end
  end

  defp session_adoption_facts_lines(%DialogueContext{interaction_state: state})
       when is_map(state) do
    pending = List.wrap(Map.get(state, :pending_adoptions))
    resolved = List.wrap(Map.get(state, :resolved_adoptions))

    if pending == [] and resolved == [] do
      []
    else
      canon =
        Enum.count(
          resolved,
          &(adoption_status(&1) in NovelDomain.AdoptionStatus.canon_statuses())
        )

      discarded =
        Enum.count(
          resolved,
          &(adoption_status(&1) == NovelFoundation.Enums.AdoptionStatus.discarded())
        )

      [
        "- 会话候选处置：pending #{length(pending)} 项（未采纳）；resolved #{length(resolved)} 项，" <>
          "其中 ACCEPTED/EDITED_ACCEPTED #{canon} 项、DISCARDED #{discarded} 项；" <>
          "候选处置/单段采纳不等于整章或全书叙事完成。"
      ]
    end
  end

  defp session_adoption_facts_lines(_context), do: []

  defp adoption_status(entry) do
    entry |> map_get(:adoption_status) |> to_string_or_empty()
  end

  defp to_string_or_empty(nil), do: ""
  defp to_string_or_empty(value), do: to_string(value)

  # 待采纳候选预览（B27 CP4 M07/M08）：真实 ref/类型/状态/可用操作/内容预览。
  # 预览为空时如实说明（来源回合可能未携带正文），并提示执行修订时系统会读取实际候选。
  defp judgment_pending_candidates_section(%DialogueContext{interaction_state: state})
       when is_map(state) do
    entries = List.wrap(Map.get(state, :pending_adoptions))

    if entries == [] do
      ""
    else
      lines = entries |> Enum.take(12) |> Enum.map(&pending_candidate_line/1)

      "## 待采纳候选（真实对象，status=TENTATIVE；body_preview 为空时不得据此编造内容）\n" <>
        Enum.join(lines, "\n")
    end
  end

  defp judgment_pending_candidates_section(_context), do: ""

  defp pending_candidate_line(entry) do
    ref = map_get(entry, :artifact_id)
    type = map_get(entry, :artifact_type)
    status = adoption_status(entry)
    operations = NovelApplication.PendingArtifactWorkflow.operations(entry)
    payload = map_get(entry, :payload) || %{}
    title = candidate_title(payload)
    body = candidate_body_preview(payload)

    body_text =
      if body == "",
        do: "（空：来源回合未携带候选正文预览；执行修订时系统读取实际候选内容，不得据此编造）",
        else: body

    "- ref=#{ref} | type=#{type} | status=#{status} | title=#{title || "（无标题）"}" <>
      " | operations=#{Enum.join(operations, "/")} | body_preview=#{body_text}"
  end

  defp candidate_title(payload) when is_map(payload) do
    case map_get(payload, :summary) do
      title when is_binary(title) ->
        title

      _ ->
        case map_get(payload, :items) do
          [item | _] -> map_get(item, :title)
          _ -> map_get(payload, :title)
        end
    end
  end

  defp candidate_title(_payload), do: nil

  defp candidate_body_preview(payload) when is_map(payload) do
    body =
      case map_get(payload, :content) do
        content when is_binary(content) ->
          content

        _ ->
          payload
          |> map_get(:items)
          |> List.wrap()
          |> Enum.map(&map_get(&1, :body))
          |> Enum.filter(&is_binary/1)
          |> Enum.join("\n\n")
      end

    String.slice(body, 0, 300)
  end

  defp candidate_body_preview(_payload), do: ""

  # Q1c：把 accepted 目标 ref 明确摆到判断上下文里，避免模型在 resolved 列表里猜
  # 或把“没有待采纳候选”误判成“没有修订能力”。
  defp adopted_content_targets_section(context) do
    targets = NovelApplication.PendingArtifactWorkflow.accepted_targets(context)

    if map_size(targets) == 0 do
      ""
    else
      lines =
        Enum.map_join(targets, "\n", fn {ref, operations} ->
          "- #{ref}：#{Enum.join(operations, " / ")}"
        end)

      "\n\n## 已采纳可修订对象（只用于 revise_adopted_content）\n#{lines}"
    end
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
        context_ref_count: length(context.context_refs)
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

  # B26：单调用响应整组校验后，按明确操作派发。
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

      # 模型纠正与执行前检查共用业务规则；无效操作不能发布为已裁决并进入创作分支。
      result =
        with {:ok, judgment} <-
               JudgmentProtocol.request_judgment(provider_execution, snapshot, protocol_input),
             :ok <-
               TurnInteractionService.validate_author_registration(
                 judgment,
                 protocol_input.options[:author_content_sources]
               ) do
          {:ok, judgment}
        end

      case result do
        {:ok, %{action: "explore"} = judgment} ->
          emit_judgment_decided(snapshot, judgment)
          judgment_explore_result(judgment, run, sequence, input, context, snapshot, explorations)

        {:ok, judgment} ->
          emit_judgment_decided(snapshot, judgment)
          dispatch_judgment(judgment, run, sequence, input, context, snapshot)

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp judgment_protocol_input(input, run, context, explorations) do
    budget = exploration_budget(explorations)
    explore_open? = budget.open?

    author_text = effective_author_text(input, run)

    %{
      author_text: author_text,
      source_input_ref: TurnInteractionService.input_ref(run),
      supplied_context_refs: Enum.map(context.context_refs, & &1.context_ref),
      observations: explorations,
      # B24 CP2（历史两段式时期修复，单调用后仍成立）：探索观察只在 context_block 渲染一次；
      # 这里只剩消息处置上下文（pending/resolved/registered sources）。
      author_content_context: TurnInteractionService.context_section(context.interaction_state),
      context_block:
        judgment_context_block(context, author_text) <>
          exploration_sections(explorations, budget) <>
          adopted_content_targets_section(context),
      options:
        [
          plan_run: %{run | profile_ref: "judgment_plan_v1"},
          capabilities:
            @judgment_capabilities ++ NovelApplication.PendingArtifactWorkflow.capabilities(),
          pending_artifact_targets: NovelApplication.PendingArtifactWorkflow.targets(context),
          adopted_content_targets:
            NovelApplication.PendingArtifactWorkflow.accepted_targets(context),
          registered_sources: TurnInteractionService.registered_sources(context),
          readonly_capabilities: @judgment_readonly_capabilities,
          author_content_sources:
            context
            |> TurnInteractionService.author_sources(TurnInteractionService.input_ref(run))
            |> Enum.map(& &1.turn_ref)
        ] ++
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

  defp dispatch_judgment(%{action: action} = judgment, run, sequence, input, context, _snapshot)
       when action in [
              "reply",
              "creative_directions",
              "author_content_registration",
              "capability_gap"
            ],
       do: finalize_judgment_reply(judgment, run, sequence, input, context, :completed)

  defp dispatch_judgment(
         %{action: "await_author"} = judgment,
         run,
         sequence,
         input,
         context,
         _snapshot
       ),
       do: finalize_judgment_reply(judgment, run, sequence, input, context, :awaiting_author)

  # CP4（ADR-0025 决策 2）：plan ≠ execute——判"复杂"进跨能力真计划 profile，
  # 计划由模型基于能力目录制定（judgment_plan flow 内起草，plan_drafted 照发）。
  # B27 CP4 M17：若模型计划只含只读探索步（无创作能力步），在判断循环内联执行这些
  # 检索步后**回到判断收束**（下一轮由模型给最终作者可见结论/提问），而不是切到
  # judgment_plan flow 耗尽后停等作者而没有结论。含创作步的计划仍走原 flow。
  defp dispatch_judgment(%{action: "plan"} = judgment, run, sequence, input, context, snapshot) do
    with {:ok, plan, _inline_meta} <-
           selected_judgment_plan(run, :judgment_plan, judgment),
         steps when is_list(steps) and steps != [] <- read_only_plan_steps(plan) do
      execute_planned_explorations(judgment, plan, steps, run, sequence, input, context, snapshot)
    else
      _ -> judgment_switch_result(:judgment_plan, judgment, input, run, sequence)
    end
  end

  defp dispatch_judgment(
         %{action: "execute"} = judgment,
         run,
         sequence,
         input,
         context,
         _snapshot
       ) do
    if judgment.capability in NovelApplication.PendingArtifactWorkflow.capabilities() do
      log_judgment_decided(judgment, :execution_candidate, 0)
      tool = NovelApplication.PendingArtifactWorkflow.execution_tool(judgment, context)

      {:ok,
       %{
         step: judgment_agent_step(run, sequence, "已理解候选处理要求"),
         observations: [
           judgment_observation(
             run,
             sequence,
             judgment.narrative,
             "judgment:#{run.parent_turn_ref}",
             %{stage: :judgment_decided}
           )
         ],
         stage_state: %{pending_artifact_request: judgment, pending_artifact_tool: tool},
         run_patch: %{
           authority_scope:
             Map.put(run.authority_scope, :allowed_tools, Enum.uniq(["judgment", tool]))
         },
         provider_call_count: judgment.provider_call_count,
         progress_signature:
           "#{run.run_id}:pending:#{judgment.pending_artifact_ref || judgment.adopted_content_ref}"
       }}
    else
      case Map.fetch(@judgment_capability_profiles, judgment.capability || "") do
        {:ok, profile} ->
          judgment_switch_result(profile, judgment, input, run, sequence)

        :error ->
          {:error, {:unknown_judgment_capability, judgment.capability}}
      end
    end
  end

  defp dispatch_judgment(judgment, _run, _sequence, _input, _context, _snapshot),
    do: {:error, {:unknown_judgment_action, judgment.action}}

  defp pending_artifact_next_step(run, sequence, provider, input, state) do
    with {:ok, decision} <-
           judgment_mech_decision(run, sequence, state.pending_artifact_tool, "处理已绑定的候选。", [
             "pending_artifact_operation"
           ]) do
      {:execute, pending_artifact_step(provider, input, state), decision,
       %{provider_call_count: 0, suppress_plan_event: true}}
    end
  end

  defp pending_artifact_step(provider, input, state) do
    fn run, seq, snapshot ->
      execution =
        provider
        |> Execution.with_purpose(:revision)
        |> NovelApplication.ProviderActivityProjector.with_stage_sink(snapshot)

      with {:ok, result} <-
             NovelApplication.PendingArtifactWorkflow.run(
               state.pending_artifact_request,
               input,
               run,
               judgment_context(state),
               execution
             ) do
        {:ok,
         Map.merge(result, %{
           step: judgment_agent_step(run, seq, "候选处理完成"),
           observations: [
             judgment_observation(run, seq, "候选处理结果已返回。", result.turn_result.turn_id, %{
               operation: state.pending_artifact_request.capability
             })
           ],
           stage_state: %{
             pending_artifact_request: nil,
             pending_artifact_tool: nil,
             judgment_settled: "completed"
           },
           progress_signature: "#{run.run_id}:pending:completed"
         })}
      end
    end
  end

  # reply / await_author 终结：判断结构机械转换 DialogueFrame（frame 语义并入判断①），
  # Trace / TurnResultBuilder 保持同源；结果与 trace 由运行时同事务提交，正文来自同一有效响应。
  defp finalize_judgment_reply(judgment, run, sequence, input, context, settle) do
    turn_id =
      if judgment.action == "await_author",
        do: NovelApplication.AuthorQuestion.turn_id(run, judgment),
        else: TurnInteractionService.input_ref(run)

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
      |> Map.put(
        :outcome,
        if(judgment.action == "capability_gap", do: "goal_unfulfilled", else: judgment.action)
      )
      |> maybe_attach_question(judgment, run)

    with {:ok, turn_result} <-
           maybe_attach_author_content(turn_result, judgment, input, run, context) do
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
         decision_trace: trace,
         stage_state: %{judgment_settled: settle_state(settle)},
         provider_call_count: judgment.provider_call_count,
         progress_signature: "#{run.run_id}:judgment:#{turn_id}"
       }}
    end
  end

  defp maybe_attach_question(result, %{action: "await_author"} = judgment, run),
    do: NovelApplication.AuthorQuestion.attach(result, judgment, run)

  defp maybe_attach_question(result, _, _), do: result

  defp settle_state(:completed), do: "completed"
  defp settle_state(:awaiting_author), do: "awaiting_author"

  # Q3c 作者内容物化（R1）：判断①置 author_content_registration=true（模型判定）
  # 时，把作者消息字节机械物化为待采纳 world_setting 候选——写入大门（作者采纳）
  # 不再只放模型的东西。来源缺失或空文本诚实失败，不用存档指令替代历史原文。
  defp maybe_attach_author_content(turn_result, judgment, input, run, context) do
    if judgment.action == "author_content_registration" do
      current_ref = TurnInteractionService.input_ref(run)

      input_bytes =
        if run.goal.version > 1, do: run.goal.text, else: map_get(input, :text) || run.goal.text

      with {:ok, source_ref, text} <-
             TurnInteractionService.source_text(
               judgment[:author_content_source_ref],
               TurnInteractionService.current_text(
                 context,
                 current_ref,
                 input_bytes
               ),
               context,
               current_ref
             ) do
        attach_author_source(turn_result, context, source_ref, text)
      end
    else
      {:ok, turn_result}
    end
  end

  defp attach_author_source(turn_result, context, source_ref, text) do
    turn_result =
      Map.update!(
        turn_result,
        :trace_summary,
        &Map.put(&1, :registration_source_ref, "author_input:#{source_ref}")
      )

    if TurnInteractionService.materialized_source?(context, source_ref) do
      {:ok, turn_result}
    else
      with {:ok, artifact_set} <-
             NovelApplication.ArtifactAssembler.assemble_author_content(
               turn_result.turn_id,
               text,
               source_ref
             ) do
        LogEmit.emit(:judgment, :author_content_materialized, :done, %{
          artifact_set_id: artifact_set.artifact_set_id,
          artifact_type: to_string(artifact_set.artifact_type)
        })

        {:ok, TurnResultBuilder.attach_author_artifact(turn_result, artifact_set)}
      end
    end
  end

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
  defp judgment_explore_result(judgment, run, sequence, input, _context, snapshot, explorations) do
    %{tool: tool, query: query} = judgment.explore_request
    work_id = map_get(input, :work_id) || run.work_id || run.workspace_id
    log_judgment_decided(judgment, "judgment_explore", 0)

    observation = run_inline_exploration(work_id, run, tool, query)

    # B24 CP2（I-EXPLORE-READ-8）：作者可见活动行用集中人类可读文案——内部工具 id /
    # 原始 query JSON / offset 只留在 payload/trace/developer 面。
    activity = ExplorationService.activity_summary(observation)

    emit_judgment_stage(
      snapshot,
      :exploration_observed,
      activity,
      ["exploration_observed", tool],
      exploration_event_payload(tool, query, observation)
    )

    {:ok,
     %{
       step: judgment_agent_step(run, sequence, activity),
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
       # B24 CP2（I-EXPLORE-READ-5）：signature 去掉 sequence——同 tool+同 query
       # （含 offset）才命中 no-progress；不同 offset 的合法续读不误停。
       progress_signature: "#{run.run_id}:explore:#{tool}:#{query}"
     }}
  end

  # B24 §1.1(c)：observation 元数据进 developer payload（chapter_ref 供验收独立核对
  # ref 寻址；作者可见文本只用 activity_summary）。nil 值不写入——wire 的
  # author-safe payload 会把 atom（含 nil）字符串化，保留 null 会被误读。
  defp exploration_event_payload(tool, query, observation) do
    base = %{
      stage: :exploration_observed,
      tool: tool,
      query: query,
      refs: observation.refs,
      summary: observation.summary
    }

    [:chapter_ref, :chapter_seq, :next_offset, :prose_total_chars, :prose_range]
    |> Enum.reduce(base, fn key, acc ->
      case Map.get(observation, key) do
        nil -> acc
        value -> Map.put(acc, key, value)
      end
    end)
  end

  # execute/plan：切换到能力 profile（等价旧路由；计划起草→机械 cursor 沿用）。
  defp judgment_switch_result(profile, judgment, input, run, sequence) do
    log_judgment_decided(judgment, "judgment_" <> judgment.action, 0)
    selection = judgment_selection(judgment, profile)

    with {:ok, target_plan, inline_meta} <- selected_judgment_plan(run, profile, judgment) do
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
           inline_plan_meta: inline_meta,
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

  defp selected_judgment_plan(run, :judgment_plan, %{plan_result: result}) when is_map(result) do
    planned_run = %{run | profile_ref: profile_ref(:judgment_plan)}

    NovelApplication.AgenticPlanDraftPlanner.plan_from_result(planned_run, result)
  end

  defp selected_judgment_plan(run, profile, _judgment) do
    with {:ok, plan} <- agent_run_agent_plan(run.run_id, profile), do: {:ok, plan, nil}
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

  # 判断结构 → DialogueFrame 机械转换（非预制创作决策：全部字段来自模型判断输出）。
  defp judgment_frame(judgment, turn_id, ws_id, %DialogueContext{} = context) do
    frame_type = reply_frame_type(judgment.frame_type)

    context_ref = "context:#{context.workspace_id}"

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id:
        "frame_" <>
          NovelApplication.AuthorQuestion.hash(
            {turn_id, judgment.narrative_source.provider_call_ref}
          ),
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: frame_type,
      source_refs: %{
        author_input_ref: "author_input:#{judgment.reply_record.source_input_ref || turn_id}",
        dialogue_context_ref: context_ref
      },
      dialogue_goal: %{summary: judgment.dialogue_goal || judgment.author_input},
      tool_need: %{
        needs_tool: false,
        reason_code:
          if(judgment.action == "reply",
            do: :no_tool_requested,
            else: reply_reason_code(frame_type)
          )
      },
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: judgment.narrative},
      evidence_summary: %{
        action: judgment.action,
        frame_origin:
          if(judgment.action == "reply", do: "application_display_default", else: "model_tool"),
        goal_origin: if(judgment.dialogue_goal, do: "model_tool", else: "author_input"),
        model_interpretation_status: judgment.model_interpretation_status,
        model_interpretation:
          if(judgment.action == "reply", do: nil, else: %{goal: judgment.dialogue_goal}),
        reply_record: judgment.reply_record,
        author_narrative_source: judgment.narrative_source
      },
      uncertainty: []
    }
  end

  defp reply_frame_type("creative_exploration"), do: :creative_exploration
  defp reply_frame_type("question_answer"), do: :question_answer
  defp reply_frame_type("meta_discussion"), do: :meta_discussion
  defp reply_frame_type("capability_gap"), do: :capability_gap
  defp reply_frame_type(_), do: :casual_reply

  defp reply_reason_code(:creative_exploration), do: :exploratory_only
  defp reply_reason_code(:meta_discussion), do: :user_requested_discussion

  # Q3b：缺口轮目标明确、只是无能力承接——不属「目标不明」，语义精确单列。
  defp reply_reason_code(:capability_gap), do: :capability_gap
  defp reply_reason_code(_), do: :no_tool_needed

  # 候选随判断结构携带（S2 保全）：字节绑定 provider tool arguments（I1/I3 语义不变）。
  # 判定探索但有效候选为空（坏结构/空标题）→ 应用兜底候选（与 frame 路径同一份，
  # Planner.fallback_candidates——S2 韧性语义平移）。
  defp judgment_candidates(%{candidate_directions: directions}, frame_id) do
    candidates =
      directions
      |> Enum.with_index()
      |> Enum.map(fn {c, index} ->
        %CandidateDirection{
          direction_id: "dir_" <> NovelApplication.AuthorQuestion.hash({frame_id, index}),
          title: map_get(c, :title),
          pitch: map_get(c, :pitch),
          tone_tags: map_get(c, :tone_tags) || [],
          source_frame_ref: frame_id,
          risk_hint: :low,
          adoption_status: :not_adopted
        }
      end)
      |> Enum.filter(&(&1.title != "" and &1.pitch != ""))

    candidates
  end

  defp scope_judgment_turn_result(turn_result, input, run) do
    turn_result
    |> Map.put_new(:workspace_id, map_get(input, :workspace_id) || run.workspace_id)
    |> Map.put_new(:work_id, map_get(input, :work_id) || run.work_id || run.workspace_id)
    |> Map.put_new(:session_id, map_get(input, :session_id) || run.session_id)
  end

  # 判断①的 L2/L3 上下文段（机械准备渲染）。L1（角色句 + 能力目录）由
  # `JudgmentProtocol` 的公共前缀统一产出，使同 profile 连续两轮共享 L0–L1；
  # 章节段拆为 L2 稳定列表（不消费作者输入）与 L3 作者点名补充。
  # 探针与生产共用同一真源（MBC 的上下文必须是被测代码真实产出的字节）。
  @doc false
  @spec judgment_context_block(NovelDomain.DialogueContext.t(), String.t()) :: String.t()
  def judgment_context_block(context, author_text) do
    [
      judgment_work_section(context),
      judgment_work_facts_section(context),
      judgment_stable_chapters_section(context),
      judgment_pending_candidates_section(context),
      judgment_named_chapters_section(context, author_text),
      judgment_conversation_section(context),
      TurnInteractionService.context_section(context.interaction_state),
      context.open_behavior_summary || ""
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

  # T2a（长上下文病灶结构性收口，历史两段式时期发现）：章节段有界投影——超限时首章+最近 N。
  # CP-C（VS-00I §4）：稳定列表不消费作者输入（L2）；作者点名章在 L3 单独补充，
  # 保证连续两轮的 L0–L2 字节恒定；target_chapter 精确复制契约在判断与计划调用均适用。
  # Order 7-④（M2 实锤：标头"已写章节共17章"实际12章有正文）：标头区分已写/
  # 计划中，未写正文的章标注「（计划中）」——判断器对写作进度的认知不再被计划章污染。
  defp judgment_stable_chapters_section(
         %DialogueContext{current_chapters: [_ | _] = chapters} = context
       ) do
    entries = chapter_index_entries(context, chapters)
    {listed, omitted} = ChapterListBudget.project_entries(entries, nil)
    planned_count = Enum.count(entries, &(Map.get(&1, :has_prose) == false))
    written_count = length(entries) - planned_count

    "## 章节列表（共 #{length(entries)} 章：已写 #{written_count} 章，计划中 #{planned_count} 章）\n" <>
      ChapterListBudget.render_entry_lines(listed, omitted, length(entries)) <>
      "\n（回答写作进度时以「已写」计数为准；标注（计划中）的章尚无正文。各章正文细节不在本段内；作者点名章见下段。）"
  end

  defp judgment_stable_chapters_section(_context), do: ""

  defp judgment_named_chapters_section(
         %DialogueContext{current_chapters: [_ | _] = chapters} = context,
         author_text
       ) do
    entries = chapter_index_entries(context, chapters)
    {listed, _omitted} = ChapterListBudget.project_entries(entries, nil)
    stable_keys = MapSet.new(listed, &entry_key/1)

    named_titles =
      entries
      |> Enum.map(&entry_title/1)
      |> ChapterListBudget.named_chapter_titles(author_text)
      |> MapSet.new()

    supplement =
      entries
      |> Enum.filter(&MapSet.member?(named_titles, entry_title(&1)))
      |> Enum.reject(&MapSet.member?(stable_keys, entry_key(&1)))

    case supplement do
      [] ->
        ""

      named_entries ->
        "## 作者点名章（本轮请求涉及；target_chapter 从此段或「章节列表」精确复制全名）\n" <>
          ChapterListBudget.render_entry_lines(named_entries, 0, length(entries))
    end
  end

  defp judgment_named_chapters_section(_context, _author_text), do: ""

  # B24（I-EXPLORE-READ-9 双面身份）：判断 L2 章节索引同时给出 chapter_ref（模型寻址）、
  # seq（人类序号）与 title（展示）。有 structured_chapters（生产路径）时用其 id/seq；
  # 手工构造的上下文只有标题时退回旧标题行（不伪造 ref）。
  defp chapter_index_entries(%DialogueContext{} = context, chapters) when is_list(chapters) do
    case chapter_index_entries_from_structured(context) do
      entries when is_list(entries) -> entries
      _ -> title_chapter_entries(chapters)
    end
  end

  defp chapter_index_entries_from_structured(%DialogueContext{structured_chapters: structured})
       when is_list(structured) and structured != [] do
    case structured |> Enum.map(&chapter_index_entry/1) |> Enum.reject(&is_nil/1) do
      [] -> nil
      entries -> entries
    end
  end

  defp chapter_index_entries_from_structured(_context), do: nil

  defp chapter_index_entry(chapter) when is_map(chapter) do
    case Map.get(chapter, :title) do
      title when is_binary(title) ->
        if String.trim(title) == "" do
          nil
        else
          %{
            title: String.trim(title),
            seq: Map.get(chapter, :seq),
            id: Map.get(chapter, :id),
            has_prose: Map.get(chapter, :has_prose, true)
          }
        end

      _ ->
        nil
    end
  end

  defp chapter_index_entry(_chapter), do: nil

  defp title_chapter_entries(chapters) do
    chapters
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&%{title: String.trim(&1), seq: nil, id: nil, has_prose: true})
    |> Enum.reject(&(&1.title == ""))
  end

  defp entry_title(entry), do: Map.get(entry, :title, "")

  defp entry_key(entry), do: {entry_title(entry), Map.get(entry, :seq), Map.get(entry, :id)}

  defp judgment_conversation_section(%DialogueContext{conversation_summary: summary})
       when is_binary(summary) and summary != "" do
    "## 会话摘要\n#{summary}"
  end

  defp judgment_conversation_section(_context), do: ""

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
        model_interpretation_status: judgment.model_interpretation_status,
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
      :readonly_batch_context
    ]
  end

  defp routed_profile_budget(text, profile, input) do
    base = run_budget(text, profile, input)

    # +2 = 判断循环入场开销上界：机械准备 1 step（0 调用）+ 判断①单调用 1 次 + 一次有界纠错余量；
    # 计划/续行额外调用由 plan_overhead_budget/1 统一补足（上界 backstop 不是配额）。
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
      assumption_reader: map_get(input, :assumption_reader),
      # B11A CP3：开新卷动作的机械规划范围（judgment 阶段透传，plot_outline 步消费）。
      volume_scope: map_get(input, :volume_scope)
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
      # B11A CP3：开新卷动作的机械规划范围（scope-aware prompt/分卷指令）。
      volume_scope: map_get(input, :volume_scope),
      # WR02：规划前推理的账面/进度读端口（测试可注入）。
      ledger_reader: map_get(input, :ledger_reader),
      written_progress_reader: map_get(input, :written_progress_reader),
      # CA04 G2：规划带作品事实/风格。
      memory_reader: map_get(input, :memory_reader),
      # WR01c：规划使命的作者版读端口与暂定写端口（测试可注入）。
      planning_mission_reader: map_get(input, :planning_mission_reader),
      planning_mission_writer: map_get(input, :planning_mission_writer)
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

  defp run_budget(text, profile, input) do
    text
    |> run_budget(profile)
    |> plan_overhead_budget()
    |> apply_author_limit(input)
  end

  defp apply_author_limit(budget, input) do
    case map_get(input, :author_limits) do
      %{max_steps: steps} when is_integer(steps) and steps > 0 ->
        budget
        |> Map.put(:author_max_steps, steps)
        |> Map.put(:max_steps, min(budget.max_steps, steps))

      %{"max_steps" => steps} when is_integer(steps) and steps > 0 ->
        budget
        |> Map.put(:author_max_steps, steps)
        |> Map.put(:max_steps, min(budget.max_steps, steps))

      _ ->
        budget
    end
  end

  # 判断②续行余量（ADR-0025 CP3）：续行判断为单调用；模型计划修订已被判断②取代——
  # 每次续行 = 判断②单调用 1 + 续行重产出步（占 1 步 1 工具、prose 双调用上界 2），
  # 三维各按 max_replans 补足 backstop 余量（上限是兜底不是配额，不按最小调用裁剪）。
  # 旧的 max_steps: 1 指纹分支保留为防御性代码，但不再由文本触发；
  # 结构化作者预算在 run_budget/3 之后通过 author_max_steps 进入。
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
        run_budget(text, :readonly_batch_context)
      ]

    # +2 = 判断循环入场开销上界：机械准备 1 step（0 调用）+ 判断①单调用 1 次 + 一次有界纠错余量；
    # 计划/续行额外调用由 run_budget/3 的 plan_overhead_budget/1 统一补足。
    # CP5a 探索余量（上界 backstop 非配额）：每回合 = 探索步 1 step（0 调用）+
    # 再判断 1 step（单调用，含纠错余量）；B27 CP4 M03 起含长章续读额度
    # （普通探索 2 轮 + 同章续读最多 8 轮，续读在读完末页即关闭）。
    explore_allowance = @max_explore_steps * 2

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
  defp allowed_tools(:readonly_batch_context), do: @readonly_batch_allowed_tools
  defp allowed_tools(:ledger_reconciliation), do: @ledger_reconciliation_allowed_tools
  defp allowed_tools(:fact_inventory), do: @fact_inventory_allowed_tools

  # 旧的字面预算短语兼容已移除。作者步数约束必须通过结构化
  # UserMessageSubmission.author_limits 进入，不再解析自然语言。
  defp one_step_budget?(_text), do: false

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
