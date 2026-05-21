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
      candidate_directions: candidate_directions(exploratory),
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

  defp candidate_directions(true) do
    [
      %{
        title: "人物动机",
        pitch: "从主角最想得到但最难承受的东西切入。",
        tone_tags: ["人物", "冲突"]
      },
      %{
        title: "世界规则",
        pitch: "先确定一个会持续制造选择压力的规则。",
        tone_tags: ["设定", "推进"]
      }
    ]
  end

  defp candidate_directions(false), do: []

  defp tool_narration_response(prompt) do
    cond do
      String.contains?(prompt, "character_design") ->
        "已生成角色设定草案，你可以查看内容后选择采纳、放弃或修改。"

      String.contains?(prompt, "prose_writing") ->
        "已生成正文片段草稿，你可以采纳后在阅读模式中查看。"

      String.contains?(prompt, "plot_outline") ->
        "已生成大纲草案，你可以审阅后决定是否纳入作品结构。"

      true ->
        "已生成创作草稿，你可以继续查看、采纳或修改。"
    end
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
        "creative_generation"
    end
  end

  defp action_summary("prose_writing"), do: "生成一段正文草稿"
  defp action_summary("character_design"), do: "生成一个角色设定草案"
  defp action_summary("plot_outline"), do: "生成一份大纲草案"
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

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
