defmodule NovelApplication.Planner do
  @moduledoc """
  v3 Dialogue Planner — 调用 LLM 形成 DialogueFrame 和 MicroPlan。
  MicroPlan 只是建议，不含执行批准语义。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.AIMessageEnvelope
  alias NovelApplication.CapabilityRegistry
  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @frame_response_field_specs [
    {"frame_type", :non_empty_binary},
    {"dialogue_goal_summary", :non_empty_binary},
    {"needs_tool", :boolean},
    {"no_tool_reason", :non_empty_binary},
    {"execution_readiness", :non_empty_binary},
    {"assistant_message", :non_empty_binary},
    {"candidate_directions", :present},
    {"context_used", :boolean},
    {"uncertainty", :list}
  ]

  @type complete_fn :: (String.t() -> {:ok, map()} | {:error, term()})

  @doc """
  根据 AuthorInput 和 DialogueContext 形成 DialogueFrame 和候选方向。

  `complete_fn` 可注入，默认走 Gateway.complete/1。
  """
  @spec form_frame(map(), DialogueContext.t() | nil, complete_fn()) ::
          {DialogueFrame.t(), [CandidateDirection.t()]}
  def form_frame(
        %{text: text, workspace_id: ws_id} = input,
        context \\ nil,
        complete_fn \\ &Gateway.complete/1
      ) do
    turn_id = Map.get(input, :turn_id) || allocate_turn_id()
    frame_id = Map.get(input, :frame_id) || allocate_frame_id()
    Logger.metadata(turn_id: turn_id, frame_id: frame_id)

    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:planner, :form_frame, :start, %{})

    result =
      with_turn_context(turn_id, "form_frame", fn ->
        call_provider(text, context, complete_fn)
      end)

    case result do
      {:ok, parsed} ->
        duration = System.monotonic_time(:millisecond) - t0

        frame = build_frame(parsed, text, turn_id, frame_id, ws_id, context)

        candidates =
          if frame.frame_type == :creative_exploration and not frame.tool_need.needs_tool do
            build_candidates(parsed, frame.frame_id)
          else
            []
          end

        LogEmit.emit(:planner, :form_frame, :done, %{
          frame_type: frame.frame_type,
          candidate_count: length(candidates),
          duration_ms: duration
        })

        {frame, candidates}

      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0
        reason_code = frame_error_reason_code(reason)

        LogEmit.emit(:planner, :form_frame, :error, %{
          duration_ms: duration,
          reason_code: reason_code,
          outcome_detail: error_detail(reason)
        })

        {fallback_frame(turn_id, frame_id, ws_id, context, reason_code), []}
    end
  end

  @doc """
  基于 DialogueFrame 生成 MicroPlan（行动建议）。

  VS-01：Planner 只能建议，不能批准。Orchestrator 裁决所有执行。

  `complete_fn` 可注入，默认走 Gateway.complete/1。
  `context` 携带已采纳章节标题，供 LLM 识别"续写/重写哪一章"并解析目标章。
  """
  @spec form_micro_plan(DialogueFrame.t(), map(), complete_fn(), DialogueContext.t() | nil) ::
          {:ok, MicroPlan.t()} | {:error, term()}
  def form_micro_plan(
        %DialogueFrame{} = frame,
        author_input,
        complete_fn \\ &Gateway.complete/1,
        context \\ nil
      ) do
    plan_id = "plan_#{System.unique_integer([:positive, :monotonic])}"
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:planner, :form_micro_plan, :start, %{})

    prompt = build_plan_prompt(frame, author_input, context)

    res =
      case with_turn_context(frame.turn_id, "form_micro_plan", fn -> complete_fn.(prompt) end) do
        {:ok, %{content: content}} ->
          content
          |> parse_json()
          |> build_plan_or_retry(content, prompt, complete_fn, plan_id, frame)

        {:error, reason} ->
          {:error, reason}
      end

    duration = System.monotonic_time(:millisecond) - t0

    case res do
      {:ok, _plan} ->
        LogEmit.emit(:planner, :form_micro_plan, :done, %{duration_ms: duration})

      {:error, reason} ->
        LogEmit.emit(:planner, :form_micro_plan, :error, %{
          duration_ms: duration,
          reason_code: reason
        })
    end

    res
  end

  defp build_plan_prompt(frame, author_input, context) do
    tools = CapabilityRegistry.list()

    """
    你是一个小说创作 AI 的规划器。基于已形成的对话认知帧，提出下一步工具调用建议。

    ## 对话认知帧
    - frame_type: #{frame.frame_type}
    - dialogue_goal: #{frame.dialogue_goal.summary}

    ## 当前开放的创作工具 (Capabilities)
    #{Enum.join(tools, ", ")}

    ## 工具选择规则
    - 正文、开篇场景、具体片段、场景描写、动作描写、续写、章节草稿 → prose_writing
    - 大纲、章节规划、分卷、卷数、章节数、剧情走向、角色成长线、势力结构 → plot_outline
    - 角色、人物、小传、动机、关系 → character_design
    - 世界观、规则体系、门派/组织/地理/设定 → world_building
    #{accepted_chapters_section(context)}
    ## 用户输入
    #{author_input.text}

    ## 输出格式（严格 JSON）
    {
      "plan_goal_summary": "建议调用哪个工具来推进创作",
      "risk_hint": "low" | "medium" | "high",
      "proposed_actions": [
        {
          "action_id": "act-1",
          "action_type": "capability_invocation",
          "summary": "人类可读的动作描述",
          "target_ref": "工具名称 (如 world_building, character_design, plot_outline, prose_writing)",
          "write_intent": "none" | "tentative",
          "risk_hint": "low" | "medium" | "high",
          "authoring_intent": "none" | "continuation" | "rewrite",
          "target_chapter": "本次正文针对的作品现有章节标题（从下方章节列表精确复制）；写全新章节或不针对具体章时为 null",
          "requested_chapter_raw": "作者本轮原话点名的具体章节标识（如\"第99章\"），不管它在不在下方列表里，原样填；作者没点名具体章（如\"接着往下写\"）时为 null",
          "target_word_count": 600
        }
      ],
      "required_capabilities": ["world_building"],
      "fallback_message": "如果无法执行，降级为对话时告诉作者什么"
    }

    ## 意图与目标章（针对下方章节列表中的某章时，target_chapter 必填且精确复制）
    - 作者想"写 / 生成"列表里某个具体章节的正文（含还没写正文的计划章，首次成稿）→ authoring_intent = "none"，target_chapter 精确复制该章标题
    - 作者想在某个已有章节"接着往下写 / 继续 / 补一段 / 加场景" → authoring_intent = "continuation"，target_chapter 精确复制该章标题
    - 作者想"推翻重写 / 改写 / 重新写"某个已有章节 → authoring_intent = "rewrite"，target_chapter 精确复制该章标题，risk_hint 用 "high"
    - 写全新章节（不在列表里）、大纲、角色、设定 → authoring_intent = "none"，target_chapter = null
    - 无法确定指向列表里哪一章时，target_chapter = null，不要猜一个不在列表里的标题
    - requested_chapter_raw 与 target_chapter 不同：只要作者点名了某个具体章节，就把作者原话里的章节标识原样填进 requested_chapter_raw（即使它不在列表里，也不要置 null）；只有"接着往下写/继续"这种没点名具体章时才为 null。系统据此判断作者要写的章是否存在。

    ## 篇幅（target_word_count）
    - 作者明确表达了篇幅诉求（如"写约 800 字""三百字左右""短一点""详细展开多写些"）→ target_word_count 给一个整数估计（如 800 / 300 / 1500）
    - 作者没有任何篇幅诉求 → target_word_count = null，不要硬编一个数
    - 只有 prose_writing（正文类）才考虑篇幅；大纲、角色、设定一律 null

    ## 重要
    - proposed_actions 只能包含 capability_invocation 类型的动作
    - 每个 action 的 target_ref 必须指向上面开放工具列表中的一个
    - 不要包含 "approved", "ready_to_execute", "execution_approved" 等批准语义
    - 只需要 1 个 action，不要建议多个
    - risk_hint 默认用 "low"
    """
  end

  defp accepted_chapters_section(%DialogueContext{current_chapters: [_ | _] = chapters}) do
    listed = Enum.map_join(chapters, "\n", &"- #{&1}")

    "\n## 作品章节（target_chapter 必须从此列表精确复制；含已规划但还没写正文的章）\n#{listed}\n"
  end

  defp accepted_chapters_section(_context), do: ""

  defp build_micro_plan(parsed, plan_id, frame) do
    actions =
      parsed
      |> Map.get("proposed_actions", [])
      |> Enum.map(fn a ->
        %{
          action_id:
            Map.get(a, "action_id", "act-#{System.unique_integer([:positive, :monotonic])}"),
          action_type: to_action_type(Map.get(a, "action_type", "clarification_request")),
          summary: Map.get(a, "summary", ""),
          target_ref: Map.get(a, "target_ref"),
          write_intent: to_write_intent(Map.get(a, "write_intent", "none")),
          risk_hint: to_risk_hint(Map.get(a, "risk_hint", "low")),
          authoring_intent: to_authoring_intent(Map.get(a, "authoring_intent")),
          target_chapter: normalize_target_chapter(Map.get(a, "target_chapter")),
          requested_chapter_raw: normalize_target_chapter(Map.get(a, "requested_chapter_raw")),
          target_word_count: normalize_target_word_count(Map.get(a, "target_word_count"))
        }
      end)

    %MicroPlan{
      plan_id: plan_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_goal: %{summary: Map.get(parsed, "plan_goal_summary", "")},
      risk_hint: to_risk_hint(Map.get(parsed, "risk_hint", "low")),
      requires_confirmation_hint: Map.get(parsed, "requires_confirmation_hint", false),
      proposed_actions: actions,
      state_changes_requested: Map.get(parsed, "state_changes_requested", []),
      required_capabilities: Map.get(parsed, "required_capabilities", []),
      fallback_strategy: %{
        downgrade_message: Map.get(parsed, "fallback_message", "这个请求范围比较大，我们先聚焦一个方向。")
      }
    }
  end

  @doc """
  将 ToolResult 综合为自然语言 assistant_message。
  「Planner 负责把工具结果综合成自然语言回应」— 00b §2 主链。
  """
  @spec narrate_tool_result(map(), complete_fn()) :: String.t()
  def narrate_tool_result(tool_result, complete_fn \\ &Gateway.complete/1) do
    prompt = tool_narration_prompt(tool_result)

    case complete_fn.(prompt) do
      {:ok, %{content: content}} ->
        String.trim(content)

      {:error, _} ->
        "工具执行完成。"
    end
  end

  defp tool_narration_prompt(tool_result) do
    output_summary =
      case tool_result.output do
        %{item_count: n, items: items} when n > 0 ->
          titles = items |> Enum.map_join("、", & &1.title)
          "生成了 #{n} 个创作内容：#{titles}"

        %{artifact_type: type, item_count: n} ->
          "生成了 #{n} 个 #{type}"

        other ->
          inspect(other)
      end

    """
    你是一个小说创作 AI。下面是你完成一个创作工具调用后的结果。

    ## 工具执行结果
    - 工具: #{tool_result.tool_name}
    - 状态: #{tool_result.status}
    - 输出摘要: #{output_summary}

    ## 要求
    请用 1-2 句自然中文告诉作者你完成了什么、产出了什么，并引导作者下一步可以做什么（查看、选择、修改建议等）。
    必须明确这些内容只是待确认创作材料，尚未被采纳，也没有写入作品事实。
    不得宣称正文已经完成入库，不得宣称章节计划已经成为正式大纲。
    不要用 markdown，不要重复工具名。
    """
  end

  # ── shared helpers (from VS-00) ──

  defp call_provider(text, context, complete_fn) do
    prompt = build_messages(text, context)

    case complete_fn.(prompt) do
      {:ok, %{content: content}} ->
        case parse_frame_json(content) do
          {:ok, parsed} -> {:ok, parsed}
          {:error, _} -> parse_frame_json_retry(content, prompt, complete_fn)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_messages(text, context) do
    conversation = conversation_prompt(context)

    [%{role: "system", content: system_prompt(text, context, conversation.summary)}] ++
      conversation.messages ++
      [%{role: "user", content: text}]
  end

  defp system_prompt(text, context, session_summary) do
    """
    你是一个小说创作 AI。分析用户消息并返回 JSON。

    #{non_conversation_context_section(context)}

    #{session_summary_section(session_summary)}

    #{AIMessageEnvelope.prompt_section(text, context)}

    ## 输出格式（严格 JSON）
    {
      "frame_type": "casual_reply" | "creative_exploration" | "execution_candidate" | "question_answer" | "meta_discussion",
      "dialogue_goal_summary": "用户本轮想达到什么",
      "needs_tool": true or false,
      "no_tool_reason": "tool_needed" | "no_tool_needed" | "exploratory_only" | "insufficient_execution_target" | "user_requested_discussion",
      "execution_readiness": "ready" | "not_applicable" | "not_ready",
      "assistant_message": "自然语言回应（中文）",
      "candidate_directions": [{"title": "方向标题", "pitch": "一句话吸引力描述", "tone_tags": ["悬疑", "温柔"], "risk_hint": "low"}],
      "context_used": true or false,
      "uncertainty": []
    }

    ## 规则
    - 作者要求“写/生成/产出/描写/续写/规划/安排/整理/开篇场景/正文/章节草稿/具体片段”时，这是创作产出请求，needs_tool 必须为 true，execution_readiness 必须为 "ready"，no_tool_reason 使用 "tool_needed"，candidate_directions 必须为空数组
    - 作者要求“大纲/卷数/章节数/角色成长路线/势力结构/角色设定/世界观设定/剧情设计”等具体交付物时，也属于创作产出请求，needs_tool 必须为 true
    - 如果作者显式说“先聊/只聊/讨论/不要写/不要改/别生成/不保存”，必须按普通对话处理：needs_tool=false，frame_type 不得为 execution_candidate，不能调用工具或写入作品事实
    - 创作产出请求的 frame_type 使用 "execution_candidate"，不要使用 "creative_exploration"
    - 只有作者还在比较方向、头脑风暴、问“怎么切入/几个方案”，且没有要求立刻产出具体文本或设定时，才使用 creative_exploration + needs_tool=false
    - frame_type == "creative_exploration" 且 needs_tool == false 时，candidate_directions 必须包含 2-3 个方向对象
    - frame_type == "creative_exploration" 且 needs_tool == true 时，candidate_directions 必须为空数组
    - frame_type != "creative_exploration" 时，candidate_directions 为空数组
    - 不要输出纯字符串数组，每个方向必须是带 title/pitch/tone_tags 的对象
    - candidate_directions[].risk_hint 可选，只能是 "low" | "medium" | "high"，不确定时用 "low"
    - assistant_message 必须用中文，不要输出 JSON 代码块
    """
  end

  defp session_summary_section(nil), do: ""

  defp session_summary_section(summary) do
    """
    ## 会话摘要
    #{summary}
    """
  end

  defp non_conversation_context_section(%DialogueContext{} = context) do
    parts = [current_work_section(context.current_work_snapshot)]

    parts =
      if context.memory_summary do
        ["## 相关记忆\n#{context.memory_summary}" | parts]
      else
        parts
      end

    parts
    |> Enum.reverse()
    |> Enum.join("\n\n")
  end

  defp non_conversation_context_section(_context),
    do: "## 当前作品上下文\n（无——这是新对话或尚未创建作品）"

  defp current_work_section(nil),
    do: "## 当前作品上下文\n（无——这是新对话或尚未创建作品）"

  defp current_work_section(snapshot) when is_map(snapshot) do
    "## 当前作品上下文\n" <>
      Enum.map_join(snapshot, "\n", fn {key, value} -> "- #{key}: #{value}" end)
  end

  defp conversation_prompt(%DialogueContext{conversation_summary: summary})
       when is_binary(summary),
       do: parse_conversation_prompt(summary)

  defp conversation_prompt(_context), do: %{summary: nil, messages: []}

  defp parse_conversation_prompt(summary) do
    summary
    |> String.split("\n")
    |> Enum.reduce({[], nil, []}, &collect_conversation_line/2)
    |> finalize_conversation_prompt()
  end

  defp collect_conversation_line(line, {messages, current, context_lines}) do
    case Regex.run(~r/^(user|assistant):\s*(.*)$/u, line) do
      [_, role, content] ->
        if session_summary_line?(content) do
          {messages, current, [content | context_lines]}
        else
          {[current | messages], %{role: role, content: content}, context_lines}
        end

      _ ->
        if current do
          {messages, append_conversation_line(current, line), context_lines}
        else
          {messages, nil, [line | context_lines]}
        end
    end
  end

  defp append_conversation_line(nil, _line), do: nil

  defp append_conversation_line(current, line),
    do: %{current | content: current.content <> "\n" <> line}

  defp finalize_conversation_prompt({messages, current, context_lines}) do
    parsed_messages =
      [current | messages]
      |> Enum.reject(&is_nil/1)
      |> Enum.reverse()
      |> Enum.reject(&(String.trim(&1.content) == ""))

    context =
      context_lines
      |> Enum.reverse()
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> case do
        [] -> nil
        lines -> Enum.join(lines, "\n")
      end

    %{summary: context, messages: parsed_messages}
  end

  defp session_summary_line?(content), do: String.starts_with?(String.trim(content), "会话早期摘要")

  # ── JSON parsing with extraction + retry ──────

  defp parse_frame_json(content) do
    with {:ok, parsed} <- parse_json(content),
         :ok <- validate_frame_response(parsed) do
      {:ok, parsed}
    end
  end

  defp parse_json(content) do
    content
    |> extract_json()
    |> then(&Jason.decode(&1))
    |> case do
      {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
      {:error, _} = error -> error
    end
  end

  defp parse_frame_json_retry(failed_content, original_prompt, complete_fn) do
    correction = build_correction_prompt(original_prompt, failed_content)

    case complete_fn.(correction) do
      {:ok, %{content: retry_content}} ->
        case parse_frame_json(retry_content) do
          {:ok, parsed} -> {:ok, parsed}
          {:error, _} -> {:error, :frame_contract_invalid}
        end

      {:error, _} = error ->
        error
    end
  end

  defp parse_json_retry(failed_content, original_prompt, complete_fn) do
    correction = build_correction_prompt(original_prompt, failed_content)

    case complete_fn.(correction) do
      {:ok, %{content: retry_content}} ->
        case parse_json(retry_content) do
          {:ok, parsed} -> {:ok, parsed}
          {:error, _} -> {:error, :json_parse_failed}
        end

      {:error, _} = error ->
        error
    end
  end

  defp extract_json(content) do
    content
    |> strip_code_fence()
    |> find_brace_substring()
  end

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

  defp build_plan_or_retry({:ok, parsed}, _content, _prompt, _complete_fn, plan_id, frame) do
    plan = build_micro_plan(parsed, plan_id, frame)
    {:ok, plan}
  end

  defp build_plan_or_retry({:error, _}, content, prompt, complete_fn, plan_id, frame) do
    case parse_json_retry(content, prompt, complete_fn) do
      {:ok, parsed} ->
        plan = build_micro_plan(parsed, plan_id, frame)
        {:ok, plan}

      {:error, _} ->
        {:error, :json_parse_failed}
    end
  end

  defp build_correction_prompt(original, failed_output) do
    """
    你的上一次响应不是有效的 frame JSON，或缺少必要字段。请严格按照 JSON 格式重试。

    ## 你的上一次响应（截取前 500 字符）
    #{String.slice(failed_output, 0, 500)}

    ## 修正要求
    - 只输出原始要求的 JSON 对象
    - 不要包含任何前缀标记、代码块、或解释文本
    - 直接以 `{` 开始，`}` 结束

    ## 原始要求
    #{prompt_to_text(original)}
    """
  end

  defp prompt_to_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_to_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n\n", fn message -> "#{message.role}: #{message.content}" end)
  end

  defp validate_frame_response(parsed) when is_map(parsed) do
    if Enum.all?(@frame_response_field_specs, &valid_frame_response_field?(parsed, &1)) do
      :ok
    else
      {:error, :frame_contract_invalid}
    end
  end

  defp validate_frame_response(_parsed), do: {:error, :frame_contract_invalid}

  defp valid_frame_response_field?(parsed, {field, :present}), do: Map.has_key?(parsed, field)

  defp valid_frame_response_field?(parsed, {field, :non_empty_binary}),
    do: parsed |> Map.get(field) |> non_empty_binary?()

  defp valid_frame_response_field?(parsed, {field, :boolean}),
    do: parsed |> Map.get(field) |> is_boolean()

  defp valid_frame_response_field?(parsed, {field, :list}),
    do: parsed |> Map.get(field) |> is_list()

  defp non_empty_binary?(value), do: is_binary(value) and String.trim(value) != ""

  defp build_frame(parsed, text, turn_id, frame_id, ws_id, context) do
    context_ref = context && context.workspace_id && "context:#{context.workspace_id}"
    production_intent? = concrete_production_author_input?(text)
    discussion_only? = explicit_discussion_only?(text)

    tool_need = %{
      needs_tool: parsed_needs_tool?(parsed, production_intent?, discussion_only?),
      reason_code: parsed_reason_code(parsed, production_intent?, discussion_only?)
    }

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: frame_id,
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: normalized_frame_type(parsed, text, production_intent?, discussion_only?),
      source_refs: %{
        author_input_ref: "author_input:#{turn_id}",
        dialogue_context_ref: context_ref
      },
      dialogue_goal: %{summary: Map.get(parsed, "dialogue_goal_summary", "用户发来消息")},
      tool_need: tool_need,
      execution_readiness:
        parsed_execution_readiness(Map.get(parsed, "execution_readiness"), tool_need.needs_tool),
      author_visible_draft: %{message: Map.get(parsed, "assistant_message", "收到你的消息。")},
      evidence_summary:
        evidence_summary(
          parsed,
          context,
          AIMessageEnvelope.quality_diagnosis(text, context, turn_id: turn_id)
        ),
      uncertainty: Map.get(parsed, "uncertainty", [])
    }
  end

  defp evidence_summary(parsed, context, nil) do
    %{context_used: Map.get(parsed, "context_used", context != nil)}
  end

  defp evidence_summary(parsed, context, envelope) do
    %{
      context_used: Map.get(parsed, "context_used", context != nil),
      guidance_mode: envelope.turn_guidance_layer.guidance_mode,
      ai_message_envelope: envelope
    }
  end

  defp build_candidates(parsed, frame_id) do
    candidates =
      parsed
      |> candidate_direction_inputs()
      |> Enum.map(fn
        c when is_map(c) ->
          %CandidateDirection{
            direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
            title: c |> Map.get("title", "") |> to_string() |> String.trim(),
            pitch: c |> Map.get("pitch", "") |> to_string() |> String.trim(),
            tone_tags: Map.get(c, "tone_tags", []),
            source_frame_ref: frame_id,
            risk_hint: c |> Map.get("risk_hint", "low") |> to_risk_hint(),
            adoption_status: :not_adopted
          }

        c when is_binary(c) ->
          text = String.trim(c)

          %CandidateDirection{
            direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
            title: text,
            pitch: text,
            tone_tags: [],
            source_frame_ref: frame_id,
            adoption_status: :not_adopted
          }
      end)
      |> Enum.filter(&valid_candidate?/1)

    if candidates == [] do
      fallback_candidates(frame_id)
    else
      candidates
    end
  end

  defp candidate_direction_inputs(parsed) do
    case Map.get(parsed, "candidate_directions", []) do
      candidates when is_list(candidates) -> candidates
      _invalid -> []
    end
  end

  defp valid_candidate?(%CandidateDirection{title: title, pitch: pitch}) do
    title != "" and pitch != ""
  end

  defp fallback_candidates(frame_id) do
    [
      %CandidateDirection{
        direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
        title: "矛盾切入",
        pitch: "先抓住作品里最有冲突感的设定，让主角从压力中心进入故事。",
        tone_tags: ["冲突", "推进"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      },
      %CandidateDirection{
        direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
        title: "人物切入",
        pitch: "从一个有强烈欲望或困境的角色出发，用他的选择带出世界观。",
        tone_tags: ["角色", "共情"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      },
      %CandidateDirection{
        direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
        title: "世界规则切入",
        pitch: "先定义一个反常但有吸引力的世界规则，再让剧情围绕它展开。",
        tone_tags: ["世界观", "设定"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      }
    ]
  end

  defp fallback_frame(turn_id, frame_id, ws_id, context, reason_code) do
    context_ref = context && context.workspace_id && "context:#{context.workspace_id}"

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: frame_id,
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: :casual_reply,
      source_refs: %{
        author_input_ref: "author_input:#{turn_id}",
        dialogue_context_ref: context_ref
      },
      dialogue_goal: %{summary: "用户发来消息"},
      tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: fallback_message(reason_code)},
      evidence_summary: %{fallback: true, context_used: context != nil, reason_code: reason_code},
      uncertainty: []
    }
  end

  defp frame_error_reason_code(:json_parse_failed), do: :json_parse_failed
  defp frame_error_reason_code(:frame_contract_invalid), do: :json_parse_failed
  defp frame_error_reason_code(%{type: :invalid_request}), do: :invalid_request
  defp frame_error_reason_code(%{type: :invalid_response}), do: :invalid_response
  defp frame_error_reason_code(%{type: :timeout}), do: :provider_timeout
  defp frame_error_reason_code(%{type: :connection_refused}), do: :provider_unavailable
  defp frame_error_reason_code(_), do: :provider_error

  defp fallback_message(:json_parse_failed),
    do: "创作引擎返回的格式不符合工作台契约，请重试。"

  defp fallback_message(:invalid_request),
    do:
      "创作引擎拒绝了这次请求：模型参数可能配置有误（如思考模式、推理强度）。这一轮没有创建待采纳内容，也没有写入作品事实。请在模型设置中检查参数后重试。"

  defp fallback_message(:invalid_response), do: "创作引擎返回内容为空，请重试。"

  defp fallback_message(:provider_timeout),
    do: "创作引擎响应超时。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"

  defp fallback_message(_),
    do: "抱歉，我现在无法连接到创作引擎。这一轮没有创建待采纳内容，也没有写入作品事实。你可以检查模型连接后重试，或继续对话。"

  defp error_detail(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp error_detail(reason) when is_binary(reason), do: reason
  defp error_detail(reason), do: inspect(reason)

  defp allocate_turn_id, do: "turn_#{System.unique_integer([:positive, :monotonic])}"
  defp allocate_frame_id, do: "frame_#{System.unique_integer([:positive, :monotonic])}"

  defp with_turn_context(turn_id, step, fun) do
    Process.put(:current_turn_id, turn_id)
    Process.put(:current_step, step)
    fun.()
  after
    Process.delete(:current_turn_id)
    Process.delete(:current_step)
  end

  defp to_frame_type("creative_exploration"), do: :creative_exploration
  defp to_frame_type("execution_candidate"), do: :execution_candidate
  defp to_frame_type("question_answer"), do: :question_answer
  defp to_frame_type("meta_discussion"), do: :meta_discussion
  defp to_frame_type(_), do: :casual_reply

  defp normalized_frame_type(parsed, text, production_intent?, discussion_only?) do
    raw_type = to_frame_type(Map.get(parsed, "frame_type", "casual_reply"))

    cond do
      force_casual_reply?(raw_type, discussion_only?) ->
        :casual_reply

      force_execution_candidate?(parsed, raw_type, production_intent?, discussion_only?) ->
        :execution_candidate

      force_creative_exploration?(raw_type, text, discussion_only?) ->
        :creative_exploration

      true ->
        raw_type
    end
  end

  defp force_casual_reply?(raw_type, true),
    do: raw_type in [:creative_exploration, :execution_candidate]

  defp force_casual_reply?(_raw_type, _discussion_only?), do: false

  defp force_execution_candidate?(_parsed, raw_type, true, _discussion_only?),
    do: raw_type in [:casual_reply, :creative_exploration]

  defp force_execution_candidate?(parsed, :creative_exploration, false, false),
    do: Map.get(parsed, "needs_tool", false) == true

  defp force_execution_candidate?(_parsed, _raw_type, _production_intent?, _discussion_only?),
    do: false

  defp force_creative_exploration?(:casual_reply, text, false),
    do: exploratory_author_input?(text)

  defp force_creative_exploration?(_raw_type, _text, _discussion_only?), do: false

  defp exploratory_author_input?(text) when is_binary(text) do
    if concrete_production_author_input?(text), do: false, else: exploratory_markers?(text)
  end

  defp exploratory_author_input?(_text), do: false

  defp exploratory_markers?(text) do
    markers = ["没想好", "方向", "切入", "想想", "怎么写", "怎么展开", "几个方案", "几种"]
    creative_terms = ["小说", "故事", "赛博", "修仙", "角色", "世界观", "大纲", "剧情", "主角"]

    Enum.any?(markers, &String.contains?(text, &1)) and
      Enum.any?(creative_terms, &String.contains?(text, &1))
  end

  defp concrete_production_author_input?(text) when is_binary(text) do
    text = String.trim(text)
    has_production_verb? = contains_any?(text, ["写", "生成", "产出", "描写", "续写", "撰写", "创作"])

    has_planning_verb? =
      contains_any?(text, ["规划", "计划", "安排", "整理", "设计"])

    has_deliverable? =
      contains_any?(text, [
        "开篇场景",
        "正文",
        "章节草稿",
        "草稿",
        "具体场景",
        "场景",
        "片段",
        "段落",
        "大纲",
        "角色设定",
        "人物设定",
        "世界观",
        "设定"
      ])

    has_planning_deliverable? =
      contains_any?(text, [
        "大纲",
        "分卷",
        "卷数",
        "章节数",
        "章节",
        "角色",
        "人物",
        "成长路线",
        "成长线",
        "势力结构",
        "势力",
        "门派",
        "组织",
        "剧情结构"
      ])

    ((has_production_verb? and has_deliverable?) ||
       (has_planning_verb? and has_planning_deliverable?)) and
      not explicit_discussion_only?(text)
  end

  defp concrete_production_author_input?(_text), do: false

  defp explicit_discussion_only?(text) do
    contains_any?(text, [
      "先别写",
      "别写",
      "不要写",
      "不写正文",
      "先不写",
      "不要生成",
      "别生成",
      "不生成",
      "不要产出",
      "别产出",
      "不要改",
      "别改",
      "不改设定",
      "不要保存",
      "不保存",
      "纯交流",
      "先聊",
      "只聊",
      "继续聊",
      "聊聊",
      "讨论一下"
    ])
  end

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))

  defp parsed_needs_tool?(_parsed, _production_intent?, true), do: false
  defp parsed_needs_tool?(_parsed, true, false), do: true
  defp parsed_needs_tool?(parsed, false, false), do: Map.get(parsed, "needs_tool", false)

  defp parsed_reason_code(_parsed, _production_intent?, true), do: :user_requested_discussion
  defp parsed_reason_code(_parsed, true, false), do: :tool_needed

  defp parsed_reason_code(parsed, false, false),
    do: to_reason_code(Map.get(parsed, "no_tool_reason", "no_tool_needed"))

  defp parsed_execution_readiness(_raw, true), do: :ready
  defp parsed_execution_readiness("not_ready", false), do: :not_ready
  defp parsed_execution_readiness(_, false), do: :not_applicable

  defp to_reason_code("tool_needed"), do: :tool_needed
  defp to_reason_code("exploratory_only"), do: :exploratory_only
  defp to_reason_code("insufficient_execution_target"), do: :insufficient_execution_target
  defp to_reason_code("user_requested_discussion"), do: :user_requested_discussion
  defp to_reason_code(_), do: :no_tool_needed

  defp to_action_type("capability_invocation"), do: :capability_invocation
  defp to_action_type(_), do: :capability_invocation

  defp to_write_intent("tentative"), do: :tentative
  defp to_write_intent("production_candidate"), do: :production_candidate
  defp to_write_intent(_), do: :none

  # 续写/重写意图：只认 continuation / rewrite，其它（含 "none"/缺失）一律 nil（非续写/重写）。
  defp to_authoring_intent("continuation"), do: :continuation
  defp to_authoring_intent("rewrite"), do: :rewrite
  defp to_authoring_intent(_), do: nil

  defp normalize_target_chapter(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_target_chapter(_), do: nil

  # 目标字数：作者有明确篇幅诉求时 Planner(AI) 给出的整数估计；非正整数/缺失 → nil。
  # 上限兜底（单次正文不会要 2 万字以上），保留可审计的安全裁剪而非信任任意大值。
  defp normalize_target_word_count(value) when is_integer(value) and value > 0,
    do: min(value, 20_000)

  defp normalize_target_word_count(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {n, _} when n > 0 -> min(n, 20_000)
      _ -> nil
    end
  end

  defp normalize_target_word_count(_), do: nil

  defp to_risk_hint("medium"), do: :medium
  defp to_risk_hint("high"), do: :high
  defp to_risk_hint(_), do: :low
end
