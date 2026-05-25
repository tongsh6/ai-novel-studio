defmodule NovelApplication.Planner do
  @moduledoc """
  v3 Dialogue Planner — 调用 LLM 形成 DialogueFrame 和 MicroPlan。
  MicroPlan 只是建议，不含执行批准语义。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Gateway
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
          if frame.frame_type == :creative_exploration do
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
  """
  @spec form_micro_plan(DialogueFrame.t(), map(), complete_fn()) ::
          {:ok, MicroPlan.t()} | {:error, term()}
  def form_micro_plan(%DialogueFrame{} = frame, author_input, complete_fn \\ &Gateway.complete/1) do
    plan_id = "plan_#{System.unique_integer([:positive, :monotonic])}"
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:planner, :form_micro_plan, :start, %{})

    prompt = build_plan_prompt(frame, author_input)

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

  defp build_plan_prompt(frame, author_input) do
    tools = CapabilityRegistry.list()

    """
    你是一个小说创作 AI 的规划器。基于已形成的对话认知帧，提出下一步工具调用建议。

    ## 对话认知帧
    - frame_type: #{frame.frame_type}
    - dialogue_goal: #{frame.dialogue_goal.summary}

    ## 当前开放的创作工具 (Capabilities)
    #{Enum.join(tools, ", ")}

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
          "risk_hint": "low" | "medium" | "high"
        }
      ],
      "required_capabilities": ["world_building"],
      "fallback_message": "如果无法执行，降级为对话时告诉作者什么"
    }

    ## 重要
    - proposed_actions 只能包含 capability_invocation 类型的动作
    - 每个 action 的 target_ref 必须指向上面开放工具列表中的一个
    - 不要包含 "approved", "ready_to_execute", "execution_approved" 等批准语义
    - 只需要 1 个 action，不要建议多个
    - risk_hint 默认用 "low"
    """
  end

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
          risk_hint: to_risk_hint(Map.get(a, "risk_hint", "low"))
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
    [%{role: "system", content: system_prompt(context)}] ++
      conversation_messages(context) ++
      [%{role: "user", content: text}]
  end

  defp system_prompt(context) do
    """
    你是一个小说创作 AI。分析用户消息并返回 JSON。

    #{non_conversation_context_section(context)}

    ## 输出格式（严格 JSON）
    {
      "frame_type": "casual_reply" | "creative_exploration" | "question_answer" | "meta_discussion",
      "dialogue_goal_summary": "用户本轮想达到什么",
      "needs_tool": false,
      "no_tool_reason": "no_tool_needed" | "exploratory_only" | "insufficient_execution_target" | "user_requested_discussion",
      "execution_readiness": "not_applicable",
      "assistant_message": "自然语言回应（中文）",
      "candidate_directions": [{"title": "方向标题", "pitch": "一句话吸引力描述", "tone_tags": ["悬疑", "温柔"], "risk_hint": "low"}],
      "context_used": true or false,
      "uncertainty": []
    }

    ## 规则
    - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象
    - frame_type != "creative_exploration" 时，candidate_directions 为空数组
    - 不要输出纯字符串数组，每个方向必须是带 title/pitch/tone_tags 的对象
    - candidate_directions[].risk_hint 可选，只能是 "low" | "medium" | "high"，不确定时用 "low"
    - assistant_message 必须用中文，不要输出 JSON 代码块
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

  defp conversation_messages(%DialogueContext{conversation_summary: summary})
       when is_binary(summary),
       do: parse_conversation_messages(summary)

  defp conversation_messages(_context), do: []

  defp parse_conversation_messages(summary) do
    summary
    |> String.split("\n")
    |> Enum.reduce({[], nil}, &collect_conversation_line/2)
    |> finalize_conversation_messages()
  end

  defp collect_conversation_line(line, {messages, current}) do
    case Regex.run(~r/^(user|assistant):\s*(.*)$/u, line) do
      [_, role, content] ->
        {[current | messages], %{role: role, content: content}}

      _ ->
        {messages, append_conversation_line(current, line)}
    end
  end

  defp append_conversation_line(nil, _line), do: nil

  defp append_conversation_line(current, line),
    do: %{current | content: current.content <> "\n" <> line}

  defp finalize_conversation_messages({messages, current}) do
    [current | messages]
    |> Enum.reject(&is_nil/1)
    |> Enum.reverse()
    |> Enum.reject(&(String.trim(&1.content) == ""))
  end

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

    tool_need = %{
      needs_tool: Map.get(parsed, "needs_tool", false),
      reason_code: to_reason_code(Map.get(parsed, "no_tool_reason", "no_tool_needed"))
    }

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: frame_id,
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: normalized_frame_type(parsed, text),
      source_refs: %{
        author_input_ref: "author_input:#{turn_id}",
        dialogue_context_ref: context_ref
      },
      dialogue_goal: %{summary: Map.get(parsed, "dialogue_goal_summary", "用户发来消息")},
      tool_need: tool_need,
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: Map.get(parsed, "assistant_message", "收到你的消息。")},
      evidence_summary: %{context_used: Map.get(parsed, "context_used", context != nil)},
      uncertainty: Map.get(parsed, "uncertainty", [])
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
  defp frame_error_reason_code(%{type: :invalid_response}), do: :invalid_response
  defp frame_error_reason_code(%{type: :timeout}), do: :provider_timeout
  defp frame_error_reason_code(%{type: :connection_refused}), do: :provider_unavailable
  defp frame_error_reason_code(_), do: :provider_error

  defp fallback_message(:json_parse_failed),
    do: "创作引擎返回的格式不符合工作台契约，请重试。"

  defp fallback_message(:invalid_response), do: "创作引擎返回内容为空，请重试。"
  defp fallback_message(:provider_timeout), do: "创作引擎响应超时，请稍后再试。"

  defp fallback_message(_),
    do: "抱歉，我现在无法连接到创作引擎。请稍后再试。"

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
  defp to_frame_type("question_answer"), do: :question_answer
  defp to_frame_type("meta_discussion"), do: :meta_discussion
  defp to_frame_type(_), do: :casual_reply

  defp normalized_frame_type(parsed, text) do
    raw_type = to_frame_type(Map.get(parsed, "frame_type", "casual_reply"))

    if raw_type == :casual_reply and exploratory_author_input?(text) do
      :creative_exploration
    else
      raw_type
    end
  end

  defp exploratory_author_input?(text) when is_binary(text) do
    markers = ["没想好", "方向", "切入", "想想", "怎么写", "怎么展开", "几个方案", "几种"]
    creative_terms = ["小说", "故事", "赛博", "修仙", "角色", "世界观", "大纲", "剧情", "主角"]

    Enum.any?(markers, &String.contains?(text, &1)) and
      Enum.any?(creative_terms, &String.contains?(text, &1))
  end

  defp exploratory_author_input?(_text), do: false

  defp to_reason_code("exploratory_only"), do: :exploratory_only
  defp to_reason_code("insufficient_execution_target"), do: :insufficient_execution_target
  defp to_reason_code("user_requested_discussion"), do: :user_requested_discussion
  defp to_reason_code(_), do: :no_tool_needed

  defp to_action_type("capability_invocation"), do: :capability_invocation
  defp to_action_type(_), do: :capability_invocation

  defp to_write_intent("tentative"), do: :tentative
  defp to_write_intent("production_candidate"), do: :production_candidate
  defp to_write_intent(_), do: :none

  defp to_risk_hint("medium"), do: :medium
  defp to_risk_hint("high"), do: :high
  defp to_risk_hint(_), do: :low
end
