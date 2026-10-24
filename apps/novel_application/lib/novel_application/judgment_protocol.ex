defmodule NovelApplication.JudgmentProtocol do
  @moduledoc "B26/B27：单调用 auto 判断/续行协议；先校验整个响应，再交业务边界派发。"
  alias NovelAgent.Provider.{Execution, InferenceParams}

  alias NovelApplication.{
    AgentNarrativeSource,
    AuthoringTaskPolicy,
    JudgmentToolContract,
    PendingArtifactWorkflow,
    ProviderActivityProjector,
    TurnInteractionService
  }

  require NovelCommon.LogEmit, as: LogEmit

  @max_attempts 2
  @error_excerpt_chars 400
  @write_intent_reason_re ~r/写入|保存|存档|落库|存入|登记进|写进/
  @type judgment :: map()
  def tool_name, do: "judgment_decision"
  def continuation_tool_name, do: "continuation_decision"
  def actions(_opts \\ []), do: ~w(execute plan explore)

  def request_judgment(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :judgment)

  def request_continuation(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :continuation)

  defp request(provider, snapshot, input, profile) do
    result_fn =
      provider
      |> Execution.with_purpose(:planner)
      |> Execution.with_content_visibility(:author)
      |> Execution.with_params(InferenceParams.new(temperature: 0.2))
      |> ProviderActivityProjector.with_stage_sink(snapshot,
        purpose: :planner,
        content_visibility: :author
      )
      |> Execution.result_fn()

    if is_function(result_fn, 1),
      do: invoke(result_fn, prompt(input, profile), input, profile, 1),
      else: {:error, :provider_execution_required}
  end

  defp invoke(fun, prompt, input, profile, attempt) do
    case fun.(prompt) do
      {:ok, provider_result} ->
        validate_response(fun, prompt, input, profile, attempt, provider_result)

      {:error, _reason} when attempt < @max_attempts ->
        LogEmit.emit(:judgment, :provider_retry, :start, %{
          attempt: attempt,
          reason_code: "provider_request_failed"
        })

        invoke(fun, prompt, input, profile, attempt + 1)

      {:error, _} = error ->
        error
    end
  end

  defp validate_response(fun, prompt, input, profile, attempt, provider_result) do
    case decode(provider_result, profile, input) do
      {:ok, judgment} ->
        {:ok, Map.put(judgment, :provider_call_count, attempt)}

      {:error, reason} ->
        LogEmit.emit(:judgment, :output_validation, :done, %{
          outcome: if(attempt < @max_attempts, do: "retry", else: "rejected"),
          reason_code: validation_reason_code(reason),
          reason: inspect(reason),
          attempt: attempt
        })

        correct_or_reject(fun, prompt, input, profile, attempt, reason)
    end
  end

  # 用户可见动作为空内容时，纠错必须明确“需要非空作者可见文本”，而不是泛泛说结构。
  defp correction_content(:judgment_narrative_required) do
    "本次响应未通过契约校验：judgment_narrative_required（缺少作者可见内容）。" <>
      "纯文本回复/登记/缺口说明等用户可见动作必须给出非空 content；只输出思考、空 content 或“[assistant reasoning omitted]”这类占位词不算回复。" <>
      "请用一两句自然中文给出实际回复；使用工具时 content 可为空但 question/reason/author_reasoning 必须提供作者可见原话。" <>
      "保留同一作者输入、来源、目标、范围与权限，只补足可见内容。"
  end

  # M18：指代历史原文但把其它消息/指令当来源时，给出可执行的来源纠正路径。
  defp correction_content(
         {:author_content_registration_invalid, :anaphoric_current_source_requires_explicit_text}
       ) do
    "本次响应未通过契约校验：anaphoric_current_source_requires_explicit_text（作者在指代过去的资料，current 不是合法来源）。" <>
      "current 只适用于本条消息本身就是被登记原文。请选择其一：改用已列出的合法历史来源，且仅当该来源完整原文就是作者指代的资料；用 judgment_decision.explore 取证合法来源；或用 ask_author 请作者指出来源/贴出原文。" <>
      "不得把历史指令、会话摘要或保存指令当作原文，也不得先登记再说明来源不含内容。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正来源选择。"
  end

  # invalid_tool_combination 是模型最容易重复的协议错误：纠错回执必须给出可执行的
  # 合法组合指引（同源 helper），让一次纠错可修复；其它 reason 文案保持不变。
  defp correction_content(:invalid_tool_combination) do
    "本次响应未通过契约校验：invalid_tool_combination（工具组合非法）。" <>
      JudgmentToolContract.legal_combination_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正工具组合；不要扩大操作或复述失败响应。"
  end

  defp correction_content({:invalid_tool_combination, _detail}),
    do: correction_content(:invalid_tool_combination)

  defp correction_content(reason) do
    "本次响应未通过契约校验：#{inspect(reason) |> String.slice(0, @error_excerpt_chars)}。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正不合法结构；不要扩大操作或复述失败响应。"
  end

  defp correct_or_reject(fun, prompt, input, profile, attempt, reason)
       when attempt < @max_attempts do
    correction = %{role: "user", content: correction_content(reason)}

    invoke(
      fun,
      %{prompt | messages: prompt.messages ++ [correction]},
      input,
      profile,
      attempt + 1
    )
  end

  defp correct_or_reject(_, _, _, _, _, {family, _} = reason)
       when family in [:author_content_registration_invalid, :pending_artifact_invalid],
       do: {:error, reason}

  defp correct_or_reject(_, _, _, _, _, reason),
    do: {:error, {:judgment_protocol_violation, reason}}

  defp validation_reason_code({_, reason}) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(_), do: "invalid_response"

  @doc "实际生产构造器；固定 schema/profile，动态事实在消息中更新。"
  def prompt(input, profile \\ :judgment) do
    %{
      messages: [%{role: "user", content: content(input, profile)}],
      tools: JudgmentToolContract.tools(profile),
      tool_choice: "auto"
    }
  end

  defp content(input, :judgment) do
    options = Map.get(input, :options, [])

    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。
    共同任务规则版本：#{AuthoringTaskPolicy.version()}；工具协议版本：#{JudgmentToolContract.version()}。
    #{AuthoringTaskPolicy.rules()}

    ## 当前作品与实际观察
    #{Map.get(input, :context_block, "")}

    ## 当前可用操作（效果与权限，以本轮真实目录为准）
    #{AuthoringTaskPolicy.operations(options)}
    #{Map.get(input, :author_content_context, "")}

    ## 作者输入
    #{Map.fetch!(input, :author_text)}

    ## 来源与原文登记
    #{TurnInteractionService.author_registration_rules()}
    合法原文来源：#{Jason.encode!(["current" | Keyword.get(options, :author_content_sources, [])])}

    ## 决策与输出契约
    普通问答或分析整段 content 就是回复，无需调工具，无固定开场或空行格式。
    需要可点击创作方向时用 propose_creative_directions；原文物化用 register_author_content；
    真实缺少操作效果用 report_capability_gap；需要作者决定仅用 ask_author，可不给选项。
    单个创作产物用 judgment_decision.execute，capability 必须在本轮目录；只读取证仅用
    judgment_decision.explore + explore_request{tool,query}，不能直接调用探索目录里的 native tool。
    只读探索当前允许：#{Keyword.get(options, :explore, false)}；目录：#{Jason.encode!(Keyword.get(options, :explore_tools, []))}。
    多个相互依赖的产物/阶段才用 judgment_decision.plan，且必须与 agent_plan_draft 同批返回。
    #{JudgmentToolContract.legal_combination_guidance()}
    模型工具调用不代表执行授权。
    用户可见动作必须有可见文本：纯文本回复必须给出非空 content（只输出思考/占位词不算回复）；
    使用工具时 content 可为空，但 question/reason/author_reasoning 必须提供作者可见原话。
    能力缺口优先：作者要求的效果（例如修改已有角色身份主档案、整章排版并保证字句不变）
    在当前可用操作目录里确实没有对应能力时，必须用 report_capability_gap 说明缺失效果与最近可行路径；
    不得用 ask_author 问“你要哪一种”来代替缺口报告，也不得用近似操作冒充。
    ask_author 只用于需要作者裁决方向/对象/范围且材料无法消歧，不是能力缺口的替代品。
    已有候选优先：pending_adoptions 中存在候选且本轮作者明确要对某个已有候选做修改/整理/排版/润色时，
    直接选择 revise_pending_artifact 并用 artifact_ref 引用该候选，不要先 ask_author。
    候选正文预览可能为空，不代表对象不存在——修订工具会读取真实候选全文；只有对象/范围确实无法消歧时才问。
    提供资料但只要求收下时不调工具、不生成方向/候选；保存指令不能代替被引用原文。
    """
  end

  defp content(input, :continuation) do
    """
    本次你根据真实产出与偏离判断是否继续当前任务。
    共同任务规则版本：#{AuthoringTaskPolicy.version()}；工具协议版本：#{JudgmentToolContract.version()}。
    #{AuthoringTaskPolicy.rules()}

    ## 当前目标
    #{Map.fetch!(input, :goal_text)}
    ## 偏离事实
    #{Map.fetch!(input, :deviation_summary)}
    ## 当前观察
    #{Map.get(input, :observation_block) || "（暂无观察）"}

    ## 决策与输出契约
    可以按已有事实修正时用 continuation_decision，action=continue 并给具体 guidance。
    只有需要作者决定时用 ask_author；真正缺少能力效果用 report_capability_gap。
    一次只返回一个工具，不能只给文本，不把应用故障或预算停止伪造成作者问题。
    content 可同时自然说明；空 content 时 reason/question/author_reasoning 保留作者可见原话。
    """
  end

  defp decode(result, profile, input) when is_map(result) do
    calls = field(result, :tool_calls) || []

    options =
      input
      |> Map.get(:options, [])
      |> Keyword.put(
        :author_text,
        Map.get(input, :author_text) || Map.get(input, :goal_text) || ""
      )

    with :ok <- validate_tools(calls, profile),
         {:ok, operation, args, call} <- operation(calls, profile),
         :ok <- validate_operation(operation, args, options),
         {:ok, text, source} <- narrative(result, call, args) do
      judgment = normalized(operation, args, call, result, text, source, input)
      validate_inline_plan(judgment, input)
    end
  end

  defp decode(_, _, _), do: {:error, :invalid_judgment_result}

  defp validate_tools(calls, profile) do
    case JudgmentToolContract.validate(calls, profile) do
      {:error, :invalid_tool_arguments} -> registration_schema_error(calls)
      result -> result
    end
  end

  defp registration_schema_error([call]) do
    args = field(call, :arguments)

    if field(call, :name) == "register_author_content" and is_map(args) and
         field(args, :author_content_source_ref) in [nil, ""],
       do: {:error, {:author_content_registration_invalid, :source_required}},
       else: {:error, :invalid_tool_arguments}
  end

  defp registration_schema_error(_), do: {:error, :invalid_tool_arguments}

  defp validate_inline_plan(%{plan_result: result} = judgment, input) when is_map(result) do
    case get_in(input, [:options, :plan_run]) do
      nil ->
        {:ok, judgment}

      run ->
        with {:ok, _plan, _meta} <-
               NovelApplication.AgenticPlanDraftPlanner.plan_from_result(run, result),
             do: {:ok, judgment}
    end
  end

  defp validate_inline_plan(judgment, _input), do: {:ok, judgment}

  defp operation([], :judgment), do: {:ok, "reply", %{}, nil}

  defp operation([call], _) do
    args = field(call, :arguments)

    case field(call, :name) do
      "judgment_decision" -> {:ok, field(args, :action), args, call}
      "continuation_decision" -> {:ok, "continue", args, call}
      "ask_author" -> {:ok, "await_author", args, call}
      "register_author_content" -> {:ok, "author_content_registration", args, call}
      "propose_creative_directions" -> {:ok, "creative_directions", args, call}
      "report_capability_gap" -> {:ok, "capability_gap", args, call}
      _ -> {:error, :invalid_tool_combination}
    end
  end

  defp operation(calls, :judgment) when length(calls) == 2 do
    names = Enum.map(calls, &field(&1, :name)) |> Enum.sort()
    decision = Enum.find(calls, &(field(&1, :name) == "judgment_decision"))

    if names == ["agent_plan_draft", "judgment_decision"] and
         field(field(decision, :arguments), :action) == "plan",
       do: {:ok, "plan", field(decision, :arguments), decision},
       else: {:error, :invalid_tool_combination}
  end

  defp operation(_, _), do: {:error, :invalid_tool_combination}

  defp validate_operation("execute", args, options) do
    capability = field(args, :capability)

    targets =
      Map.merge(
        Keyword.get(options, :pending_artifact_targets, %{}),
        Keyword.get(options, :adopted_content_targets, %{})
      )

    cond do
      capability not in Keyword.get(options, :capabilities, []) ->
        {:error, :capability_not_available}

      not is_nil(field(args, :explore_request)) ->
        {:error, :incompatible_operation_fields}

      capability in Keyword.get(options, :readonly_capabilities, []) and
          Regex.match?(@write_intent_reason_re, field(args, :reason)) ->
        {:error, :judgment_semantic_conflict}

      true ->
        PendingArtifactWorkflow.validate(args, targets)
    end
  end

  defp validate_operation("explore", args, options) do
    request = field(args, :explore_request)

    available =
      Keyword.get(options, :explore, false) and is_map(request) and
        field(request, :tool) in Keyword.get(options, :explore_tools, [])

    cond do
      not available ->
        {:error, :exploration_not_available}

      not empty_targets?(args) ->
        {:error,
         {:incompatible_operation_fields,
          "explore 只提供 explore_request；capability/候选目标仅用于 execute，请保留取证意图并纠正字段。"}}

      true ->
        :ok
    end
  end

  defp validate_operation("plan", args, _) do
    if empty_targets?(args) and is_nil(field(args, :explore_request)),
      do: :ok,
      else: {:error, :incompatible_operation_fields}
  end

  defp validate_operation("author_content_registration", args, options) do
    TurnInteractionService.validate_author_registration(
      Map.put(args, "action", "author_content_registration"),
      Keyword.get(options, :author_content_sources, []),
      Keyword.get(options, :author_text, "")
    )
  end

  defp validate_operation("await_author", args, _) do
    values = Enum.map(field(args, :options), &field(&1, :value))

    if values == Enum.uniq(values) and Enum.all?(values, &(&1 == String.trim(&1))),
      do: :ok,
      else: {:error, :question_option_values_invalid}
  end

  # 缺口说明的 alternative_operation_refs 允许引用本轮真实可用的：
  # 能力目录、只读探索目录、或判断层工具（如 register_author_content）。
  # 仍然拒绝不存在的操作名（不发明操作），但不把“真实可用的下一步”误判成非法。
  @judgment_tool_refs ~w(judgment_decision ask_author agent_plan_draft
                          register_author_content propose_creative_directions
                          report_capability_gap)

  defp validate_operation("capability_gap", args, options) do
    refs = field(args, :alternative_operation_refs) || []

    allowed =
      Keyword.get(options, :capabilities, []) ++
        Keyword.get(options, :explore_tools, []) ++ @judgment_tool_refs

    if Enum.all?(refs, &(&1 in allowed)),
      do: :ok,
      else: {:error, :alternative_operation_not_available}
  end

  defp validate_operation(_, _, _), do: :ok

  defp empty_targets?(args),
    do:
      Enum.all?(
        [:capability, :pending_artifact_ref, :adopted_content_ref],
        &is_nil(field(args, &1))
      )

  defp narrative(result, call, args) do
    content = field(result, :content)

    if nonblank?(content),
      do: content_narrative(result, content),
      else: tool_narrative(result, call, args)
  end

  defp content_narrative(result, text) do
    case sanitize_visible_content(text) do
      nil ->
        {:error, :judgment_narrative_required}

      visible ->
        with {:ok, source} <- AgentNarrativeSource.from_provider_result(result, visible),
             do: {:ok, visible, source}
    end
  end

  # 厂商/网关在只有私有推理时会返回 "[assistant reasoning omitted]" 之类的占位行；
  # 它不是作者内容，不能展示、也不能当作非空回复。纯占位 → 视为空内容（走纠错），
  # 占位行+真实文本 → 去掉占位行并保留可追溯的真实字节（仍是 provider output 子串）。
  @provider_placeholder_lines [
    "[assistant reasoning omitted]",
    "[assistant reasoning internal]"
  ]

  defp sanitize_visible_content(text) when is_binary(text) do
    lines = String.split(text, "\n")

    if Enum.any?(lines, &provider_placeholder_line?/1) do
      cleaned =
        lines
        |> Enum.reject(&provider_placeholder_line?/1)
        |> Enum.join("\n")
        |> String.trim()

      if cleaned == "", do: nil, else: cleaned
    else
      # 没有占位行时保持 provider 输出字节不变（N-NARR 绑定与既有空白语义）。
      text
    end
  end

  defp sanitize_visible_content(_text), do: nil

  defp provider_placeholder_line?(line),
    do: String.trim(line) in @provider_placeholder_lines

  defp tool_narrative(_result, nil, _args), do: {:error, :judgment_narrative_required}

  defp tool_narrative(result, call, args) do
    key = narrative_field(field(call, :name))
    text = field(args, key)

    if nonblank?(text) do
      with {:ok, source} <-
             AgentNarrativeSource.from_tool_call_narrative(result, field(call, :name), text, key),
           do: {:ok, text, source}
    else
      {:error, :judgment_narrative_required}
    end
  end

  defp narrative_field("ask_author"), do: :question

  defp narrative_field(name) when name in ["judgment_decision", "continuation_decision"],
    do: :reason

  defp narrative_field(_), do: :author_reasoning
  defp nonblank?(text), do: is_binary(text) and String.trim(text) != ""

  defp normalized(operation, args, call, result, text, source, input) do
    calls = field(result, :tool_calls) || []
    plan_call = Enum.find(calls, &(field(&1, :name) == "agent_plan_draft"))

    %{
      action: operation,
      capability: field(args, :capability),
      reason: field(args, :reason) || operation,
      frame_type: frame_type(operation),
      dialogue_goal: field(args, :dialogue_goal),
      pending_artifact_ref: field(args, :pending_artifact_ref),
      adopted_content_ref: field(args, :adopted_content_ref),
      explore_request: explore_request(field(args, :explore_request)),
      candidate_directions: field(args, :candidate_directions) || [],
      author_content_source_ref: field(args, :author_content_source_ref),
      question: field(args, :question),
      options: field(args, :options) || [],
      reason_codes: field(args, :reason_codes) || [],
      guidance: field(args, :guidance),
      missing_effect: field(args, :missing_effect),
      narrative: text,
      narrative_source: source,
      tool_call_id: field(call, :id),
      provider_result: result,
      plan_result: if(plan_call, do: Map.put(result, :tool_calls, [plan_call])),
      author_input: Map.get(input, :author_text) || Map.get(input, :goal_text),
      model_interpretation_status: if(operation == "reply", do: "not_provided", else: "provided"),
      reply_record: reply_record(operation, args, text, source, input)
    }
  end

  defp reply_record(operation, args, text, source, input) do
    observations = input[:observations] || []

    %{
      response_kind: if(operation == "reply", do: "plain_text", else: "structured_tool"),
      provider_call_ref: source.provider_call_ref,
      task_policy_version: AuthoringTaskPolicy.version(),
      protocol_version: JudgmentToolContract.version(),
      source_input_ref: input[:source_input_ref],
      supplied_context_refs: input[:supplied_context_refs] || [],
      exploration_call_count: length(observations),
      observation_refs: Enum.flat_map(observations, &(&1[:refs] || [])),
      coverage:
        Enum.map(
          observations,
          &Map.take(&1, [:tool, :chapter_ref, :prose_range, :prose_total_chars, :next_offset])
        ),
      model_interpretation_status: if(operation == "reply", do: "not_provided", else: "provided"),
      model_interpretation: if(operation == "reply", do: nil, else: args),
      raw_content: text
    }
  end

  defp frame_type("creative_directions"), do: "creative_exploration"
  defp frame_type("capability_gap"), do: "capability_gap"
  defp frame_type(_), do: "casual_reply"
  defp explore_request(nil), do: nil
  defp explore_request(args), do: %{tool: field(args, :tool), query: field(args, :query)}
  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_, _), do: nil
end
