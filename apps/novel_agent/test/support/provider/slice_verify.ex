defmodule NovelAgent.Test.Provider.SliceVerify do
  @moduledoc """
  Deterministic provider for local slice verification.

  It returns planner-compatible JSON so Tauri slice journeys can verify the
  product chain without depending on an external LLM or the echo-only stub.
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.Result

  defstruct []

  @impl true
  def complete(_state, _model, prompt, _params) do
    prompt_text = prompt_text(prompt)

    content =
      cond do
        creative_items_prompt?(prompt_text) ->
          creative_items_response(prompt_text) |> Jason.encode!()

        plan_prompt?(prompt_text) ->
          plan_response(prompt_text) |> Jason.encode!()

        tool_narration_prompt?(prompt_text) ->
          tool_narration_response(prompt_text)

        true ->
          frame_response(prompt) |> Jason.encode!()
      end

    {:ok, Result.new(content)}
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "slice_verify"

  defp plan_prompt?(prompt) do
    String.contains?(prompt, "plan_goal_summary") or String.contains?(prompt, "proposed_actions")
  end

  defp creative_items_prompt?(prompt) do
    String.contains?(prompt, "JSON 数组") and String.contains?(prompt, "artifact_type：")
  end

  defp tool_narration_prompt?(prompt) do
    String.contains?(prompt, "## 工具执行结果") and
      String.contains?(prompt, "请用 1-2 句自然中文")
  end

  defp frame_response(prompt) do
    exploratory = exploratory_prompt?(prompt)

    %{
      frame_type: if(exploratory, do: "creative_exploration", else: "casual_reply"),
      dialogue_goal_summary: "验证工作台对话主链",
      needs_tool: false,
      no_tool_reason: if(exploratory, do: "exploratory_only", else: "no_tool_needed"),
      execution_readiness: "not_applicable",
      assistant_message: frame_message(exploratory),
      candidate_directions: candidate_directions(exploratory, prompt),
      context_used: false,
      uncertainty: []
    }
  end

  defp exploratory_prompt?(prompt) do
    text = author_input_text(prompt)
    Enum.any?(["生成", "角色", "方向", "怎么切入", "小说创作"], &String.contains?(text, &1))
  end

  defp frame_message(true),
    do: "可以先从人物动机、核心冲突和世界规则三个方向拆开看。"

  defp frame_message(false), do: "可以，我们先围绕小说创作方向聊下去。"

  defp candidate_directions(true, prompt) do
    author_text = author_input_text(prompt)
    high_risk? = contains_any?(author_text, ["高风险", "覆盖主线", "重写设定", "推翻设定"])

    first =
      if high_risk? do
        %{
          title: "高风险主线覆盖",
          pitch: "直接覆盖既有主线设定，需要作者再次确认后才能采用。",
          tone_tags: ["主线", "高风险"],
          risk_hint: "high"
        }
      else
        %{
          title: "人物动机",
          pitch: "从主角最想得到但最难承受的东西切入。",
          tone_tags: ["人物", "冲突"],
          risk_hint: "low"
        }
      end

    [
      first,
      %{
        title: "世界规则",
        pitch: "先确定一个会持续制造选择压力的规则。",
        tone_tags: ["设定", "推进"],
        risk_hint: "low"
      }
    ]
  end

  defp candidate_directions(false, _prompt), do: []

  defp tool_narration_response(prompt) do
    cond do
      String.contains?(prompt, "character_design") ->
        "已生成角色设定草案，你可以查看内容后选择采纳、放弃或修改。"

      String.contains?(prompt, "prose_writing") ->
        "已生成正文草稿，请先审阅，采纳后才会进入阅读模式。"

      String.contains?(prompt, "plot_outline") ->
        "已生成大纲草案，你可以审阅后决定是否纳入作品结构。"

      true ->
        "已生成创作草稿，你可以继续查看、采纳或修改。"
    end
  end

  defp creative_items_response(prompt) do
    {brief, context} = creative_prompt_parts(prompt)
    text = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
    fingerprint = text |> :erlang.phash2() |> Integer.to_string(36)

    [
      %{
        item_id: "slice_item_#{fingerprint}_1",
        title: creative_title(brief, fingerprint),
        body: creative_body(brief, context),
        rationale: creative_rationale(brief)
      }
    ]
  end

  defp plan_response(prompt) do
    tool_name = prompt |> author_input_text() |> tool_name_for_prompt()

    %{
      plan_goal_summary: "验证工作台 micro plan 入口",
      risk_hint: "low",
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-slice-verify",
          action_type: "capability_invocation",
          summary: action_summary(tool_name),
          target_ref: tool_name,
          write_intent: "tentative",
          risk_hint: "low"
        }
      ],
      state_changes_requested: [],
      required_capabilities: [tool_name],
      fallback_message: "如果暂时不能生成，就先继续用对话收束方向。"
    }
  end

  defp tool_name_for_prompt(prompt) do
    cond do
      contains_any?(prompt, ["正文", "片段", "开场"]) ->
        "prose_writing"

      contains_any?(prompt, ["角色", "人物", "主角"]) ->
        "character_design"

      contains_any?(prompt, ["大纲", "章节"]) ->
        "plot_outline"

      true ->
        "world_building"
    end
  end

  defp action_summary("prose_writing"), do: "生成一段正文草稿"
  defp action_summary("character_design"), do: "生成一个角色设定草案"
  defp action_summary("plot_outline"), do: "生成一份大纲草案"
  defp action_summary("world_building"), do: "生成一组世界设定草案"
  defp action_summary(_), do: "生成一组可供作者继续选择的创作方向"

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end

  defp author_input_text(prompt) do
    prompt
    |> current_user_message()
    |> case do
      nil -> author_input_text_from_prompt(prompt_text(prompt))
      text -> text
    end
  end

  defp current_user_message(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reverse()
    |> Enum.find_value(fn
      %{role: "user", content: content} -> content
      _message -> nil
    end)
  end

  defp current_user_message(_prompt), do: nil

  defp author_input_text_from_prompt(prompt) do
    case Regex.run(~r/用户消息：\s*(.*?)\s*$/s, prompt) do
      [_, text] ->
        text

      _ ->
        case Regex.run(~r/## 用户输入\s*(.*?)\s*## 输出格式/s, prompt) do
          [_, text] -> text
          _ -> prompt
        end
    end
  end

  defp creative_prompt_parts(prompt) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt) do
      [_, brief, context] ->
        {String.trim(brief), String.trim(context)}

      _ ->
        {author_input_text_from_prompt(prompt), ""}
    end
  end

  defp creative_title(brief, fingerprint) do
    case Regex.run(~r/第\d+章[：:]\s*([^。\n]+?)(?:正文草稿|$)/u, brief) do
      [_, chapter_title] ->
        "#{String.trim(chapter_title)} 正文草稿"

      _ ->
        "待确认正文草稿 #{fingerprint}"
    end
  end

  defp creative_body(brief, context) do
    subject = creative_subject(brief)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(3) |> Enum.join("、")

    nonce_sentence =
      if nonce_text == "", do: "", else: "档案暗码 #{nonce_text} 像冷光一样贴在他的视野边缘，提醒这不是幻觉。"

    [
      "夜色压在#{subject}上，灵气账单从屋檐下垂落，像一串即将燃尽的符纸。",
      "主角停在巷口，听见远处公司巡检车的低鸣，也听见自己腕骨里那枚旧阵芯正在倒数。",
      nonce_sentence,
      "他没有立刻逃跑，而是把欠费记录折进袖中，反手扣住最后一张护身符，朝最黑的楼梯口走去。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp creative_subject(brief) do
    case Regex.run(~r/第\d+章[：:]\s*([^：:\n。]+?)(?:：|正文草稿|$)/u, brief) do
      [_, subject] ->
        String.trim(subject)

      _ ->
        "这座赛博修仙城市"
    end
  end

  defp creative_rationale(brief) do
    if String.contains?(brief, "正文草稿") do
      "根据作者指定章节生成待确认正文片段，未写入作品事实。"
    else
      "根据本次作者输入生成待确认创作素材，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
