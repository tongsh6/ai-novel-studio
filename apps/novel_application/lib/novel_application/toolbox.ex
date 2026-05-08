defmodule NovelApplication.Toolbox do
  @moduledoc """
  工具执行运行时。接收已批准的 ToolRequest，执行工具，返回 ToolResult。

  VS-02 只实现一个 read-only text_analysis 工具用于证明 provenance。
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

      not CapabilityRegistry.grants_valid?(req.tool_name, req.read_scope_grants, req.write_scope_grants) ->
        %ToolResult{
          tool_result_id: result_id,
          tool_request_ref: req.tool_request_id,
          tool_name: req.tool_name,
          status: :failed,
          errors: [%{code: "grant_scope_violation", message: "requested grants exceed registry scopes"}],
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
      genre_match: genre != "" and String.contains?(String.downcase(text), String.downcase(genre)),
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

  defp count_words(text), do: text |> String.split(~r/\s+/, trim: true) |> length()
  defp estimate_reading_time(text), do: max(1, round(count_words(text) / 250))
  defp suggest_tone(text), do: if(String.length(text) > 100, do: "narrative", else: "fragment")
end
