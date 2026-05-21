defmodule NovelApplication.WorkSessionService do
  @moduledoc """
  作品内会话用例层。负责为前端启动恢复提供 work-scoped resume snapshot。
  """

  alias NovelApplication.TraceSummaryRef
  alias NovelApplication.WorkService
  alias NovelPersistence.Schemas.Interaction
  alias NovelPersistence.Schemas.WorkSession
  alias NovelPersistence.WorkSessionRepo

  @doc "Resume the last active session for a work, creating one when the work has none."
  @spec resume(String.t()) :: {:ok, map()} | {:error, :work_not_found | term()}
  def resume(work_id) when is_binary(work_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         {:ok, session} <- WorkSessionRepo.ensure_active_for_work(work_id) do
      transcript = WorkSessionRepo.transcript(session.id)
      turn_results = transcript_turn_results(transcript)

      {:ok,
       %{
         work: work,
         active_session: session_dto(session),
         sessions: Enum.map(WorkSessionRepo.list_by_work(work_id), &session_dto/1),
         transcript: Enum.map(transcript, &interaction_dto/1),
         pending_adoptions: pending_adoptions(turn_results),
         resolved_adoptions: resolved_adoptions(turn_results),
         resume_trace_refs: resume_trace_refs(turn_results)
       }}
    else
      nil -> {:error, :work_not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Return a work-scoped session snapshot without changing the active session."
  @spec show(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :session_not_found}
  def show(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         %WorkSession{} = session <- WorkSessionRepo.get_by_work(work_id, session_id) do
      transcript = WorkSessionRepo.transcript(session.id)
      turn_results = transcript_turn_results(transcript)
      read_only? = session.status != "ACTIVE"

      {:ok,
       %{
         work: work,
         session: session_dto(session),
         read_only: read_only?,
         transcript: Enum.map(transcript, &interaction_dto/1),
         pending_adoptions: pending_adoptions_for_session(read_only?, turn_results),
         resolved_adoptions: resolved_adoptions(turn_results),
         resume_trace_refs: resume_trace_refs(turn_results)
       }}
    else
      nil ->
        if WorkService.get(work_id) == nil do
          {:error, :work_not_found}
        else
          {:error, :session_not_found}
        end
    end
  end

  @doc "Search sessions in one work."
  @spec search(String.t(), String.t()) :: [map()]
  def search(work_id, query) do
    work_id
    |> WorkSessionRepo.search(query)
    |> Enum.map(&session_dto/1)
  end

  @doc "Create a new active session in one work."
  @spec create(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def create(work_id, attrs \\ %{}) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("work_id", work_id)

    case WorkSessionRepo.create(attrs) do
      {:ok, session} -> {:ok, session_dto(session)}
      {:error, _changeset} = err -> err
    end
  end

  defp session_dto(%WorkSession{} = session) do
    %{
      id: session.id,
      work_id: session.work_id,
      title: session.title,
      summary: session.summary,
      status: session.status,
      source_session_ref: session.source_session_ref,
      source_turn_ref: session.source_turn_ref,
      last_opened_at: session.last_opened_at,
      updated_at: session.updated_at,
      inserted_at: session.inserted_at
    }
  end

  defp interaction_dto(%Interaction{} = interaction) do
    turn_result = turn_result_from_content(interaction.content)

    %{
      id: interaction.id,
      session_id: interaction.session_id,
      turn_id: interaction.turn_id,
      role: interaction.role,
      text: text_from_content(interaction.content),
      turn_result: turn_result,
      inserted_at: interaction.inserted_at
    }
  end

  defp transcript_turn_results(transcript) do
    transcript
    |> Enum.map(&turn_result_from_content(&1.content))
    |> Enum.reject(&is_nil/1)
  end

  defp pending_adoptions(turn_results) do
    resolved_ids =
      turn_results |> resolved_adoptions() |> Enum.map(& &1.artifact_id) |> MapSet.new()

    turn_results
    |> Enum.flat_map(fn turn_result ->
      turn_result
      |> adoption_entries(:pending)
      |> Enum.map(&Map.put(&1, :source_turn_ref, turn_id(turn_result)))
    end)
    |> Enum.reject(&MapSet.member?(resolved_ids, &1.artifact_id))
  end

  defp pending_adoptions_for_session(true, _turn_results), do: []
  defp pending_adoptions_for_session(false, turn_results), do: pending_adoptions(turn_results)

  defp resolved_adoptions(turn_results) do
    turn_results
    |> Enum.flat_map(&adoption_entries(&1, :resolved))
  end

  defp adoption_entries(turn_result, key) do
    turn_result
    |> get_in_any([:adoption_state, key])
    |> List.wrap()
    |> Enum.map(&normalize_atom_keys/1)
  end

  defp resume_trace_refs(turn_results) do
    turn_results
    |> Enum.map(&TraceSummaryRef.from_turn_result/1)
    |> Enum.reject(&is_nil/1)
  end

  defp turn_result_from_content(content) when is_map(content) do
    content["turn_result"] || content[:turn_result]
  end

  defp text_from_content(content) when is_map(content),
    do: to_string(content["text"] || content[:text] || "")

  defp text_from_content(_), do: ""

  defp turn_id(turn_result), do: get_in_any(turn_result, [:turn_id])

  defp get_in_any(map, keys) when is_map(map), do: do_get_in_any(map, keys)
  defp get_in_any(_, _), do: nil

  defp do_get_in_any(value, []), do: value

  defp do_get_in_any(map, [key | rest]) when is_map(map) do
    value = Map.get(map, key) || Map.get(map, Atom.to_string(key))
    do_get_in_any(value, rest)
  end

  defp do_get_in_any(_, _), do: nil

  defp normalize_atom_keys(map) when is_map(map) do
    Map.new(map, fn
      {key, value} when is_binary(key) -> {known_atom_key(key), value}
      {key, value} -> {key, value}
    end)
  end

  defp known_atom_key("artifact_id"), do: :artifact_id
  defp known_atom_key("artifact_type"), do: :artifact_type
  defp known_atom_key("adoption_status"), do: :adoption_status
  defp known_atom_key("requires_adoption"), do: :requires_adoption
  defp known_atom_key("payload"), do: :payload
  defp known_atom_key("revision_base"), do: :revision_base
  defp known_atom_key("source_turn_ref"), do: :source_turn_ref
  defp known_atom_key("source_tool_result_ref"), do: :source_tool_result_ref
  defp known_atom_key("source_artifact_ref"), do: :source_artifact_ref
  defp known_atom_key("adopted_state_ref"), do: :adopted_state_ref
  defp known_atom_key("state_trace_ref"), do: :state_trace_ref
  defp known_atom_key("decision_trace_ref"), do: :decision_trace_ref
  defp known_atom_key("mutation_ref"), do: :mutation_ref
  defp known_atom_key(key), do: key

  defp stringify_keys(attrs) do
    Map.new(attrs, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} -> {key, value}
    end)
  end
end
