defmodule NovelApplication.AgenticPlanDraftPlanner do
  require NovelTelemetry.LogEmit

  @moduledoc """
  Provider-backed AgentPlan drafter for ADR-0023 plan-driven AgentRun loops.

  The drafter produces an author-visible AgentPlan track. It does not approve
  execution; runtime still turns each plan step into an AgentStep/MicroPlan path.

  B26：单次 auto 调用同时返回作者可见说明与计划；坏结构有界纠正一次。
  """

  alias NovelAgent.Provider.{Execution, NativeToolExchange}
  alias NovelApplication.{AgentNarrativeSource, AuthoringOperation}
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.{AgentObservation, AgentPlan, AgentRun}

  @draft_tool_name "agent_plan_draft"
  @revision_tool_name "agent_plan_revision"

  @type provider_execution :: Execution.dependency()

  @spec draft_plan_with_meta(AgentRun.t(), provider_execution(), map(), keyword()) ::
          {:ok, AgentPlan.t(), map()} | {:error, term(), map()}
  def draft_plan_with_meta(%AgentRun{} = run, provider_execution, snapshot \\ %{}, opts \\ []) do
    chapter_titles = chapter_index_payload(run, opts)

    request_plan_with_meta(
      run,
      provider_execution,
      snapshot,
      operation_spec(run, snapshot, chapter_titles, :draft, nil, opts),
      @draft_tool_name,
      &draft_meta/2
    )
  end

  @spec revise_plan_with_meta(AgentRun.t(), provider_execution(), map(), keyword()) ::
          {:ok, AgentPlan.t(), map()} | {:error, term(), map()}
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
      operation_spec(run, snapshot, chapter_titles, :revision, revision_reason, opts),
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

  defp request_plan_with_meta(run, provider_execution, snapshot, spec, tool_name, meta_fun) do
    case AuthoringOperation.prepare(run, snapshot, spec) do
      {:ok, ir} ->
        execute_plan(ir, run, provider_execution, snapshot, tool_name, meta_fun)

      {:error, reason} ->
        {:error, reason,
         %{
           provider_call_count: 0,
           judgment_transcript: get_in(snapshot, [:stage_state, :judgment_transcript])
         }}
    end
  end

  defp execute_plan(ir, run, provider_execution, snapshot, tool_name, meta_fun) do
    case plan_result_fn(provider_execution, snapshot, :planner) do
      {:ok, result_fn} ->
        {parsed, session} =
          NativeToolExchange.run(
            ir,
            result_fn,
            tool_name,
            fn result, attempt -> parse_plan_result(run, tool_name, result, attempt) end,
            &exchange_error/2,
            tool_choice: "auto",
            retry_transport: true,
            feedback: &plan_feedback(&1, run, tool_name),
            on_retry: &on_plan_retry/3
          )

        finish_plan(parsed, session, meta_fun)

      {:error, reason} ->
        {:error, reason, AuthoringOperation.metadata(%{request_ir: ir, provider_call_count: 0})}
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

  defp parse_plan_result(run, tool_name, result, attempt) do
    ctx = %{run: run, provider_result: result, retry?: attempt == 1}

    with {:ok, parsed} <- parse_tool_call_result_detailed(result, tool_name),
         {:ok, reasoning, origin, source} <- resolve_narrative(ctx, parsed),
         :ok <- validate_writing_intents(parsed, ctx),
         {:ok, plan} <- build_plan(run, parsed),
         :ok <- validate_plan_targets(run, plan),
         {:ok, binding} <- narrative_source(source, reasoning, origin, tool_name) do
      %{
        status: :ok,
        plan: plan,
        meta: %{
          summary: reasoning,
          author_narrative_source: binding,
          reason_codes: reason_codes(parsed),
          confidence: confidence(parsed)
        }
      }
    else
      {:error, reason} -> rejected_plan(reason)
    end
  end

  defp rejected_plan(reason) do
    %{
      status: :error,
      reason: reason,
      error: %{code: "agent_plan_protocol_violation", reason: reason}
    }
  end

  defp exchange_error("provider_error", reason),
    do: %{status: :error, reason: reason, error: %{code: "provider_error"}}

  defp exchange_error("provider_response_unexpected", result),
    do: exchange_error("provider_error", {:invalid_plan_draft_result, result})

  defp exchange_error("unexpected_tool_calls", %{received_count: 1}),
    do: rejected_plan(:invalid_plan_tool_arguments)

  defp exchange_error("unexpected_tool_calls", %{received_count: count}),
    do: rejected_plan({:native_tool_call_count_invalid, count})

  defp exchange_error("native_tool_call_required", _detail),
    do: rejected_plan(:native_tool_call_required)

  defp exchange_error("invalid_request_ir", reason),
    do: exchange_error("provider_error", {:invalid_request_ir, reason})

  defp exchange_error(_code, reason), do: rejected_plan(reason)

  defp finish_plan(%{status: :ok, plan: plan, meta: meta}, session, meta_fun) do
    operation =
      AuthoringOperation.complete(session, "agent_plan_validated", %{
        plan_ref: plan.plan_id,
        plan_version: plan.version
      })

    {:ok, plan, meta_fun.(plan, Map.merge(meta, operation))}
  end

  defp finish_plan(
         %{status: :error, error: %{code: "provider_error"}, reason: reason},
         session,
         _meta_fun
       ),
       do: {:error, reason, AuthoringOperation.metadata(session)}

  defp finish_plan(%{status: :error, reason: reason}, session, _meta_fun) do
    NovelTelemetry.LogEmit.emit(:plan_draft, :output_validation, :done, %{
      outcome: "rejected",
      reason: inspect(reason)
    })

    {:error, {:agent_plan_protocol_violation, public_reason(reason)},
     AuthoringOperation.metadata(session)}
  end

  defp public_reason({:invalid_plan_tool_arguments, _errors}), do: :invalid_plan_tool_arguments
  defp public_reason(reason), do: reason

  defp on_plan_retry(kind, reason, _attempt) do
    NovelTelemetry.LogEmit.emit(:plan_draft, :retry, :start, %{
      stage: :structure,
      family: if(kind == :provider, do: :provider_error, else: :correction),
      reason: inspect(reason) |> String.slice(0, 200)
    })
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

  # T3（UA01）T3′：修订计划的已完成前缀确定性校验（不合并、不恢复 revised_tail）。
  #
  # 现行 prompt 契约要求模型给出「完整修订计划，保留已完成前缀」；此前缀只由
  # prompt 与 cursor 约束。这里补确定性校验：已完成步骤（run.completed_step_refs
  # 对应当前 plan 前缀）的身份字段必须逐项保留，否则返回结构错误走既有纠错重试。
  # 校验不改变计划结构，因此不影响 runtime cursor/耗尽判定。
  @doc false
  @spec validate_completed_prefix(AgentRun.t(), AgentPlan.t()) :: :ok | {:error, term()}
  def validate_completed_prefix(
        %AgentRun{plan: %AgentPlan{steps: current_steps}} = run,
        %AgentPlan{} = revised
      ) do
    completed_count = min(length(run.completed_step_refs || []), length(current_steps))
    completed = Enum.take(current_steps, completed_count)
    revised_steps = List.wrap(revised.steps)

    cond do
      completed == [] ->
        :ok

      length(revised_steps) <= completed_count ->
        {:error, :completed_prefix_changed}

      same_prefix?(completed, revised_steps, completed_count) ->
        :ok

      true ->
        {:error, :completed_prefix_changed}
    end
  end

  def validate_completed_prefix(_run, %AgentPlan{}), do: :ok

  defp same_prefix?(_completed, _revised_steps, 0), do: true

  defp same_prefix?(completed, revised_steps, count) do
    revised_steps
    |> Enum.take(count)
    |> Enum.zip(completed)
    |> Enum.all?(fn {revised_step, completed_step} ->
      prefix_identity(revised_step) == prefix_identity(completed_step)
    end)
  end

  defp prefix_identity(step) when is_map(step) do
    {
      Map.get(step, :step_id),
      Map.get(step, :kind),
      Map.get(step, :target_tool_ref),
      Map.get(step, :target_chapter_ref),
      Map.get(step, :target_word_count)
    }
  end

  defp prefix_identity(step), do: step

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
        NovelTelemetry.LogEmit.emit(:plan_draft, :authoring_intent_degrade, :done, %{
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

  # B39 CP1：检索步（共享 ExplorationStep，0 provider 调用）；不得为单一要素加专用分支。
  defp plan_step_targets("prose_drafting_with_quality_v1"),
    do: [
      "context_assemble",
      "chapter_mission",
      "prose_search",
      "chapter_read",
      "archive_read",
      "memory_recall",
      "prose_writing"
    ]

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

  @doc false
  @spec draft_context_block(AgentRun.t(), map(), map() | [String.t()]) :: String.t()
  def draft_context_block(%AgentRun{} = run, snapshot, chapter_titles) do
    scope_sections(run, snapshot, chapter_titles)
    |> Enum.join("\n\n")
  end

  defp scope_sections(run, snapshot, chapter_titles) do
    [
      """
      ## 调用点参数
      - profile_ref: #{run.profile_ref}
      - plan_step_targets: #{Enum.join(allowed_targets(run), ", ")}
      - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}

      ## 可用能力说明
      #{step_catalog(run.profile_ref)}
      """,
      String.trim(accepted_chapters_section(chapter_titles, run.goal.text)),
      """
      ## 本轮目标
      - author_goal: #{run.goal.text}
      - goal_version: #{run.goal.version}
      - current_plan_version: #{run.plan_version || 1}
      - next_plan_version: #{next_plan_version(run)}
      - stage_state_keys: #{stage_state_keys(snapshot)}
      - run_id: #{run.run_id}
      """,
      plan_arguments_contract(allowed_targets(run))
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.map(&String.trim/1)
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
    (scope_sections(run, snapshot, chapter_titles) ++
       [
         "## 修订触发原因\n#{revision_reason}",
         "## 当前计划\n#{current_plan_json(run)}",
         "## 最近观察\n#{observation_lines(snapshot)}"
       ])
    |> Enum.join("\n\n")
  end

  defp operation_spec(run, snapshot, chapters, kind, revision_reason, opts) do
    tool_name = if kind == :draft, do: @draft_tool_name, else: @revision_tool_name

    scope =
      if kind == :draft,
        do: draft_context_block(run, snapshot, chapters),
        else: revision_context_block(run, snapshot, chapters, revision_reason)

    %{
      role: tool_name,
      instructions: planner_instructions(kind, tool_name),
      scope: scope,
      tool: plan_tool(tool_name),
      source_refs: planner_source_refs(run, chapters, snapshot),
      versions: %{"goal_version" => run.goal.version, "plan_version" => run.plan_version || 1},
      # VS-00L §3.2（裁决 A）：版本引用进入 canonical system 前缀。
      system_versions: %{
        constitution_version: NovelApplication.AuthoringTaskPolicy.version(),
        output_protocol_version: NovelApplication.JudgmentToolContract.version()
      },
      author_text: Keyword.get(opts, :author_text)
    }
  end

  defp planner_source_refs(run, chapters, snapshot) do
    {listed, _omitted} =
      NovelApplication.ChapterListBudget.project_entries(
        chapters_payload(chapters).entries,
        run.goal.text
      )

    chapter_refs =
      for entry <- listed,
          id = Map.get(entry, :id),
          is_binary(id),
          do: "chapter:" <> id

    observation_refs =
      for observation <- snapshot |> map_get(:observations) |> List.wrap() |> Enum.take(-8),
          ref <- List.wrap(map_get(observation, :evidence_refs)),
          is_binary(ref),
          do: ref

    (chapter_refs ++ observation_refs) |> Enum.uniq() |> Enum.map(&%{ref: &1})
  end

  defp planner_instructions(kind, tool_name) do
    role = if kind == :draft, do: "AgentRun 计划起草器", else: "AgentRun 计划修订器"
    heading = if kind == :draft, do: "计划要求", else: "修订要求"

    """
    本次你承担 #{role}的角色，只提出计划，不批准执行。
    共同任务规则版本：#{NovelApplication.AuthoringTaskPolicy.version()}。
    #{NovelApplication.AuthoringTaskPolicy.rules()}

    ## #{heading}
    #{plan_requirements(kind)}
    - 每个 PlanStep 必须有 target_tool_ref，且只能来自本轮 plan_step_targets；不在该列表中的能力不能作为独立步骤。
    - 能力目录中的「依赖」声明是硬约束：依赖步骤必须在使用它的步骤之前，不可省略。
    - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw / target_chapter_ref；作者点名章按作品章节列表精确复制全名，并逐字复制该条索引里的 chapter_ref。无法确定时填 null。
    - authoring_intent 只能取 continuation / rewrite / null（枚举，非描述文字）；作者要求接着写、继续写、往下写时必须填 continuation。
    - 作者明确篇幅诉求时 prose_writing 步携带 target_word_count 整数估计；没有诉求填 null。
    - 不执行步骤，不声称产物已经生成或采纳，不输出工具结果。

    ## 输出契约
    调用 #{tool_name} 给出完整计划；content 可同时说明事实、理由和影响范围。
    author_reasoning 保留作者可见说明原话，空 content 时从该字段展示。
    #{plan_argument_rules()}
    """
    |> String.trim()
  end

  defp plan_requirements(:draft),
    do: "- 计划必须是当前作者目标的动态计划，不要复述固定模板。\n- 普通路径应覆盖完成目标所需最少步骤；不要添加纯收束模型调用。"

  defp plan_requirements(:revision),
    do:
      "- 输出完整修订计划，保留已经完成的前缀步骤；未完成步骤只追加或替换为当前目标仍需要的步骤。\n- 如果计划已走完但完成条件未满足，必须补足能够让运行继续取得真实进展的最少步骤。"

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
    - prose_search | explore | 检索已采纳正文；必须携带 exploration_query
    - chapter_read | explore | 读取指定章节正文/摘要；必须携带 exploration_query
    - archive_read | explore | 读取作品档案/统计；必须携带 exploration_query
    - memory_recall | explore | 检索已确认记忆；必须携带 exploration_query
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

  # P1 可达性：真实模型常把 arguments 只写成 {"plan":{...}}，漏掉另三个顶层必填字段。
  # 契约本身不改（schema 仍 required + additionalProperties=false）；prompt 给显式骨架，
  # 说明 plan 只是顶层字段之一，避免“只包 plan”的可达性缺口。
  defp plan_arguments_contract(targets) do
    """
    ### arguments JSON 骨架（顶层四字段缺一不可，plan 不是唯一包裹）
    本轮合法字段与能力目标的最小示例（按当前任务填写，不照抄占位）：
    #{plan_arguments_skeleton(targets)}
    """
    |> String.trim()
  end

  defp plan_argument_rules do
    """
    必须返回一个 JSON object，顶层同时包含 plan / author_reasoning / reason_codes / confidence：
    - plan 必须是 arguments 的一个顶层字段；只返回 {"plan":{...}} 会因缺少 author_reasoning / reason_codes / confidence 被校验拒绝。
    - plan.steps 每步必须含 step_id / kind / description / success_criteria / target_tool_ref；kind 只能是 explore 或 act。
    - prose_writing 步必须在 step 对象里显式写 "authoring_intent" 键：continuation / rewrite / null（写新章也要有该键，不能省略）；同时带 target_chapter / requested_chapter_raw / target_chapter_ref，无值填 null。
    - author_reasoning 是作者可见计划说明原文；reason_codes 是字符串数组；confidence 是 0..1 数字。
    - 不要加额外顶层字段，不要服务端补字段（系统不会替你补）。
    """
    |> String.trim()
  end

  defp plan_feedback(%{reason: reason}, run, tool_name) do
    targets = allowed_targets(run)

    message =
      """
      你上一次的 AgentRun 计划 tool call 无法被系统解析（#{inspect(reason)}）。请严格重新输出同一任务：
      - 必须调用 #{tool_name}，且只调用这一个 tool（function name 必须是 #{tool_name}，不能把 auto 当 function name）。
      - arguments 是 JSON object，顶层只能是四个字段：plan / author_reasoning / reason_codes / confidence。
      - plan 只是其中一个顶层字段，不能只返回 {"plan":{...}}；四个顶层字段缺一不可，不要添加 status、title、body 等额外字段。
      - plan 只能是 {"steps": [PlanStep, ...]}；plan.steps 每步必须有 step_id / kind / description / success_criteria / target_tool_ref；kind 只能取 "explore" 或 "act"。
      - prose_writing 步必须显式携带 authoring_intent（continuation / rewrite / null）；target_chapter / requested_chapter_raw / target_chapter_ref 无值填 null。
      - 检索步（prose_search/chapter_read/archive_read/memory_recall）可带 exploration_query 字符串；非检索步填 null 或省略。
      - 合法最小骨架（按当前任务填写，不照抄占位）：
        #{plan_arguments_skeleton(targets)}
      #{targets_guidance(targets)}#{shape_guidance(reason, tool_name)}#{field_guidance(reason)}
      """
      |> String.trim()

    %{
      reason_code: "agent_plan_protocol_violation",
      detail: %{correction: message, reason: inspect(reason)},
      message: message
    }
  end

  # 纠错骨架必须包含 prose_writing 步的 authoring_intent（写新章也必须显式 null），
  # 否则模型照抄骨架仍会 missing_authoring_intent。
  defp plan_arguments_skeleton(targets) do
    skeleton_target = List.first(targets) || "context_assemble"

    steps =
      [plan_step_skeleton("s1", "explore", skeleton_target, [])] ++
        if "prose_writing" in List.wrap(targets) do
          [
            plan_step_skeleton("s2", "act", "prose_writing", [
              {"write_intent", "tentative"},
              {"authoring_intent", "continuation"},
              {"target_chapter", "..."},
              {"requested_chapter_raw", nil},
              {"target_chapter_ref", nil}
            ])
          ]
        else
          []
        end

    Jason.encode!(%{
      "plan" => %{"steps" => steps},
      "author_reasoning" => "...",
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    })
  end

  defp plan_step_skeleton(step_id, kind, target, extra_fields) do
    Map.merge(
      %{
        "step_id" => step_id,
        "kind" => kind,
        "description" => "...",
        "success_criteria" => ["..."],
        "target_tool_ref" => target
      },
      Map.new(extra_fields)
    )
  end

  defp targets_guidance([]), do: ""

  defp targets_guidance(targets) do
    "\n- 本任务可用 plan_step_targets（target_tool_ref 只能取这些）：#{Enum.join(targets, "、")}"
  end

  defp field_guidance({:invalid_plan_tool_arguments, errors})
       when is_list(errors) and errors != [] do
    "\n- 上次被拒的具体字段问题（逐项修正）：\n" <>
      Enum.map_join(Enum.take(errors, 12), "\n", &"  - #{&1}")
  end

  defp field_guidance({:invalid_plan_tool_arguments, []}) do
    "\n- 上次 arguments 未返回具体字段差异；请按上面的顶层四字段与 plan.steps 必填字段重新逐项自检。"
  end

  defp field_guidance(_reason), do: ""

  defp shape_guidance(:native_tool_call_required, tool_choice) do
    "\n- 上次没有返回 native tool call：必须通过 tool_calls 返回 #{tool_choice}，arguments 是 JSON object（不要只输出 content/文本/XML）"
  end

  defp shape_guidance({:native_tool_call_count_invalid, 0}, tool_choice) do
    "\n- 上次没有返回 native tool call（tool_calls 为空）：必须通过 tool_calls 返回 #{tool_choice}，arguments 是 JSON object（不要只输出 content/文本）"
  end

  defp shape_guidance({:native_tool_call_count_invalid, count}, tool_choice) do
    "\n- 上次返回 #{count} 个 tool call；本次只返回 1 个 #{tool_choice}，不要附加其他工具"
  end

  defp shape_guidance(:json_object_required, _tool_choice) do
    "\n- arguments 必须是 JSON object（不是 JSON 字符串、不能套信封）"
  end

  defp shape_guidance(_reason, _tool_choice), do: ""

  defp parse_tool_call_result(provider_result, tool_name) do
    case parse_tool_call_result_detailed(provider_result, tool_name) do
      {:error, {:invalid_plan_tool_arguments, _errors}} -> {:error, :invalid_plan_tool_arguments}
      other -> other
    end
  end

  # task-30：结构纠正回执要携带具体字段指引，先拿到字段级错误再进入重试/终局。
  defp parse_tool_call_result_detailed(provider_result, tool_name) do
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
      {:error,
       {:invalid_plan_tool_arguments,
        NovelApplication.AgentPlanToolContract.validation_errors(args)}}
    end
  end

  defp matching_tool_arguments(calls, _tool_name),
    do: {:error, {:native_tool_call_count_invalid, length(calls)}}

  defp require_json_object(parsed) when is_map(parsed), do: {:ok, parsed}
  defp require_json_object(_parsed), do: {:error, :json_object_required}

  defdelegate plan_tool(name \\ @draft_tool_name),
    to: NovelApplication.AgentPlanToolContract,
    as: :tool

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
    observation
    |> base_observation_line()
    |> append_finding_lines(observation.structured_payload)
  end

  defp observation_line(observation) when is_map(observation) do
    observation
    |> base_observation_line()
    |> append_finding_lines(map_get(observation, :structured_payload))
  end

  defp observation_line(observation), do: "- #{inspect(observation)}"

  defp base_observation_line(observation) do
    "- #{map_get(observation, :observation_id)} / #{map_get(observation, :observation_type)}: #{map_get(observation, :summary)}"
  end

  # T4（UA01 T3-T5）：finding 的结构字段必须进入修订观察，不能被 summary 摘要冒充。
  # 上限 5 条、每条 summary 240 字；超出部分显式标 …(+N)，不伪造完整观察。
  defp append_finding_lines(line, %{} = payload) do
    findings = map_get(payload, :findings) |> List.wrap()

    if findings == [] do
      line
    else
      shown = Enum.take(findings, 5)
      hidden = max(length(findings) - length(shown), 0)

      finding_lines =
        Enum.map(shown, fn finding ->
          gate = map_get(finding, :quality_gate_ref) || map_get(finding, :gate) || "unknown_gate"
          severity = map_get(finding, :severity) || "unknown"
          summary = map_get(finding, :summary) || ""
          summary = String.slice(to_string(summary), 0, 240)
          "  · finding [#{gate}, severity=#{severity}] #{summary}"
        end)

      tail = if hidden > 0, do: ["  · finding …(+#{hidden})"], else: []
      Enum.join([line | finding_lines ++ tail], "\n")
    end
  end

  defp append_finding_lines(line, _payload), do: line

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
