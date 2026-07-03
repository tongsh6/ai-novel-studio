defmodule NovelAgent.Tools.CharacterRosterAdapter do
  @moduledoc false

  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @spec execute(ToolRequest.t(), term()) :: ToolResult.t()
  def execute(%ToolRequest{} = req, _provider_execution) do
    result_id = NovelFoundation.ID.unique("tr")
    characters = req.input |> Map.get("characters", []) |> normalize_characters()

    output = %{
      character_count: length(characters),
      characters: characters,
      empty: characters == []
    }

    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output: output,
      state_delta: [],
      artifact_refs: [],
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: DateTime.utc_now()
    }
  end

  defp normalize_characters(characters) when is_list(characters) do
    characters
    |> Enum.map(&normalize_character/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_characters(_characters), do: []

  defp normalize_character(character) when is_map(character) do
    name = field(character, :name)

    if text?(name) do
      %{
        name: name,
        role: field(character, :role),
        narrative_role: field(character, :narrative_role),
        summary: field(character, :summary),
        aliases: aliases(field(character, :aliases)),
        status: field(character, :status)
      }
      |> Enum.reject(fn {_key, value} -> empty?(value) end)
      |> Map.new()
    end
  end

  defp normalize_character(_character), do: nil

  defp field(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp aliases(value) when is_list(value), do: Enum.filter(value, &text?/1)
  defp aliases(_value), do: []

  defp empty?(value), do: value in [nil, "", []]

  defp text?(value), do: is_binary(value) and String.trim(value) != ""
end
