defmodule NovelApplication.Toolbox do
  @moduledoc """
  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。

  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。
  不与 production state 交互。
  """

  alias NovelApplication.CapabilityRegistry
  alias NovelDomain.ToolRequest
  alias NovelDomain.ToolResult

  @doc """
  执行一个 ToolRequest，返回 ToolResult。

  执行前验证：registry 中存在、状态可 dispatch、grants 合法。
  """
  @spec execute(ToolRequest.t()) :: ToolResult.t()
  def execute(%ToolRequest{} = req) do
    result_id = "tr_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    cond do
      is_nil(CapabilityRegistry.get(req.tool_name)) ->
        %ToolResult{
          tool_result_id: result_id,
          tool_request_ref: req.tool_request_id,
          tool_name: req.tool_name,
          status: :failed,
          errors: [%{code: "unknown_tool", message: "tool not found in registry"}],
          completed_at: now
        }

      not CapabilityRegistry.dispatchable?(req.tool_name) ->
        %ToolResult{
          tool_result_id: result_id,
          tool_request_ref: req.tool_request_id,
          tool_name: req.tool_name,
          status: :failed,
          errors: [%{code: "tool_not_dispatchable", message: "tool is disabled or deprecated"}],
          completed_at: now
        }

      not CapabilityRegistry.grants_valid?(
        req.tool_name,
        req.read_scope_grants,
        req.write_scope_grants
      ) ->
        %ToolResult{
          tool_result_id: result_id,
          tool_request_ref: req.tool_request_id,
          tool_name: req.tool_name,
          status: :failed,
          errors: [
            %{code: "grant_scope_violation", message: "requested grants exceed registry scopes"}
          ],
          completed_at: now
        }

      true ->
        dispatch(req, result_id, now)
    end
  end

  defp dispatch(%ToolRequest{tool_name: "text_analysis"} = req, result_id, now) do
    text = Map.get(req.input, "text", "")
    genre = Map.get(req.input, "genre", "")

    analysis = %{
      word_count: count_words(text),
      estimated_reading_time_minutes: estimate_reading_time(text),
      genre_match:
        genre != "" and String.contains?(String.downcase(text), String.downcase(genre)),
      tone_suggestion: suggest_tone(text)
    }

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: "text_analysis",
      status: :succeeded,
      output: analysis,
      state_delta: [%{type: :observation, key: "text_analysis", value: analysis}],
      usage: %{duration_ms: 0, tool: "text_analysis", version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp dispatch(%ToolRequest{tool_name: "creative_generation"} = req, result_id, now) do
    direction = Map.get(req.input, "direction", "character_seed")
    context_text = Map.get(req.input, "context_text", "")

    items = generate_creative_items(direction, context_text)

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: "creative_generation",
      status: :succeeded,
      output: %{artifact_type: direction, item_count: length(items), items: items},
      state_delta: [
        %{type: :tentative_artifact, key: "creative_generation", artifact_type: direction}
      ],
      artifact_refs: Enum.map(items, & &1.item_id),
      usage: %{duration_ms: 0, tool: "creative_generation", version: "1.0.0"},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp dispatch(_req, result_id, now) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: "unknown",
      tool_name: "unknown",
      status: :failed,
      errors: [%{code: "no_handler", message: "no dispatch handler for this tool"}],
      completed_at: now
    }
  end

  defp generate_creative_items("character_seed", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案A",
        body: "底层出身，被系统低估但拥有隐藏天赋的角色。",
        rationale: "适合赛博修仙的平民视角"
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案B",
        body: "中层执行者，在体制内发现黑暗真相。",
        rationale: "适合揭发公司和体制冲突的故事线"
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "主角草案C",
        body: "外来闯入者，带着外部视角颠覆现有秩序。",
        rationale: "适合挑战修仙垄断的反叛者叙事"
      }
    ]
  end

  defp generate_creative_items("plot_direction", _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "复仇主线",
        body: "主角发现灵气垄断背后的真相，踏上推翻体系的道路。",
        rationale: nil
      },
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "生存主线",
        body: "主角在霓虹地牢中觉醒能力，先活下去，再图改变。",
        rationale: nil
      }
    ]
  end

  defp generate_creative_items(_, _context) do
    [
      %{
        item_id: "item_#{System.unique_integer([:positive, :monotonic])}",
        title: "创作草稿",
        body: "AI 生成的内容草案。",
        rationale: nil
      }
    ]
  end

  defp count_words(text), do: text |> String.split(~r/\s+/, trim: true) |> length()
  defp estimate_reading_time(text), do: max(1, round(count_words(text) / 250))
  defp suggest_tone(text), do: if(String.length(text) > 100, do: "narrative", else: "fragment")
end
