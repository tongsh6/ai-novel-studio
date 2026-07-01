defmodule NovelApplication.WorkSessionService do
  @moduledoc """
  作品内会话用例层。负责为前端启动恢复提供 work-scoped resume snapshot。
  """

  alias NovelApplication.TraceSummaryRef
  alias NovelApplication.WorkService
  alias NovelPersistence.{AgentRunLog, ProviderRunLog}
  alias NovelPersistence.Schemas.Interaction
  alias NovelPersistence.Schemas.WorkSession
  alias NovelPersistence.WorkSessionRepo

  @doc "Resume the last active session for a work, creating one when the work has none."
  @spec resume(String.t()) :: {:ok, map()} | {:error, :work_not_found | term()}
  def resume(work_id) when is_binary(work_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         {:ok, session} <- WorkSessionRepo.ensure_active_for_work(work_id) do
      transcript = WorkSessionRepo.transcript(session.id)
      transcript_entries = Enum.map(transcript, &interaction_dto(&1, work_id, session.id))
      turn_results = transcript_turn_results(transcript_entries)

      {:ok,
       %{
         work: work,
         active_session: session_dto(session),
         sessions: Enum.map(WorkSessionRepo.list_by_work(work_id), &session_dto/1),
         transcript: transcript_entries,
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
      transcript_entries = Enum.map(transcript, &interaction_dto(&1, work_id, session.id))
      turn_results = transcript_turn_results(transcript_entries)
      read_only? = session.status != "ACTIVE"

      {:ok,
       %{
         work: work,
         session: session_dto(session),
         read_only: read_only?,
         transcript: transcript_entries,
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

  @doc """
  Restore only the persisted turn results needed by WorkspaceChannel action lookup.

  This deliberately does not hydrate AgentRun events or provider usage. The HTTP
  resume/show snapshots are responsible for user-facing transcript restoration;
  channel join only needs enough state to validate later author actions.
  """
  @spec restore_channel_turn_results(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :session_not_found}
  def restore_channel_turn_results(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         %WorkSession{} = session <- WorkSessionRepo.get_by_work(work_id, session_id) do
      turn_results =
        session.id
        |> WorkSessionRepo.transcript()
        |> Enum.map(&turn_result_from_content(&1.content))
        |> Enum.reject(&is_nil/1)

      {:ok,
       %{
         work: work,
         session: session_dto(session),
         read_only: session.status != "ACTIVE",
         turn_results: turn_results
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

    with work when not is_nil(work) <- WorkService.get(work_id),
         {:ok, session} <- WorkSessionRepo.create_active(attrs) do
      {:ok, session_dto(session)}
    else
      nil -> {:error, :work_not_found}
      {:error, %Ecto.Changeset{}} = err -> err
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Make one non-archived session the active writable session for a work."
  @spec activate(String.t(), String.t()) ::
          {:ok, map()}
          | {:error,
             :work_not_found | :session_not_found | :cannot_activate_archived_session | term()}
  def activate(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         {:ok, session} <- WorkSessionRepo.activate(work_id, session_id) do
      {:ok, session_dto(session)}
    else
      nil -> {:error, :work_not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Archive an exited/history session while preserving transcript and trace access."
  @spec archive(String.t(), String.t()) ::
          {:ok, map()}
          | {:error,
             :work_not_found | :session_not_found | :cannot_archive_active_session | term()}
  def archive(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         %WorkSession{} = session <- WorkSessionRepo.get_by_work(work_id, session_id),
         :ok <- ensure_archivable(session),
         {:ok, archived} <- WorkSessionRepo.archive(session) do
      {:ok, session_dto(archived)}
    else
      nil ->
        if WorkService.get(work_id) == nil do
          {:error, :work_not_found}
        else
          {:error, :session_not_found}
        end

      {:error, reason} ->
        {:error, reason}
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

  defp ensure_archivable(%WorkSession{status: "ACTIVE"}),
    do: {:error, :cannot_archive_active_session}

  defp ensure_archivable(%WorkSession{}), do: :ok

  defp interaction_dto(%Interaction{} = interaction, work_id, session_id) do
    turn_result =
      interaction.content
      |> turn_result_from_content()
      |> attach_agent_run_activity(work_id, session_id)

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
    |> Enum.map(& &1.turn_result)
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

  defp attach_agent_run_activity(turn_result, work_id, session_id)
       when is_map(turn_result) and is_binary(work_id) and is_binary(session_id) do
    case turn_id(turn_result) do
      turn_id when is_binary(turn_id) and turn_id != "" ->
        turn_result
        |> resolve_agent_run(work_id, session_id, turn_id)
        |> case do
          nil -> turn_result
          run -> put_agent_run_activity(turn_result, run)
        end

      _ ->
        turn_result
    end
  end

  defp attach_agent_run_activity(turn_result, _work_id, _session_id), do: turn_result

  defp resolve_agent_run(turn_result, work_id, session_id, turn_id) do
    runs = AgentRunLog.list_by_parent_turn(work_id, session_id, turn_id)
    requested_run_id = get_in_any(turn_result, [:agent_run, :run_id])

    cond do
      runs == [] ->
        nil

      is_binary(requested_run_id) and requested_run_id != "" ->
        Enum.find(runs, &(&1.id == requested_run_id)) || List.last(runs)

      true ->
        List.last(runs)
    end
  end

  defp put_agent_run_activity(turn_result, run) do
    existing =
      case get_in_any(turn_result, [:agent_run]) do
        value when is_map(value) -> value
        _ -> %{}
      end

    agent_run =
      existing
      |> Map.put(:run_id, run.id)
      |> Map.put(:run_mode, run.run_mode)
      |> Map.put(:status, run.status)
      |> Map.put(:phase, run.phase)
      |> Map.put(:profile_ref, run.profile_ref)
      |> Map.put(:long_run_task_ref, run.long_run_task_ref)
      |> Map.put(:plan_ref, run.plan_ref)
      |> Map.put(:plan_version, run.plan_version)
      |> Map.put(
        :events,
        Enum.map(AgentRunLog.list_author_events(run.id), &agent_event_dto(&1, run))
      )
      |> Map.put(:provider_runs, ProviderRunLog.list_usage_summaries(run.id))

    turn_result
    |> Map.delete(:agent_run)
    |> Map.delete("agent_run")
    |> Map.put(:agent_run, agent_run)
  end

  defp agent_event_dto(event, run) do
    %{
      event_id: event.id,
      run_ref: event.run_id,
      run_id: event.run_id,
      step_ref: event.step_id,
      sequence: event.sequence,
      event_type: event.event_type,
      visibility: event.visibility,
      summary: event.summary,
      reason_codes: event.reason_codes || [],
      refs: event.refs || [],
      payload: author_safe_event_payload(event.payload),
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      emitted_at: timestamp_iso(event.inserted_at)
    }
  end

  defp author_safe_event_payload(payload) when is_map(payload) do
    payload
    |> drop_unsafe_payload_keys()
    |> stringify_atom_values()
  end

  defp author_safe_event_payload(_payload), do: %{}

  defp drop_unsafe_payload_keys(payload) when is_map(payload) do
    payload
    |> Enum.reject(fn {key, _value} -> unsafe_payload_key?(key) end)
    |> Map.new(fn {key, value} -> {key, drop_unsafe_payload_keys(value)} end)
  end

  defp drop_unsafe_payload_keys(values) when is_list(values),
    do: Enum.map(values, &drop_unsafe_payload_keys/1)

  defp drop_unsafe_payload_keys(value), do: value

  defp unsafe_payload_key?(key) when is_atom(key), do: unsafe_payload_key?(Atom.to_string(key))

  defp unsafe_payload_key?(key) when is_binary(key) do
    normalized = key |> String.downcase() |> String.replace("-", "_")

    normalized in [
      "api_key",
      "assistant_message",
      "chain_of_thought",
      "messages",
      "provider_error_payload",
      "raw_messages",
      "raw_prompt",
      "raw_provider_error",
      "secret",
      "system_prompt",
      "turn_result"
    ]
  end

  defp unsafe_payload_key?(_key), do: false

  defp stringify_atom_values(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {key, stringify_atom_values(item)} end)
  end

  defp stringify_atom_values(value) when is_list(value),
    do: Enum.map(value, &stringify_atom_values/1)

  defp stringify_atom_values(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify_atom_values(value), do: value

  defp timestamp_iso(nil), do: nil
  defp timestamp_iso(%DateTime{} = value), do: DateTime.to_iso8601(value)

  defp timestamp_iso(%NaiveDateTime{} = value),
    do: value |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_iso8601()

  defp timestamp_iso(value), do: value

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
