defmodule NovelApplication.AgentObservationAssembler do
  @moduledoc """
  Builds compact sourced AgentObservation values from step TurnResult data.
  """

  alias NovelDomain.AgentObservation

  @spec from_turn_result(map(), map()) :: [AgentObservation.t()]
  def from_turn_result(turn_result, %{run_id: run_id, step_id: step_id})
      when is_map(turn_result) do
    case tool_name(turn_result) do
      "character_roster" ->
        [character_roster_observation(turn_result, run_id, step_id)]

      "character_design" ->
        [artifact_observation(turn_result, run_id, step_id, "角色草稿")]

      "prose_writing" ->
        [artifact_observation(turn_result, run_id, step_id, "正文草稿")]

      _ ->
        []
    end
    |> Enum.reject(&is_nil/1)
  end

  defp character_roster_observation(turn_result, run_id, step_id) do
    output = tool_output(turn_result)
    characters = Map.get(output, :characters) || Map.get(output, "characters") || []

    count =
      Map.get(output, :character_count) || Map.get(output, "character_count") ||
        length(characters)

    names = characters |> Enum.map(&character_name/1) |> Enum.reject(&(&1 == "")) |> Enum.take(4)

    summary =
      case names do
        [] -> "当前作品暂未读取到已确认角色。"
        _ -> "已读取当前角色阵容：#{Enum.join(names, "、")}。"
      end

    new_observation(%{
      observation_id: "obs_#{step_id}_roster",
      run_ref: run_id,
      step_ref: step_id,
      observation_type: :character_roster,
      source_ref: tool_result_id(turn_result),
      summary: summary,
      structured_payload: %{
        character_count: count,
        existing_names: names
      },
      evidence_refs: ["tool_result:#{tool_result_id(turn_result)}"]
    })
  end

  defp artifact_observation(turn_result, run_id, step_id, artifact_label) do
    refs = artifact_refs(turn_result)

    if refs == [] do
      nil
    else
      new_observation(%{
        observation_id: "obs_#{step_id}_artifact",
        run_ref: run_id,
        step_ref: step_id,
        observation_type: :artifact_created,
        source_ref: tool_result_id(turn_result),
        summary: "已生成 #{length(refs)} 个待采纳#{artifact_label}。",
        structured_payload: %{artifact_refs: refs},
        evidence_refs: [
          "tool_result:#{tool_result_id(turn_result)}" | Enum.map(refs, &"artifact:#{&1}")
        ]
      })
    end
  end

  defp new_observation(attrs) do
    case AgentObservation.new(attrs) do
      {:ok, observation} -> observation
      {:error, _errors} -> nil
    end
  end

  defp tool_name(turn_result), do: get_in(turn_result, [:tool_result, :tool_name])
  defp tool_output(turn_result), do: get_in(turn_result, [:tool_result, :output]) || %{}

  defp tool_result_id(turn_result),
    do: get_in(turn_result, [:tool_result, :tool_result_id]) || "unknown"

  defp artifact_refs(turn_result) do
    turn_result
    |> get_in([:adoption_state, :pending])
    |> List.wrap()
    |> Enum.map(&(Map.get(&1, :artifact_id) || Map.get(&1, "artifact_id")))
    |> Enum.reject(&is_nil/1)
  end

  defp character_name(character) when is_map(character) do
    character
    |> Map.get(:name, Map.get(character, "name", ""))
    |> to_string()
    |> String.trim()
  end

  defp character_name(_), do: ""
end
