defmodule NovelAgent.Tools.TextAnalysisAdapter do
  @moduledoc false

  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @spec execute(ToolRequest.t(), term()) :: ToolResult.t()
  def execute(%ToolRequest{} = req, _provider_execution) do
    text = Map.get(req.input, "text", "")
    genre = Map.get(req.input, "genre", "")
    result_id = NovelFoundation.ID.unique("tr")

    analysis = %{
      word_count: count_words(text),
      estimated_reading_time_minutes: estimate_reading_time(text),
      genre_match:
        genre != "" and String.contains?(String.downcase(text), String.downcase(genre)),
      tone_suggestion: if(String.length(text) > 100, do: "narrative", else: "fragment")
    }

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output: analysis,
      state_delta: [%{type: :observation, key: "text_analysis", value: analysis}],
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: DateTime.utc_now()
    }
  end

  defp count_words(text), do: text |> String.split(~r/\s+/, trim: true) |> length()
  defp estimate_reading_time(text), do: max(1, round(count_words(text) / 250))
end
