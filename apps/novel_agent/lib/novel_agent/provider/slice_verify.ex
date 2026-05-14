defmodule NovelAgent.Provider.SliceVerify do
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
    content =
      if plan_prompt?(prompt) do
        plan_response()
      else
        frame_response(prompt)
      end

    {:ok, Result.new(Jason.encode!(content))}
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "slice_verify"

  defp plan_prompt?(prompt) do
    String.contains?(prompt, "plan_goal_summary") or String.contains?(prompt, "proposed_actions")
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
    Enum.any?(["生成", "角色", "方向", "怎么切入", "小说创作"], &String.contains?(prompt, &1))
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

  defp plan_response do
    %{
      plan_goal_summary: "验证工作台 micro plan 入口",
      risk_hint: "low",
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-slice-verify",
          action_type: "capability_invocation",
          summary: "生成一组可供作者继续选择的创作方向",
          target_ref: "creative_generation",
          write_intent: "tentative",
          risk_hint: "low"
        }
      ],
      state_changes_requested: [],
      required_capabilities: ["creative_generation"],
      fallback_message: "如果暂时不能生成，就先继续用对话收束方向。"
    }
  end
end
