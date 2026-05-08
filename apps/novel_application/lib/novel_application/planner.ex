defmodule NovelApplication.Planner do
  @moduledoc """
  v3 Dialogue Planner — 调用 LLM 形成 DialogueFrame 和 MicroPlan。
  MicroPlan 只是建议，不含执行批准语义。
  """

  alias NovelAgent.Provider.Gateway
  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @type complete_fn :: (String.t() -> {:ok, map()} | {:error, term()})

  @doc """
  根据 AuthorInput 和 DialogueContext 形成 DialogueFrame 和候选方向。

  `complete_fn` 可注入，默认走 Gateway.complete/1。
  """
  @spec form_frame(map(), DialogueContext.t() | nil, complete_fn()) :: {DialogueFrame.t(), [CandidateDirection.t()]}
  def form_frame(%{text: text, workspace_id: ws_id} = _input, context \\ nil, complete_fn \\ &Gateway.complete/1) do
    turn_id = allocate_turn_id()
    frame_id = allocate_frame_id()

    result = with_turn_context(turn_id, "form_frame", fn ->
      call_provider(text, context, complete_fn)
    end)

    case result do
      {:ok, parsed} ->
        frame = build_frame(parsed, turn_id, frame_id, ws_id, context)

        candidates =
          if frame.frame_type == :creative_exploration do
            build_candidates(parsed, frame.frame_id)
          else
            []
          end

        {frame, candidates}

      {:error, _reason} ->
        {fallback_frame(turn_id, frame_id, ws_id, context), []}
    end
  end

  @doc """
  基于 DialogueFrame 生成 MicroPlan（行动建议）。

  VS-01：Planner 只能建议，不能批准。Orchestrator 裁决所有执行。

  `complete_fn` 可注入，默认走 Gateway.complete/1。
  """
  @spec form_micro_plan(DialogueFrame.t(), map(), complete_fn()) :: {:ok, MicroPlan.t()} | {:error, term()}
  def form_micro_plan(%DialogueFrame{} = frame, author_input, complete_fn \\ &Gateway.complete/1) do
    plan_id = "plan_#{System.unique_integer([:positive, :monotonic])}"

    prompt = build_plan_prompt(frame, author_input)

    case with_turn_context(frame.turn_id, "form_micro_plan", fn -> complete_fn.(prompt) end) do
      {:ok, %{content: content}} ->
        case parse_json(content) do
          {:ok, parsed} ->
            plan = build_micro_plan(parsed, plan_id, frame)
            {:ok, plan}

          {:error, _} ->
            case parse_json_retry(content, prompt, complete_fn) do
              {:ok, parsed} ->
                plan = build_micro_plan(parsed, plan_id, frame)
                {:ok, plan}

              {:error, _} ->
                {:error, :json_parse_failed}
            end
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_plan_prompt(frame, author_input) do
    """
    你是一个小说创作 AI 的规划器。基于已形成的对话认知帧，提出下一步行动建议。

    ## 对话认知帧
    - frame_type: #{frame.frame_type}
    - dialogue_goal: #{frame.dialogue_goal.summary}
    - tool_need: #{inspect(frame.tool_need)}

    ## 用户输入
    #{author_input.text}

    ## 输出格式（严格 JSON）
    {
      "plan_goal_summary": "你建议推进什么",
      "risk_hint": "low" | "medium" | "high",
      "requires_confirmation_hint": true or false,
      "proposed_actions": [
        {
          "action_id": "act-1",
          "action_type": "candidate_generation" | "tentative_artifact" | "state_change_request" | "clarification_request" | "confirmation_request" | "capability_invocation",
          "summary": "人类可读的动作描述",
          "target_ref": null,
          "write_intent": "none" | "tentative" | "production_candidate",
          "risk_hint": "low" | "medium" | "high"
        }
      ],
      "state_changes_requested": [],
      "required_capabilities": [],
      "fallback_message": "如果无法执行，降级为对话时告诉作者什么"
    }

    ## 重要
    - 不要包含 "approved", "ready_to_execute", "execution_approved" 等批准语义
    - proposed_actions 中的每个 action 都只是建议，不是已授权执行
    """
  end

  defp build_micro_plan(parsed, plan_id, frame) do
    actions =
      parsed
      |> Map.get("proposed_actions", [])
      |> Enum.map(fn a ->
        %{
          action_id: Map.get(a, "action_id", "act-#{System.unique_integer([:positive, :monotonic])}"),
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

  # ── shared helpers (from VS-00) ──

  defp call_provider(text, context, complete_fn) do
    prompt = build_prompt(text, context)

    case complete_fn.(prompt) do
      {:ok, %{content: content}} ->
        case parse_json(content) do
          {:ok, parsed} -> {:ok, parsed}
          {:error, _} -> parse_json_retry(content, prompt, complete_fn)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_prompt(text, context) do
    context_section =
      if context && DialogueContext.has_context?(context) do
        DialogueContext.to_prompt_text(context)
      else
        "## 当前作品上下文\n（无——这是新对话或尚未创建作品）"
      end

    """
    你是一个小说创作 AI。分析用户消息并返回 JSON。

    #{context_section}

    ## 输出格式（严格 JSON）
    {
      "frame_type": "casual_reply" | "creative_exploration" | "question_answer" | "meta_discussion",
      "dialogue_goal_summary": "用户本轮想达到什么",
      "needs_tool": false,
      "no_tool_reason": "no_tool_needed" | "exploratory_only" | "insufficient_execution_target" | "user_requested_discussion",
      "execution_readiness": "not_applicable",
      "assistant_message": "自然语言回应（中文）",
      "candidate_directions": [{"title": "方向标题", "pitch": "一句话吸引力描述", "tone_tags": ["悬疑", "温柔"]}],
      "context_used": true or false,
      "uncertainty": []
    }

    ## 规则
    - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象
    - frame_type != "creative_exploration" 时，candidate_directions 为空数组
    - 不要输出纯字符串数组，每个方向必须是带 title/pitch/tone_tags 的对象
    - assistant_message 必须用中文，不要输出 JSON 代码块

    用户消息：#{text}
    """
  end

  # ── JSON parsing with extraction + retry ──────

  defp parse_json(content) do
    content
    |> extract_json()
    |> then(&Jason.decode(&1))
    |> case do
      {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
      {:error, _} = error -> error
    end
  end

  defp parse_json_retry(failed_content, original_prompt, complete_fn) do
    correction = build_correction_prompt(original_prompt, failed_content)

    case complete_fn.(correction) do
      {:ok, %{content: retry_content}} -> parse_json(retry_content)
      {:error, _} = error -> error
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
        trimmed |> String.replace_prefix("```json", "") |> String.replace_suffix("```", "") |> String.trim()

      String.starts_with?(trimmed, "```") ->
        trimmed |> String.replace_prefix("```", "") |> String.replace_suffix("```", "") |> String.trim()

      true ->
        trimmed
    end
  end

  defp find_brace_substring(content) do
    case {first_open(content), last_close(content)} do
      {start_pos, end_pos} when not is_nil(start_pos) and not is_nil(end_pos) and start_pos < end_pos ->
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

  defp build_correction_prompt(original, failed_output) do
    """
    你的上一次响应不是有效的 JSON。请严格按照 JSON 格式重试。

    ## 你的上一次响应（截取前 500 字符）
    #{String.slice(failed_output, 0, 500)}

    ## 修正要求
    - 只输出原始要求的 JSON 对象
    - 不要包含任何前缀标记、代码块、或解释文本
    - 直接以 `{` 开始，`}` 结束

    ## 原始要求
    #{original}
    """
  end

  defp build_frame(parsed, turn_id, frame_id, ws_id, context) do
    context_ref = context && context.workspace_id && "context:#{context.workspace_id}"

    tool_need = %{
      needs_tool: Map.get(parsed, "needs_tool", false) == false,
      reason_code: to_reason_code(Map.get(parsed, "no_tool_reason", "no_tool_needed"))
    }

    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: frame_id,
      turn_id: turn_id,
      workspace_id: ws_id,
      primary: true,
      frame_type: to_frame_type(Map.get(parsed, "frame_type", "casual_reply")),
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
    parsed |> Map.get("candidate_directions", []) |> Enum.map(fn
      c when is_map(c) ->
        %CandidateDirection{
          direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
          title: Map.get(c, "title", ""), pitch: Map.get(c, "pitch", ""),
          tone_tags: Map.get(c, "tone_tags", []), source_frame_ref: frame_id,
          adoption_status: :not_adopted
        }
      c when is_binary(c) ->
        %CandidateDirection{
          direction_id: "dir_#{System.unique_integer([:positive, :monotonic])}",
          title: c, pitch: c, tone_tags: [], source_frame_ref: frame_id,
          adoption_status: :not_adopted
        }
    end)
  end

  defp fallback_frame(turn_id, frame_id, ws_id, context) do
    context_ref = context && context.workspace_id && "context:#{context.workspace_id}"

    %DialogueFrame{
      schema_version: "3.0-draft", frame_id: frame_id, turn_id: turn_id, workspace_id: ws_id,
      primary: true, frame_type: :casual_reply,
      source_refs: %{author_input_ref: "author_input:#{turn_id}", dialogue_context_ref: context_ref},
      dialogue_goal: %{summary: "用户发来消息"},
      tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: "抱歉，我现在无法连接到创作引擎。请稍后再试。"},
      evidence_summary: %{fallback: true, context_used: context != nil}, uncertainty: []
    }
  end

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

  defp to_reason_code("exploratory_only"), do: :exploratory_only
  defp to_reason_code("insufficient_execution_target"), do: :insufficient_execution_target
  defp to_reason_code("user_requested_discussion"), do: :user_requested_discussion
  defp to_reason_code(_), do: :no_tool_needed

  defp to_action_type("candidate_generation"), do: :candidate_generation
  defp to_action_type("tentative_artifact"), do: :tentative_artifact
  defp to_action_type("state_change_request"), do: :state_change_request
  defp to_action_type("clarification_request"), do: :clarification_request
  defp to_action_type("confirmation_request"), do: :confirmation_request
  defp to_action_type("capability_invocation"), do: :capability_invocation
  defp to_action_type(_), do: :clarification_request

  defp to_write_intent("tentative"), do: :tentative
  defp to_write_intent("production_candidate"), do: :production_candidate
  defp to_write_intent(_), do: :none

  defp to_risk_hint("medium"), do: :medium
  defp to_risk_hint("high"), do: :high
  defp to_risk_hint(_), do: :low
end
