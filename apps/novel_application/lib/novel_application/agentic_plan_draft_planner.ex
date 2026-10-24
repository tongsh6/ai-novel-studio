defmodule NovelApplication.AgenticPlanDraftPlanner do
  require NovelCommon.LogEmit

  @moduledoc """
  Provider-backed AgentPlan drafter for ADR-0023 plan-driven AgentRun loops.

  The drafter produces an author-visible AgentPlan track. It does not approve
  execution; runtime still turns each plan step into an AgentStep/MicroPlan path.

  B26：单次 auto 调用同时返回作者可见说明与计划；坏结构有界纠正一次。
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
    chapter_titles = chapter_index_payload(run, opts)

    request_plan_with_meta(
      run,
      provider_execution,
      snapshot,
      draft_prompt(run, snapshot, chapter_titles),
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
    chapter_titles = chapter_index_payload(run, opts)

    request_plan_with_meta(
      revision_run,
      provider_execution,
      snapshot,
      revision_prompt(run, snapshot, chapter_titles, revision_reason),
      @revision_tool_name,
      &revision_meta(&1, &2, revision_reason)
    )
  end

  # 规划期机械准备（ADR-0025）：作品章节索引由应用层确定性读取后注入 prompt，
  # 不问模型。B24 CP2（I-EXPLORE-READ-9）：索引同时给出 chapter_ref（chapter_read
  # 唯一寻址）、seq 与 title（target_chapter 仍精确复制标题；作者面只用 seq+title）。
  # 读取失败按无章节处理——缺席时点名章的正文请求会被缺失策略误判为"点名了不存在的章"。
  defp chapter_index_payload(%AgentRun{} = run, opts) do
    entries = chapter_entries(run, opts)
    %{titles: Enum.map(entries, & &1.title), entries: entries}
  end

  defp chapter_entries(%AgentRun{} = run, opts) do
    cond do
      is_function(Keyword.get(opts, :chapter_index_reader), 1) ->
        normalize_chapter_entries(
          safe_reader(Keyword.get(opts, :chapter_index_reader), run.workspace_id)
        )

      is_function(Keyword.get(opts, :chapter_titles_reader), 1) ->
        titles_to_chapter_entries(
          safe_reader(Keyword.get(opts, :chapter_titles_reader), run.workspace_id)
        )

      true ->
        case NovelApplication.persistence_chapter_index_reader() do
          reader when is_function(reader, 1) ->
            normalize_chapter_entries(safe_reader(reader, run.workspace_id))

          _ ->
            titles_to_chapter_entries(
              safe_reader(NovelApplication.persistence_chapter_titles_reader(), run.workspace_id)
            )
        end
    end
  end

  defp safe_reader(reader, workspace_id) when is_function(reader, 1) do
    reader.(workspace_id)
  rescue
    _error -> []
  end

  defp safe_reader(_reader, _workspace_id), do: []

  defp normalize_chapter_entries(entries) when is_list(entries) do
    entries
    |> Enum.map(&normalize_chapter_entry/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_chapter_entries(_entries), do: []

  defp normalize_chapter_entry(entry) when is_map(entry) do
    case Map.get(entry, :title) do
      title when is_binary(title) ->
        case String.trim(title) do
          "" ->
            nil

          trimmed ->
            %{
              title: trimmed,
              seq: Map.get(entry, :seq),
              id: Map.get(entry, :id),
              has_prose: Map.get(entry, :has_prose, true)
            }
        end

      _ ->
        nil
    end
  end

  defp normalize_chapter_entry(_entry), do: nil

  defp titles_to_chapter_entries(titles) when is_list(titles) do
    titles
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.map(&%{title: String.trim(&1), seq: nil, id: nil, has_prose: true})
  end

  defp titles_to_chapter_entries(_titles), do: []

  defp request_plan_with_meta(run, provider_execution, snapshot, prompt, tool_name, meta_fun) do
    with {:ok, result_fn} <- plan_result_fn(provider_execution, snapshot, :planner) do
      request_plan(prompt, %{
        tool_name: tool_name,
        result_fn: result_fn,
        run: run,
        attempt: 1,
        retry?: true,
        meta_fun: meta_fun
      })
    end
  end

  @doc "消费判断响应同批给出的模型计划，不发起第二次调用。"
  def plan_from_result(run, result) do
    with {:ok, parsed} <- parse_tool_call_result(result, @draft_tool_name),
         :ok <- validate_writing_intents(parsed, %{run: run}),
         {:ok, plan} <- build_plan(run, parsed),
         :ok <- validate_plan_targets(run, plan),
         {:ok, text, origin, source} <- resolve_narrative(%{provider_result: result}, parsed),
         {:ok, binding} <- narrative_source(source, text, origin, @draft_tool_name) do
      {:ok, plan,
       %{
         provider_call_count: 0,
         summary: text,
         author_narrative_source: binding,
         reason_codes: reason_codes(parsed),
         confidence: confidence(parsed)
       }}
    end
  end

  defp plan_result_fn(provider_execution, snapshot, purpose) do
    result_fn =
      provider_execution
      |> Execution.with_purpose(purpose)
      |> Execution.with_content_visibility(:author)
      |> ProviderActivityProjector.with_stage_sink(snapshot,
        purpose: :planner,
        content_visibility: :author
      )
      |> Execution.result_fn()

    case result_fn do
      result_fn when is_function(result_fn, 1) -> {:ok, result_fn}
      nil -> {:error, :provider_execution_required}
      other -> {:error, {:invalid_plan_draft_provider, other}}
    end
  end

  defp request_plan(prompt, ctx) do
    ctx = Map.put(ctx, :prompt, prompt)

    case ctx.result_fn.(prompt) do
      {:ok, %{content: content} = provider_result} ->
        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(
          Map.merge(ctx, %{content: content, provider_result: provider_result})
        )

      {:ok, %{"content" => content} = provider_result} ->
        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(
          Map.merge(ctx, %{content: content, provider_result: provider_result})
        )

      {:ok, content} when is_binary(content) ->
        provider_result = %{content: content, tool_calls: []}

        provider_result
        |> parse_tool_call_result(ctx.tool_name)
        |> build_or_retry_plan(
          Map.merge(ctx, %{content: content, provider_result: provider_result})
        )

      {:error, reason} ->
        provider_retry_or_error(reason, ctx)

      other ->
        provider_retry_or_error({:invalid_plan_draft_result, other}, ctx)
    end
  end

  # D4：provider 层错误与结构纠正重试共享同一次 retry 额度（两族互斥，最坏 2 调用）；
  # provider 错无「纠正」语义——原样重发。
  defp provider_retry_or_error(reason, %{retry?: true} = ctx) do
    emit_plan_retry(:structure, :provider_error, reason)
    request_plan(ctx.prompt, %{ctx | attempt: ctx.attempt + 1, retry?: false})
  end

  defp provider_retry_or_error(reason, _ctx), do: {:error, reason}

  defp emit_plan_retry(stage, family, reason) do
    NovelCommon.LogEmit.emit(:plan_draft, :retry, :start, %{
      stage: stage,
      family: family,
      reason: inspect(reason) |> String.slice(0, 200)
    })
  end

  defp build_or_retry_plan({:ok, parsed}, ctx) do
    with {:ok, reasoning, origin, source_result} <- resolve_narrative(ctx, parsed),
         :ok <- validate_writing_intents(parsed, ctx),
         {:ok, plan} <- build_plan(ctx.run, parsed),
         :ok <- validate_plan_targets(ctx.run, plan),
         {:ok, narrative_source} <-
           narrative_source(source_result, reasoning, origin, ctx.tool_name) do
      base_meta = %{
        provider_call_count: ctx.attempt,
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
    emit_plan_retry(:structure, :correction, reason)

    ctx.prompt
    |> tool_call_correction_prompt(ctx.content, reason)
    |> request_plan(%{ctx | attempt: ctx.attempt + 1, retry?: false})
  end

  defp retry_or_error(reason, ctx) do
    NovelCommon.LogEmit.emit(:plan_draft, :output_validation, :done, %{
      outcome: "rejected",
      tool_name: ctx.tool_name,
      reason: inspect(reason)
    })

    {:error, {:agent_plan_protocol_violation, reason}}
  end

  # 只绑定当前有效响应；纠正调用不能沿用失败响应的作者文字。
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
      version: run.plan_version,
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
      # B25 CP2b：模型从「作品章节」索引逐字复制的 chapter_ref；同名章场景据此确定性归章。
      target_chapter_ref: normalize_chapter_ref(map_get(step, :target_chapter_ref)),
      requested_chapter_raw: nonblank(map_get(step, :requested_chapter_raw)),
      target_word_count: normalize_target_word_count(map_get(step, :target_word_count)),
      exploration_query: nonblank(map_get(step, :exploration_query))
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
      target_chapter_ref: nil,
      requested_chapter_raw: nil,
      target_word_count: nil,
      exploration_query: nil
    }
  end

  # 作者篇幅诉求（CP0 写作坐标族；帧纪元 form_micro_plan 同语义迁入）：
  # 正整数上界 20_000，字符串容错解析，其余归 nil（无诉求不硬编）。
  defp normalize_target_word_count(value) when is_integer(value) and value > 0,
    do: min(value, 20_000)

  defp normalize_target_word_count(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {n, _} when n > 0 -> min(n, 20_000)
      _ -> nil
    end
  end

  defp normalize_target_word_count(_), do: nil

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

  # M0 狗粮缺陷修复（2026-07-19）：live 模型把 authoring_intent 当自由文本填中文
  # 短语（"自然衔接前文，推进本章情节"），域层归一化静默吞成 nil → 续写请求被坐标
  # 成 first_draft → 覆盖已采纳正文（748→432 字数倒退实锤）。在归一化吞掉之前按
  # 原始值校验：prose_writing 步的 authoring_intent 非枚举即结构不合法（携带原因
  # 重试一次，仍坏诚实失败）——不猜测语义映射。
  @writing_intent_values [nil, "", "none", "continuation", "rewrite"]

  # D7（2026-08-26）：值域校验之外再加**键存在性**校验。省略该键与显式填 null
  # （写新章）在解析后都是 nil，无法区分；而「省略」恰恰是需要模型补齐的那种缺失
  # （M6/M9 实锤：qwen 推理正确但常省略此键）。
  #
  # **缺键是软性要求（M10 实锤校准）**：先带原因重试一次请模型补齐；若重试后仍缺，
  # **带痕放行**而不是让作者的 run 失败——因为 adoption_mode 已把「缺失」默认成
  # 安全侧 append（D7 ①），缺这个键不再有破坏性后果。M10 首版把缺键做成硬失败，
  # 实测 qwen 首稿与重试都省略 → agent_run.run_failed ×3、作者一个字都拿不到，
  # 比修复前更糟；判据：**不可逆动作要 fail-safe，可选元数据不该 fail-hard**。
  #
  # 「填错」（非枚举值，如中文短语）仍是硬失败：那是语义不明，猜它等于赌作者的正文
  # （M0 2026-07-19 判例：748→432 字数倒退）。
  defp validate_writing_intents(parsed, ctx) do
    steps =
      parsed
      |> map_get(:plan)
      |> then(fn plan -> (is_map(plan) && map_get(plan, :steps)) || [] end)

    prose_steps =
      Enum.filter(steps, fn step ->
        is_map(step) and map_get(step, :target_tool_ref) == "prose_writing"
      end)

    missing = Enum.reject(prose_steps, &authoring_intent_key?/1)

    invalid =
      prose_steps
      |> Enum.filter(&(map_get(&1, :authoring_intent) not in @writing_intent_values))
      |> Enum.map(&map_get(&1, :authoring_intent))

    cond do
      missing != [] and Map.get(ctx, :retry?, false) ->
        {:error,
         {:missing_authoring_intent,
          "prose_writing 步必须显式携带 authoring_intent 键（continuation / rewrite / null），本次有 #{length(missing)} 步缺该键"}}

      missing != [] ->
        NovelCommon.LogEmit.emit(:plan_draft, :authoring_intent_degrade, :done, %{
          missing_steps: length(missing),
          reason: "模型重试后仍未携带 authoring_intent 键，按安全侧（append）继续"
        })

        :ok

      invalid != [] ->
        {:error,
         {:invalid_authoring_intent,
          "authoring_intent 只能取 continuation / rewrite / null（枚举，非描述文字），收到：#{inspect(Enum.uniq(invalid))}"}}

      true ->
        :ok
    end
  end

  defp authoring_intent_key?(step) when is_map(step),
    do: Map.has_key?(step, :authoring_intent) or Map.has_key?(step, "authoring_intent")

  defp authoring_intent_key?(_step), do: false

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

  defp plan_step_targets("prose_drafting_with_quality_v1"),
    do: ["context_assemble", "chapter_mission", "prose_writing"]

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
  # CP5b：计划内检索步（探索目录同源；执行为内联只读 0 调用）。
  defp plan_step_targets("judgment_plan_v1"),
    do: [
      "context_assemble",
      "character_roster",
      "prose_search",
      "chapter_read",
      "archive_read",
      "memory_recall",
      "character_design",
      "character_evolution",
      "plot_outline",
      "world_building",
      "prose_writing"
    ]

  defp plan_step_targets("readonly_batch_context_v1"), do: ["readonly_batch"]
  defp plan_step_targets("ledger_reconciliation_v1"), do: ["ledger_reconcile"]

  defp plan_step_targets("prose_revision_from_findings_v1"),
    do: ["revision_prepare", "revision_plan", "prose_writing", "revision_finalize"]

  defp plan_step_targets(_profile_ref), do: nil

  # VS-00I CP-D：prompt 按 L0–L4 稳定度排序（只重排，不删段、不改措辞语义）。
  # L1 = 角色句之后的调用点常量（profile 参数、计划要求、能力目录）；L2 = 作品章节；
  # L3 = 本轮目标 / 版本 / run_id / 阶段状态；L4 = 输出契约置尾（见各 prompt 构造器）。
  @doc false
  @spec draft_context_block(AgentRun.t(), map(), map() | [String.t()]) :: String.t()
  def draft_context_block(%AgentRun{} = run, snapshot, chapter_titles) do
    [
      """
      ## 调用点参数（本调用点恒定）
      - profile_ref: #{run.profile_ref}
      - plan_step_targets: #{Enum.join(allowed_targets(run), ", ")}
      - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}
      """,
      """
      ## 计划要求
      - 计划必须是当前作者目标的 per-run 动态计划，不要复述固定模板。
      - 每个 PlanStep 必须有 target_tool_ref，且只能来自 plan_step_targets；不在该列表中的能力（即使作品允许使用）不能作为独立 PlanStep。
      - 能力目录中的「依赖」声明是硬约束：被依赖的步骤必须出现在计划中，且排在使用它的步骤之前，不可省略。
      - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw / target_chapter_ref；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，并**逐字复制该条索引里的 chapter_ref 填入 target_chapter_ref**（同名章必须靠 ref 区分；列表中没有对应章或无法确定时两者都填 null）。
      - authoring_intent 是枚举不是描述文字，只能取：continuation（续写既有章：保留已采纳正文接着写）｜ rewrite（推翻重写该章）｜ null（写新章）。作者说"接着写/继续写/往下写"必须填 continuation。
      - 作者明确表达了篇幅诉求（如"写约 800 字""三百字左右"）时，prose_writing 步携带 target_word_count 整数估计；没有篇幅诉求填 null，不要硬编。
      - 只起草计划，不声称已经执行，不输出工具结果。
      - 普通路径应覆盖完成目标所需最少步骤；不要添加纯收束模型调用。
      """,
      """
      ## 可用能力说明
      #{step_catalog(run.profile_ref)}
      """,
      String.trim(accepted_chapters_section(chapter_titles, run.goal.text)),
      """
      ## 本轮目标
      - author_goal: #{run.goal.text}
      - goal_version: #{run.goal.version}
      - stage_state_keys: #{stage_state_keys(snapshot)}
      - run_id: #{run.run_id}
      """
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.map_join("\n\n", &String.trim/1)
  end

  # 与旧 Planner accepted_chapters_section 同一契约措辞：target_chapter 精确复制标题；
  # B24 CP2：chapter_read 的 exploration_query 优先复制索引里的 chapter_ref。
  # T2a：有界投影（作者点名章恒在列——精确复制契约的依赖项由 ChapterListBudget 保证）。
  defp accepted_chapters_section(chapters, author_text) do
    payload = chapters_payload(chapters)

    case payload.entries do
      [] ->
        ""

      entries ->
        {listed, omitted} =
          NovelApplication.ChapterListBudget.project_entries(entries, author_text)

        "\n## 作品章节（target_chapter 精确复制标题；chapter_read 优先复制 chapter_ref；含已规划但还没写正文的章）\n" <>
          NovelApplication.ChapterListBudget.render_entry_lines(
            listed,
            omitted,
            length(entries)
          ) <>
          "\n"
    end
  end

  # 公开 prompt 构造器兼容两种入参：索引 payload（生产）或章节标题列表（既有测试/调用）。
  defp chapters_payload(%{titles: _titles, entries: entries} = payload) when is_list(entries),
    do: payload

  defp chapters_payload(titles) when is_list(titles) do
    entries = titles_to_chapter_entries(titles)
    %{titles: Enum.map(entries, & &1.title), entries: entries}
  end

  defp chapters_payload(_other), do: %{titles: [], entries: []}

  @doc false
  @spec revision_context_block(AgentRun.t(), map(), map() | [String.t()], String.t()) ::
          String.t()
  def revision_context_block(%AgentRun{} = run, snapshot, chapter_titles, revision_reason) do
    [
      """
      ## 修订要求
      - 输出完整修订后计划；已经完成的前缀步骤应保留，未完成步骤应追加或替换为当前目标仍需要的步骤。
      - 每个 PlanStep 必须有 target_tool_ref，且只能来自 plan_step_targets；不在该列表中的能力（即使作品允许使用）不能作为独立 PlanStep。
      - 能力目录中的「依赖」声明是硬约束：被依赖的步骤必须出现在计划中，且排在使用它的步骤之前，不可省略。
      - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw / target_chapter_ref；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，并**逐字复制该条索引里的 chapter_ref 填入 target_chapter_ref**（同名章必须靠 ref 区分；列表中没有对应章或无法确定时两者都填 null）。
      - authoring_intent 是枚举不是描述文字，只能取：continuation（续写既有章：保留已采纳正文接着写）｜ rewrite（推翻重写该章）｜ null（写新章）。作者说"接着写/继续写/往下写"必须填 continuation。
      - 作者明确表达了篇幅诉求（如"写约 800 字""三百字左右"）时，prose_writing 步携带 target_word_count 整数估计；没有篇幅诉求填 null，不要硬编。
      - 只修订计划，不声称已经执行，不输出工具结果。
      - 如果计划已走完但完成条件未满足，必须补足能够让运行继续取得真实进展的最少步骤。
      """,
      """
      ## 调用点参数（本调用点恒定）
      - profile_ref: #{run.profile_ref}
      - plan_step_targets: #{Enum.join(allowed_targets(run), ", ")}
      - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}
      """,
      """
      ## 可用能力说明
      #{step_catalog(run.profile_ref)}
      """,
      String.trim(accepted_chapters_section(chapter_titles, run.goal.text)),
      """
      ## 本轮目标
      - author_goal: #{run.goal.text}
      - current_plan_version: #{run.plan_version || 1}
      - next_plan_version: #{next_plan_version(run)}
      - stage_state_keys: #{stage_state_keys(snapshot)}
      - run_id: #{run.run_id}
      """,
      """
      ## 修订触发原因
      #{revision_reason}
      """,
      """
      ## 当前计划
      #{current_plan_json(run)}
      """,
      """
      ## 最近观察
      #{observation_lines(snapshot)}
      """
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.map_join("\n\n", &String.trim/1)
  end

  # 单调用 auto：content 为作者可见 reasoning（可流式），计划结构走同名 native tool arguments。
  @doc "单调用计划起草请求；共同任务策略与判断入口同源。"
  def draft_prompt(%AgentRun{} = run, snapshot, chapter_titles) do
    tool_prompt(@draft_tool_name, """
    本次你承担 AgentRun 计划起草器的角色，只提出计划，不批准执行。
    共同任务规则版本：#{NovelApplication.AuthoringTaskPolicy.version()}。
    #{NovelApplication.AuthoringTaskPolicy.rules()}

    #{draft_context_block(run, snapshot, chapter_titles)}

    ## 输出契约
    调用 agent_plan_draft 给出完整计划。说明必要步骤、依据与待采纳边界，不机械复述形态。
    content 可以同时说明计划；author_reasoning 保留作者可见原话，空 content 时从该字段展示。
    不执行步骤，不声称产物已经生成或采纳，不输出工具结果。
    """)
  end

  @doc "单调用计划修订请求，沿原任务与已完成前缀修订。"
  def revision_prompt(%AgentRun{} = run, snapshot, chapter_titles, revision_reason) do
    tool_prompt(@revision_tool_name, """
    本次你承担 AgentRun 计划修订器的角色，只提出计划，不批准执行。
    共同任务规则版本：#{NovelApplication.AuthoringTaskPolicy.version()}。
    #{NovelApplication.AuthoringTaskPolicy.rules()}

    #{revision_context_block(run, snapshot, chapter_titles, revision_reason)}

    ## 输出契约
    调用 agent_plan_revision 给出完整修订计划，保留已完成前缀和当前任务对象/范围。
    content 可同时说明事实、修订理由与影响范围；author_reasoning 保留作者可见原话。
    不执行步骤，不声称产物已经生成或采纳，不输出工具结果。
    """)
  end

  defp step_catalog("judgment_plan_v1") do
    """
    - context_assemble | explore | 读取当前作品上下文；建议作为首步
    - character_roster | explore | 读取当前已确认角色阵容（只读查询）
    - prose_search | explore | 全文检索已采纳正文（exploration_query 填检索词）
    - chapter_read | explore | 读取某一章的设计计划、章摘要与已采纳正文（exploration_query 填作品目录里的真实章标题、原样复制；长章分页时按观察里的【续读】提示用 JSON {"chapter":"<章标题>","offset":<下页起点>} 续读）
    - archive_read | explore | 读取作品档案面（exploration_query 填 profile｜characters｜foreshadowing｜rules｜stats｜current_state｜relationships｜preferences 之一）
    - memory_recall | explore | 检索治理记忆（exploration_query 填检索词）
    - character_design | act | 设计新角色（产出待采纳候选）
    - character_evolution | act | 推进已有角色的演化记忆（产出待采纳草稿）
    - plot_outline | act | 规划章节大纲（产出待采纳草稿）
    - world_building | act | 设计世界观设定、伏笔或规则（产出待采纳候选）
    - prose_writing | act | 写或续写章节正文（产出待采纳草稿）

    按作者请求的实际阶段排步：只排完成这条请求所需的能力步，先读后写，
    前后依赖用 depends_on 表达；不要为单一产物的请求排多余步骤。
    检索步（prose_search/chapter_read/archive_read/memory_recall）必须携带
    exploration_query；非检索步该字段填 null。
    """
  end

  defp step_catalog("prose_drafting_with_quality_v1") do
    """
    - context_assemble | explore | 读取正文写作上下文
    - chapter_mission | explore | 写前推理：按本章计划与作品脉络/进度推导本章使命（必排在 prose_writing 之前，prose_writing 依赖它）
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

  defp step_catalog("readonly_batch_context_v1") do
    """
    - readonly_batch | explore | 并行读取并汇总只读上下文；不得写入作品或生成候选
    """
  end

  defp step_catalog("ledger_reconciliation_v1") do
    """
    - ledger_reconcile | act | 机械执行全书审读并物化审读报告（对照设计与五条脉络；规则判定由系统机械完成，不得改写设定或正文）
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

  defp internal_observation_steps("prose_drafting_with_quality_v1"),
    do: ["context_assemble", "chapter_mission"]

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

  defp matching_tool_arguments([call], tool_name) do
    args = map_get(call, :arguments)

    if map_get(call, :name) == tool_name and
         NovelApplication.JudgmentToolContract.valid?(
           args,
           NovelApplication.AgentPlanToolContract.schema()
         ) do
      {:ok, args}
    else
      {:error, :invalid_plan_tool_arguments}
    end
  end

  defp matching_tool_arguments(calls, _tool_name),
    do: {:error, {:native_tool_call_count_invalid, length(calls)}}

  defp require_json_object(parsed) when is_map(parsed), do: {:ok, parsed}
  defp require_json_object(_parsed), do: {:error, :json_object_required}

  defp tool_prompt(tool_name, content) do
    %{
      messages: [
        %{role: "user", content: content}
      ],
      tools: [plan_tool(tool_name)],
      tool_choice: "auto"
    }
  end

  defdelegate plan_tool(name \\ @draft_tool_name),
    to: NovelApplication.AgentPlanToolContract,
    as: :tool

  defp original_prompt_text(%{messages: [%{content: content} | _]}), do: content
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

  # B25 CP2b：只接受 `chapter:<uuid>`；模型复制错/留空 → nil（回退 title 唯一语义）。
  defp normalize_chapter_ref(value) when is_binary(value) do
    case String.trim(value) do
      "chapter:" <> uuid = ref ->
        case Ecto.UUID.cast(uuid) do
          {:ok, _} -> ref
          :error -> nil
        end

      _ ->
        nil
    end
  end

  defp normalize_chapter_ref(_value), do: nil

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
