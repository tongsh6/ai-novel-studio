defmodule NovelApplication.AgenticPlanDraftPlanner do
  @moduledoc """
  Provider-backed AgentPlan drafter for ADR-0023 plan-driven AgentRun loops.

  The drafter produces an author-visible AgentPlan track. It does not approve
  execution; runtime still turns each plan step into an AgentStep/MicroPlan path.

  两段式调用协议（ADR-0023 修订注记 2026-07-05）：先自由输出 reasoning（content
  流式逐字显示给作者），再强制 native tool call 产计划结构；规划调用成本 ×2 是
  用户拍板的体验优先决策。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.{AgentObservation, AgentPlan, AgentRun}

  @max_failed_planner_output_chars 600
  @draft_tool_name "agent_plan_draft"
  @revision_tool_name "agent_plan_revision"

  @type provider_execution :: Execution.dependency()

  @spec draft_plan_with_meta(AgentRun.t(), provider_execution(), map(), keyword()) ::
          {:ok, AgentPlan.t(), map()} | {:error, term()}
  def draft_plan_with_meta(%AgentRun{} = run, provider_execution, snapshot \\ %{}, opts \\ []) do
    chapter_titles = chapter_titles(run, opts)

    request_plan_with_meta(
      run,
      provider_execution,
      snapshot,
      draft_reasoning_prompt(run, snapshot, chapter_titles),
      &draft_structure_prompt(run, snapshot, chapter_titles, &1),
      @draft_tool_name,
      &draft_meta/2
    )
  end

  @spec revise_plan_with_meta(AgentRun.t(), provider_execution(), map(), keyword()) ::
          {:ok, AgentPlan.t(), map()} | {:error, term()}
  def revise_plan_with_meta(%AgentRun{} = run, provider_execution, snapshot \\ %{}, opts \\ []) do
    revision_reason =
      opts
      |> Keyword.get(:revision_reason, Keyword.get(opts, :reason))
      |> nonblank()
      |> Kernel.||("计划步骤已走完，但完成条件尚未成立。")

    revision_run = %{run | plan_version: next_plan_version(run)}
    chapter_titles = chapter_titles(run, opts)

    request_plan_with_meta(
      revision_run,
      provider_execution,
      snapshot,
      revision_reasoning_prompt(run, snapshot, chapter_titles, revision_reason),
      &revision_structure_prompt(run, snapshot, chapter_titles, revision_reason, &1),
      @revision_tool_name,
      &revision_meta(&1, &2, revision_reason)
    )
  end

  # 规划期机械准备（ADR-0025）：作品章节全名列表由应用层确定性读取后注入 prompt，
  # 不问模型。target_chapter 契约（精确复制列表全名）没有这份列表就无法履行——缺席时
  # 点名章的正文请求会被缺失策略误判为"点名了不存在的章"而硬阻断。读取失败按无章节处理。
  defp chapter_titles(%AgentRun{} = run, opts) do
    reader =
      Keyword.get(opts, :chapter_titles_reader) ||
        NovelApplication.persistence_chapter_titles_reader()

    with true <- is_function(reader, 1),
         titles when is_list(titles) <- safe_chapter_titles(reader, run.workspace_id) do
      Enum.filter(titles, &(is_binary(&1) and String.trim(&1) != ""))
    else
      _ -> []
    end
  end

  defp safe_chapter_titles(reader, workspace_id) do
    reader.(workspace_id)
  rescue
    _error -> []
  end

  # 两段式调用（ADR-0023 修订注记 2026-07-05，用户拍板体验优先）：
  # 第一段自由输出 reasoning——content 可流式，作者逐字看到模型在想什么；
  # 第二段强制 native tool call 产计划结构，prompt 内嵌第一段 reasoning。
  # 叙事优先绑定第一段 content；第一段空 content 时回退第二段 arguments.author_reasoning。
  defp request_plan_with_meta(
         %AgentRun{} = run,
         provider_execution,
         snapshot,
         reasoning_prompt,
         structure_prompt_fun,
         tool_name,
         meta_fun
       )
       when is_function(meta_fun, 2) do
    with {:ok, reasoning_fn} <- plan_result_fn(provider_execution, snapshot, :author_reasoning),
         {:ok, structure_fn} <- plan_result_fn(provider_execution, snapshot, :planner),
         {:ok, reasoning_text, reasoning_result} <-
           request_reasoning(reasoning_prompt, reasoning_fn) do
      request_plan(structure_prompt_fun.(reasoning_text), %{
        tool_name: tool_name,
        result_fn: structure_fn,
        run: run,
        attempt: 1,
        retry?: true,
        meta_fun: meta_fun,
        reasoning_text: reasoning_text,
        reasoning_result: reasoning_result
      })
    end
  end

  defp plan_result_fn(provider_execution, snapshot, purpose) do
    result_fn =
      provider_execution
      |> Execution.with_purpose(purpose)
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: purpose)
      |> Execution.result_fn()

    case result_fn do
      result_fn when is_function(result_fn, 1) -> {:ok, result_fn}
      nil -> {:error, :provider_execution_required}
      other -> {:error, {:invalid_plan_draft_provider, other}}
    end
  end

  defp request_reasoning(prompt, result_fn) do
    case result_fn.(prompt) do
      {:ok, %{content: content} = provider_result} ->
        {:ok, nonblank(content), provider_result}

      {:ok, %{"content" => content} = provider_result} ->
        {:ok, nonblank(content), provider_result}

      {:ok, content} when is_binary(content) ->
        {:ok, nonblank(content), %{content: content}}

      {:error, reason} ->
        {:error, reason}

      other ->
        {:error, {:invalid_plan_reasoning_result, other}}
    end
  end

  defp request_plan(prompt, ctx) do
    ctx = Map.put(ctx, :prompt, prompt)

    case ctx.result_fn.(prompt) do
      {:ok, %{content: content} = provider_result} ->
        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(Map.merge(ctx, %{content: content, provider_result: provider_result}))

      {:ok, %{"content" => content} = provider_result} ->
        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(Map.merge(ctx, %{content: content, provider_result: provider_result}))

      {:ok, content} when is_binary(content) ->
        provider_result = %{content: content, tool_calls: []}

        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(Map.merge(ctx, %{content: content, provider_result: provider_result}))

      {:error, reason} ->
        {:error, reason}

      other ->
        {:error, {:invalid_plan_draft_result, other}}
    end
  end

  defp build_or_retry_plan({:ok, parsed}, ctx) do
    with {:ok, reasoning, origin, source_result} <- resolve_narrative(ctx, parsed),
         {:ok, plan} <- build_plan(ctx.run, parsed),
         :ok <- validate_plan_targets(ctx.run, plan),
         {:ok, narrative_source} <-
           narrative_source(source_result, reasoning, origin, ctx.tool_name) do
      base_meta = %{
        # +1 = 前置流式 reasoning 调用
        provider_call_count: ctx.attempt + 1,
        summary: reasoning,
        author_narrative_source: narrative_source,
        reason_codes: reason_codes(parsed),
        confidence: confidence(parsed)
      }

      {:ok, plan, ctx.meta_fun.(plan, base_meta)}
    else
      {:error, reason} -> retry_or_error(reason, ctx)
    end
  end

  defp build_or_retry_plan({:error, reason}, ctx), do: retry_or_error(reason, ctx)

  defp retry_or_error(reason, %{retry?: true} = ctx) do
    ctx.prompt
    |> tool_call_correction_prompt(ctx.content, reason)
    |> request_plan(%{ctx | attempt: ctx.attempt + 1, retry?: false})
  end

  defp retry_or_error(reason, _ctx), do: {:error, reason}

  # 叙事解析：优先第一段流式 reasoning 的 content 字节（作者已逐字看到）；
  # 第一段空 content 时回退结构调用 content，再回退 arguments.author_reasoning
  # 必填字段——字节仍归模型，N-NARR 溯源走 provider_output_tool_narrative 绑定。
  defp resolve_narrative(%{reasoning_text: text, reasoning_result: result}, _parsed)
       when is_binary(text) do
    {:ok, text, :content, result}
  end

  defp resolve_narrative(ctx, parsed) do
    content =
      ctx.provider_result
      |> map_get(:content)
      |> to_string()
      |> String.trim()

    tool_reasoning =
      parsed
      |> map_get(:author_reasoning)
      |> to_string()
      |> String.trim()

    cond do
      content != "" -> {:ok, content, :content, ctx.provider_result}
      tool_reasoning != "" -> {:ok, tool_reasoning, :tool_arguments, ctx.provider_result}
      true -> {:error, :reasoning_text_required}
    end
  end

  defp draft_meta(_plan, meta), do: meta

  defp revision_meta(plan, meta, revision_reason) do
    plan_version = plan.version || 1

    meta
    |> Map.put(:evaluation_of_last, %{
      advanced: false,
      plan_holds: false,
      new_constraint: revision_reason
    })
    |> Map.put(:plan_revision, %{
      plan_version: plan_version,
      revision_reason: revision_reason
    })
    |> Map.update(:reason_codes, ["agent_plan_revised"], fn codes ->
      ["agent_plan_revised" | string_list(codes)]
      |> Enum.uniq()
    end)
  end

  defp build_plan(%AgentRun{} = run, parsed) when is_map(parsed) do
    steps =
      parsed
      |> plan_steps()
      |> Enum.with_index(1)
      |> Enum.map(fn {step, index} -> normalize_plan_step(step, index) end)

    AgentPlan.new(%{
      plan_id: run.plan_ref || "ap_#{run.run_id}",
      run_ref: run.run_id,
      version: run.plan_version || 1,
      goal_version: run.goal.version,
      steps: steps
    })
  end

  defp plan_steps(parsed) do
    cond do
      is_list(map_get(parsed, :steps)) ->
        map_get(parsed, :steps)

      is_map(map_get(parsed, :plan)) and is_list(map_get(map_get(parsed, :plan), :steps)) ->
        map_get(map_get(parsed, :plan), :steps)

      true ->
        []
    end
  end

  defp normalize_plan_step(step, index) when is_map(step) do
    target = map_get(step, :target_tool_ref)

    %{
      step_id: nonblank(map_get(step, :step_id)) || "plan_step_#{index}",
      kind: map_get(step, :kind) || kind_for_target(target),
      status: :pending,
      description: nonblank(map_get(step, :description)) || "执行计划步骤 #{index}",
      success_criteria: string_list(map_get(step, :success_criteria)),
      depends_on: string_list(map_get(step, :depends_on)),
      target_tool_ref: nonblank(target),
      write_intent: write_intent(step, target),
      risk_hint: risk_hint(step),
      authoring_intent: nonblank(map_get(step, :authoring_intent)),
      target_chapter: nonblank(map_get(step, :target_chapter)),
      requested_chapter_raw: nonblank(map_get(step, :requested_chapter_raw))
    }
  end

  defp normalize_plan_step(_step, index) do
    %{
      step_id: "plan_step_#{index}",
      kind: :explore,
      status: :pending,
      description: "执行计划步骤 #{index}",
      success_criteria: [],
      depends_on: [],
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :low,
      authoring_intent: nil,
      target_chapter: nil,
      requested_chapter_raw: nil
    }
  end

  defp kind_for_target("prose_writing"), do: :act
  defp kind_for_target(_target), do: :explore

  defp write_intent(_step, "prose_writing"), do: :tentative

  defp write_intent(step, _target),
    do: if(map_get(step, :write_intent) == "tentative", do: :tentative, else: :none)

  defp risk_hint(step) do
    case map_get(step, :risk_hint) do
      value when value in [:low, :medium, :high] -> value
      "medium" -> :medium
      "high" -> :high
      _ -> :low
    end
  end

  defp validate_plan_targets(%AgentRun{} = run, %AgentPlan{steps: steps}) do
    allowed = MapSet.new(allowed_targets(run))

    invalid =
      steps
      |> Enum.map(& &1.target_tool_ref)
      |> Enum.filter(&(is_nil(&1) or not MapSet.member?(allowed, &1)))

    case invalid do
      [] -> :ok
      _ -> {:error, {:plan_step_target_not_allowed, Enum.uniq(invalid)}}
    end
  end

  # 起草校验的合法目标集必须与各 flow 机械执行器实际接受的 PlanStep 目标一致
  # （见各 flow 的 mechanical_execute_decision），而不是 authority_scope.allowed_tools：
  # 对话等 profile 的创作工具由 strategy_gate 裁决后在回应管线内调用，不是独立计划步。
  # 二者不一致会让模型起草出「校验合法、执行被拒」的计划（stage 实锤：
  # conversation 计划带独立 world_building 步 → {:invalid_plan_step_target, ...} 硬失败）。
  defp allowed_targets(%AgentRun{} = run) do
    case plan_step_targets(run.profile_ref) do
      targets when is_list(targets) ->
        targets

      nil ->
        tools =
          run.authority_scope
          |> map_get(:allowed_tools)
          |> string_list()

        Enum.uniq(tools ++ internal_observation_steps(run.profile_ref))
    end
  end

  defp plan_step_targets("conversation_turn_v1"),
    do: ["context_assemble", "dialogue_frame", "strategy_gate", "response_finalize"]

  defp plan_step_targets("prose_drafting_with_quality_v1"),
    do: ["context_assemble", "prose_writing"]

  defp plan_step_targets("character_design_with_context_v1"),
    do: ["character_roster", "character_design"]

  defp plan_step_targets("plot_outline_with_context_v1"),
    do: ["context_assemble", "plot_outline"]

  defp plan_step_targets("character_evolution_with_context_v1"),
    do: ["context_assemble", "character_evolution"]

  defp plan_step_targets("world_building_with_context_v1"),
    do: ["context_assemble", "world_building"]

  # CP4（ADR-0025 决策 2 计划按需）：判断①判"复杂"时的跨能力真计划——
  # 能力目录为可选目标集，步序由模型按作者请求的实际阶段制定。
  defp plan_step_targets("judgment_plan_v1"),
    do: [
      "context_assemble",
      "character_roster",
      "character_design",
      "character_evolution",
      "plot_outline",
      "world_building",
      "prose_writing"
    ]

  defp plan_step_targets("provider_progress_v1"), do: ["provider_complete"]

  defp plan_step_targets("readonly_batch_context_v1"), do: ["readonly_batch"]

  defp plan_step_targets("prose_revision_from_findings_v1"),
    do: ["revision_prepare", "revision_plan", "prose_writing", "revision_finalize"]

  defp plan_step_targets(_profile_ref), do: nil

  defp draft_context_block(%AgentRun{} = run, snapshot, chapter_titles) do
    """
    ## 当前 AgentRun
    - run_id: #{run.run_id}
    - profile_ref: #{run.profile_ref}
    - goal_version: #{run.goal.version}
    - author_goal: #{run.goal.text}
    - plan_step_targets: #{Enum.join(allowed_targets(run), ", ")}
    - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}
    - stage_state_keys: #{stage_state_keys(snapshot)}
    #{accepted_chapters_section(chapter_titles)}
    ## 计划要求
    - 计划必须是当前作者目标的 per-run 动态计划，不要复述固定模板。
    - 每个 PlanStep 必须有 target_tool_ref，且只能来自 plan_step_targets；不在该列表中的能力（即使作品允许使用）不能作为独立 PlanStep。
    - 能力目录中的「依赖」声明是硬约束：被依赖的步骤必须出现在计划中，且排在使用它的步骤之前，不可省略。
    - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，列表中没有对应章或无法确定时填 null。
    - 只起草计划，不声称已经执行，不输出工具结果。
    - 普通路径应覆盖完成目标所需最少步骤；不要添加纯收束模型调用。
    """
    |> String.trim()
  end

  # 与旧 Planner accepted_chapters_section 同一契约措辞：target_chapter 只能是列表全名。
  defp accepted_chapters_section([]), do: ""

  defp accepted_chapters_section(chapter_titles) do
    listed = Enum.map_join(chapter_titles, "\n", &"- #{&1}")

    "\n## 作品章节（target_chapter 必须从此列表精确复制全名；含已规划但还没写正文的章）\n#{listed}\n"
  end

  defp revision_context_block(%AgentRun{} = run, snapshot, chapter_titles, revision_reason) do
    """
    ## 当前 AgentRun
    - run_id: #{run.run_id}
    - profile_ref: #{run.profile_ref}
    - current_plan_version: #{run.plan_version || 1}
    - next_plan_version: #{next_plan_version(run)}
    - author_goal: #{run.goal.text}
    - plan_step_targets: #{Enum.join(allowed_targets(run), ", ")}
    - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}
    - stage_state_keys: #{stage_state_keys(snapshot)}
    #{accepted_chapters_section(chapter_titles)}
    ## 修订触发原因
    #{revision_reason}

    ## 当前计划
    #{current_plan_json(run)}

    ## 最近观察
    #{observation_lines(snapshot)}

    ## 修订要求
    - 输出完整修订后计划；已经完成的前缀步骤应保留，未完成步骤应追加或替换为当前目标仍需要的步骤。
    - 每个 PlanStep 必须有 target_tool_ref，且只能来自 plan_step_targets；不在该列表中的能力（即使作品允许使用）不能作为独立 PlanStep。
    - 能力目录中的「依赖」声明是硬约束：被依赖的步骤必须出现在计划中，且排在使用它的步骤之前，不可省略。
    - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，列表中没有对应章或无法确定时填 null。
    - 只修订计划，不声称已经执行，不输出工具结果。
    - 如果计划已走完但完成条件未满足，必须补足能够让运行继续取得真实进展的最少步骤。
    """
    |> String.trim()
  end

  # 两段式第一段：自由输出 reasoning，无 tools——content 可流式逐字显示给作者。
  defp draft_reasoning_prompt(%AgentRun{} = run, snapshot, chapter_titles) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的 AgentRun 计划起草器。你只起草本次运行的可见 AgentPlan，不批准执行。

          #{draft_context_block(run, snapshot, chapter_titles)}

          ## 输出要求（46§9.4 意图开场段体裁）
          - 用自然中文向作者输出一段连贯的第一人称意图陈述，必须依次覆盖三件事：
            1) 目标复述：用一句话复述你理解的作者本轮目标；
            2) 动作顺序：先做什么、再做什么、为什么这样安排；
            3) 边界承诺：明确说明本轮产物是待确认草稿、不会直接写入作品档案（或本轮只读不产出）。
          - 用作者听得懂的创作语言描述动作（如「读取当前角色阵容」「起草反派候选」），
            禁止出现内部能力名、下划线标识符或英文机器名（如 context_assemble、strategy_gate）。
          - 这段话会逐字实时显示给作者：直接输出说明正文，不要标题、JSON、代码块或机器 ref。
          - 只说明计划，不声称已经执行，不输出工具结果，不要调用任何工具。

          ## 可用能力说明
          #{step_catalog(run.profile_ref)}
          """
        }
      ]
    }
  end

  # 两段式第二段：强制 native tool call，把第一段 reasoning 结构化为 AgentPlan。
  defp draft_structure_prompt(%AgentRun{} = run, snapshot, chapter_titles, reasoning_text) do
    tool_prompt(
      @draft_tool_name,
      """
      你是小说创作系统的 AgentRun 计划起草器。你只起草本次运行的可见 AgentPlan，不批准执行。

      #{draft_context_block(run, snapshot, chapter_titles)}

      ## 你已向作者说明的计划 reasoning
      #{reasoning_text || "（reasoning 缺失：你必须在 author_reasoning 字段补写一段作者可见 reasoning 原文）"}

      ## 输出格式
      - native tool call：必须调用 #{@draft_tool_name}，把上方 reasoning 对应的完整计划结构放入 tool arguments。
      - arguments 必须包含 author_reasoning 字段：填与上方 reasoning 一致的作者可见原文；reasoning 缺失时自己补写。
      - 除 author_reasoning 与步骤 description 外，不要把其它叙事字段放入 tool arguments。

      ## 可用能力说明
      #{step_catalog(run.profile_ref)}
      """
    )
  end

  defp revision_reasoning_prompt(%AgentRun{} = run, snapshot, chapter_titles, revision_reason) do
    %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的 AgentRun 计划修订器。你只修订本次运行的可见 AgentPlan，不批准执行。

          #{revision_context_block(run, snapshot, chapter_titles, revision_reason)}

          ## 输出要求（46§9.4 阶段结论段体裁）
          - 用自然中文向作者输出一段连贯的结论陈述，必须依次覆盖三件事：
            1) 已核清的事实：到目前为止确认了什么（内联提及关键对象名，如章节/角色/设定）；
            2) 判断：为什么当前计划需要修订；
            3) 影响范围：修订后接下来只会做什么、不会碰什么。
          - 这段话会逐字实时显示给作者：直接输出说明正文，不要标题、JSON、代码块或机器 ref。
          - 只说明修订，不声称已经执行，不输出工具结果，不要调用任何工具。

          ## 可用能力说明
          #{step_catalog(run.profile_ref)}
          """
        }
      ]
    }
  end

  defp revision_structure_prompt(
         %AgentRun{} = run,
         snapshot,
         chapter_titles,
         revision_reason,
         reasoning_text
       ) do
    tool_prompt(
      @revision_tool_name,
      """
      你是小说创作系统的 AgentRun 计划修订器。你只修订本次运行的可见 AgentPlan，不批准执行。

      #{revision_context_block(run, snapshot, chapter_titles, revision_reason)}

      ## 你已向作者说明的修订 reasoning
      #{reasoning_text || "（reasoning 缺失：你必须在 author_reasoning 字段补写一段作者可见 reasoning 原文）"}

      ## 输出格式
      - native tool call：必须调用 #{@revision_tool_name}，把上方 reasoning 对应的完整修订后计划结构放入 tool arguments。
      - arguments 必须包含 author_reasoning 字段：填与上方 reasoning 一致的作者可见原文；reasoning 缺失时自己补写。
      - 除 author_reasoning 与步骤 description 外，不要把其它叙事字段放入 tool arguments。

      ## 可用能力说明
      #{step_catalog(run.profile_ref)}
      """
    )
  end

  defp step_catalog("conversation_turn_v1") do
    """
    - context_assemble | explore | 读取当前作品上下文；后续各步的输入基础
    - dialogue_frame | explore | 形成对话认知帧；依赖 context_assemble 的产出
    - strategy_gate | explore | 制定执行策略并完成系统裁决；依赖 dialogue_frame 产出的认知帧，不能跳过 dialogue_frame 直接执行
    - response_finalize | explore | 生成本轮回应并写入可回放留痕；依赖 strategy_gate 的裁决结果

    注意：创作能力（如 world_building / prose_writing / character_design 等）由 strategy_gate 裁决后在回应管线内自动调用，不能作为独立 PlanStep 排入计划；计划只能由上面四个步骤组成。
    """
  end

  defp step_catalog("judgment_plan_v1") do
    """
    - context_assemble | explore | 读取当前作品上下文；建议作为首步
    - character_roster | explore | 读取当前已确认角色阵容（只读查询）
    - character_design | act | 设计新角色（产出待采纳候选）
    - character_evolution | act | 推进已有角色的演化记忆（产出待采纳草稿）
    - plot_outline | act | 规划章节大纲（产出待采纳草稿）
    - world_building | act | 设计世界观设定、伏笔或规则（产出待采纳候选）
    - prose_writing | act | 写或续写章节正文（产出待采纳草稿）

    按作者请求的实际阶段排步：只排完成这条请求所需的能力步，先读后写，
    前后依赖用 depends_on 表达；不要为单一产物的请求排多余步骤。
    """
  end

  defp step_catalog("prose_drafting_with_quality_v1") do
    """
    - context_assemble | explore | 读取正文写作上下文
    - prose_writing | act | 生成正文草稿并触发质量复核
    """
  end

  defp step_catalog("character_design_with_context_v1") do
    """
    - character_roster | explore | 读取当前角色阵容
    - character_design | act | 基于角色阵容生成待采纳角色候选
    """
  end

  defp step_catalog("plot_outline_with_context_v1") do
    """
    - context_assemble | explore | 读取章节大纲规划上下文
    - plot_outline | act | 生成章节大纲草稿
    """
  end

  defp step_catalog("character_evolution_with_context_v1") do
    """
    - context_assemble | explore | 读取角色演化上下文
    - character_evolution | act | 生成角色演化记忆草稿
    """
  end

  defp step_catalog("world_building_with_context_v1") do
    """
    - context_assemble | explore | 读取世界设定上下文
    - world_building | act | 生成世界设定、伏笔或规则草稿
    """
  end

  defp step_catalog("provider_progress_v1") do
    """
    - provider_complete | act | 调用 provider 并记录 author-safe 进度边界
    """
  end

  defp step_catalog("readonly_batch_context_v1") do
    """
    - readonly_batch | explore | 并行读取并汇总只读上下文；不得写入作品或生成候选
    """
  end

  defp step_catalog("prose_revision_from_findings_v1") do
    """
    - revision_prepare | explore | 读取待修订草稿和质量发现
    - revision_plan | explore | 构造修订 MicroPlan 并重新经过 Orchestrator gate
    - prose_writing | act | 基于修订计划生成 sibling tentative 修订草稿
    - revision_finalize | explore | 汇总修订候选给作者；不得自动采纳或写入作品事实
    """
  end

  defp step_catalog(_profile_ref), do: "- allowed_tool | act | 执行一个允许能力"

  defp internal_observation_steps("conversation_turn_v1"),
    do: ["context_assemble", "dialogue_frame", "strategy_gate", "response_finalize"]

  defp internal_observation_steps("prose_drafting_with_quality_v1"), do: ["context_assemble"]

  defp internal_observation_steps("judgment_plan_v1"),
    do: ["context_assemble", "character_roster"]

  defp internal_observation_steps("prose_revision_from_findings_v1"),
    do: ["revision_prepare", "revision_plan", "revision_finalize"]

  defp internal_observation_steps("plot_outline_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("character_evolution_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("world_building_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps(_profile_ref), do: []

  defp tool_call_correction_prompt(original_prompt, failed_content, reason) do
    original_text = original_prompt_text(original_prompt)

    tool_prompt(
      original_prompt.tool_choice,
      """
      你上一次的 AgentRun 计划 tool call 无法被系统解析（#{inspect(reason)}）。请严格重新输出同一任务：
      - 必须调用 #{original_prompt.tool_choice}，且只调用这一个 tool
      - tool arguments 必须包含 plan.steps、author_reasoning、reason_codes、confidence
      - 每个 PlanStep 必须有 step_id / kind / description / success_criteria / target_tool_ref
      - 除 author_reasoning 与步骤 description 外，不要把其它叙事字段放进 tool arguments

      ## 你的上一次 content（截取前 #{@max_failed_planner_output_chars} 字符）
      #{String.slice(to_string(failed_content), 0, @max_failed_planner_output_chars)}

      ## 原始任务
      #{original_text}
      """
    )
  end

  defp parse_tool_call_result(provider_result, tool_name) do
    with {:ok, parsed} <- tool_call_arguments(provider_result, tool_name) do
      require_json_object(parsed)
    end
  end

  defp tool_call_arguments(provider_result, tool_name) do
    provider_result
    |> map_get(:tool_calls)
    |> case do
      calls when is_list(calls) ->
        matching_tool_arguments(calls, tool_name)

      _ ->
        {:error, :native_tool_call_required}
    end
  end

  defp matching_tool_arguments(calls, tool_name) do
    matches =
      Enum.filter(calls, fn call ->
        map_get(call, :name) == tool_name
      end)

    case matches do
      [call] ->
        case map_get(call, :arguments) do
          args when is_map(args) -> {:ok, args}
          _ -> {:error, :native_tool_call_arguments_required}
        end

      [] ->
        {:error, {:native_tool_call_required, tool_name}}

      _multiple ->
        {:error, {:native_tool_call_count_invalid, length(matches)}}
    end
  end

  defp require_json_object(parsed) when is_map(parsed), do: {:ok, parsed}
  defp require_json_object(_parsed), do: {:error, :json_object_required}

  defp tool_prompt(tool_name, content) do
    %{
      messages: [
        %{role: "user", content: content}
      ],
      tools: [agent_plan_tool(tool_name)],
      tool_choice: tool_name
    }
  end

  defp agent_plan_tool(tool_name) do
    %{
      name: tool_name,
      description: "Return the complete AgentPlan structure for this AgentRun.",
      input_schema: agent_plan_tool_schema()
    }
  end

  defp agent_plan_tool_schema do
    %{
      type: "object",
      required: ["plan", "author_reasoning", "reason_codes", "confidence"],
      additionalProperties: false,
      properties: %{
        author_reasoning: %{
          type: "string",
          minLength: 1,
          description: "作者可见 reasoning 原文（与前置流式 reasoning 一致；reasoning 缺失时的回退叙事来源）"
        },
        plan: %{
          type: "object",
          required: ["steps"],
          additionalProperties: false,
          properties: %{
            steps: %{
              type: "array",
              minItems: 1,
              items: %{
                type: "object",
                required: [
                  "step_id",
                  "kind",
                  "description",
                  "success_criteria",
                  "target_tool_ref"
                ],
                additionalProperties: false,
                properties: %{
                  step_id: %{type: "string", minLength: 1},
                  kind: %{type: "string", enum: ["explore", "act"]},
                  description: %{type: "string", minLength: 1},
                  success_criteria: %{type: "array", items: %{type: "string"}},
                  depends_on: %{type: "array", items: %{type: "string"}},
                  target_tool_ref: %{type: "string", minLength: 1},
                  write_intent: %{type: "string", enum: ["none", "tentative"]},
                  risk_hint: %{type: "string", enum: ["low", "medium", "high"]},
                  authoring_intent: %{
                    anyOf: [
                      %{type: "string", enum: ["none", "continuation", "rewrite"]},
                      %{type: "null"}
                    ]
                  },
                  target_chapter: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  requested_chapter_raw: %{anyOf: [%{type: "string"}, %{type: "null"}]}
                }
              }
            }
          }
        },
        reason_codes: %{type: "array", items: %{type: "string"}},
        confidence: %{type: "number", minimum: 0, maximum: 1}
      }
    }
  end

  defp original_prompt_text(%{messages: [%{content: content} | _]}), do: content
  defp original_prompt_text(%{"messages" => [%{"content" => content} | _]}), do: content
  defp original_prompt_text(other), do: inspect(other)

  defp narrative_source(provider_result, summary, :content, _tool_name) do
    case AgentNarrativeSource.from_provider_result(provider_result, summary) do
      {:ok, source} -> {:ok, source}
      {:error, reason} -> {:error, {:invalid_author_narrative_source, reason}}
    end
  end

  defp narrative_source(provider_result, summary, :tool_arguments, tool_name) do
    case AgentNarrativeSource.from_tool_call_narrative(provider_result, tool_name, summary) do
      {:ok, source} -> {:ok, source}
      {:error, reason} -> {:error, {:invalid_author_narrative_source, reason}}
    end
  end

  defp reason_codes(parsed), do: parsed |> map_get(:reason_codes) |> string_list()

  defp confidence(parsed) do
    case map_get(parsed, :confidence) do
      value when is_float(value) and value >= 0.0 and value <= 1.0 -> value
      value when is_integer(value) and value >= 0 and value <= 1 -> value * 1.0
      _ -> 1.0
    end
  end

  defp stage_state_keys(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> case do
      stage_state when is_map(stage_state) ->
        stage_state
        |> Map.keys()
        |> Enum.map(&to_string/1)
        |> Enum.sort()
        |> Enum.join(", ")
        |> case do
          "" -> "none"
          keys -> keys
        end

      _ ->
        "none"
    end
  end

  defp stage_state_keys(_snapshot), do: "none"

  defp current_plan_json(%AgentRun{} = run) do
    %{
      plan_ref: run.plan_ref || map_get(run.plan, :plan_id),
      plan_version: run.plan_version || map_get(run.plan, :version),
      steps: Enum.map(plan_steps(run.plan || %{}), &plan_step_summary/1)
    }
    |> Jason.encode()
    |> case do
      {:ok, json} -> json
      {:error, _reason} -> "none"
    end
  end

  defp plan_step_summary(step) when is_map(step) do
    %{
      step_id: map_get(step, :step_id),
      kind: step |> map_get(:kind) |> atom_string(),
      status: step |> map_get(:status) |> atom_string(),
      description: map_get(step, :description),
      success_criteria: string_list(map_get(step, :success_criteria)),
      depends_on: string_list(map_get(step, :depends_on)),
      target_tool_ref: map_get(step, :target_tool_ref),
      write_intent: step |> map_get(:write_intent) |> atom_string(),
      risk_hint: step |> map_get(:risk_hint) |> atom_string(),
      authoring_intent: map_get(step, :authoring_intent),
      target_chapter: map_get(step, :target_chapter),
      requested_chapter_raw: map_get(step, :requested_chapter_raw)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp observation_lines(%{observations: observations}) when is_list(observations) do
    observations
    |> Enum.take(-8)
    |> Enum.map_join("\n", &observation_line/1)
    |> case do
      "" -> "none"
      lines -> lines
    end
  end

  defp observation_lines(_snapshot), do: "none"

  defp observation_line(%AgentObservation{} = observation) do
    "- #{observation.observation_id} / #{observation.observation_type}: #{observation.summary}"
  end

  defp observation_line(observation) when is_map(observation) do
    "- #{map_get(observation, :observation_id)} / #{map_get(observation, :observation_type)}: #{map_get(observation, :summary)}"
  end

  defp observation_line(observation), do: "- #{inspect(observation)}"

  defp next_plan_version(%AgentRun{} = run) do
    case run.plan_version || map_get(run.plan, :version) do
      value when is_integer(value) and value > 0 -> value + 1
      _ -> 2
    end
  end

  defp atom_string(value) when is_atom(value), do: Atom.to_string(value)
  defp atom_string(value) when is_binary(value), do: value
  defp atom_string(_value), do: nil

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp string_list(_values), do: []

  defp nonblank(nil), do: nil

  defp nonblank(value) do
    value
    |> to_string()
    |> String.trim()
    |> case do
      "" -> nil
      text -> text
    end
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
