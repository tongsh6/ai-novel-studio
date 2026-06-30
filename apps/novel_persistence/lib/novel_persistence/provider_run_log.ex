defmodule NovelPersistence.ProviderRunLog do
  @moduledoc """
  Durable, author-safe ProviderExecution fact log.

  The provider runtime may carry raw model text or provider error details in
  memory. This repository stores only refs, status, usage, and summary facts
  needed for audit and UI usage display.
  """

  import Ecto.Query, only: [from: 2]

  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.Repo

  alias NovelPersistence.Schemas.{
    ProviderEventRecord,
    ProviderOutputRecord,
    ProviderRunRecord
  }

  @unsafe_keys ~w[
    api_key
    assistant_message
    chain_of_thought
    content
    messages
    provider_error_payload
    raw_messages
    raw_prompt
    raw_provider_error
    secret
    system_prompt
    text
    turn_result
  ]

  @spec record_execution(term(), map()) :: :ok | {:error, term()}
  def record_execution(execution_result, context \\ %{}) do
    case execution_facts(execution_result) do
      %{provider_run: %ProviderRun{} = run} = facts ->
        do_record_execution(run, facts, context)

      _ ->
        {:error, :provider_run_missing}
    end
  end

  @spec list_runs(String.t()) :: [ProviderRunRecord.t()]
  def list_runs(agent_run_id) when is_binary(agent_run_id) do
    from(r in ProviderRunRecord,
      where: r.agent_run_id == ^agent_run_id,
      order_by: [asc: r.inserted_at, asc: r.id]
    )
    |> Repo.all()
  end

  @spec list_events(String.t()) :: [ProviderEventRecord.t()]
  def list_events(provider_run_id) when is_binary(provider_run_id) do
    from(e in ProviderEventRecord,
      where: e.provider_run_id == ^provider_run_id,
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec get_output(String.t()) :: ProviderOutputRecord.t() | nil
  def get_output(provider_run_id) when is_binary(provider_run_id),
    do: Repo.get(ProviderOutputRecord, provider_run_id)

  @spec list_usage_summaries(String.t()) :: [map()]
  def list_usage_summaries(agent_run_id) when is_binary(agent_run_id) do
    outputs_by_run =
      from(o in ProviderOutputRecord,
        where: o.agent_run_id == ^agent_run_id
      )
      |> Repo.all()
      |> Map.new(&{&1.provider_run_id, &1})

    agent_run_id
    |> list_runs()
    |> Enum.map(&usage_summary(&1, Map.get(outputs_by_run, &1.id)))
  end

  @spec list_activity_summaries(String.t()) :: [map()]
  def list_activity_summaries(agent_run_id) when is_binary(agent_run_id) do
    outputs_by_run =
      from(o in ProviderOutputRecord,
        where: o.agent_run_id == ^agent_run_id
      )
      |> Repo.all()
      |> Map.new(&{&1.provider_run_id, &1})

    agent_run_id
    |> list_runs()
    |> Enum.map(fn run ->
      output = Map.get(outputs_by_run, run.id)

      run
      |> usage_summary(output)
      |> Map.merge(%{
        events: Enum.map(list_events(run.id), &event_summary/1),
        output: output_summary(output)
      })
    end)
  end

  defp do_record_execution(run, facts, context) do
    events = facts |> Map.get(:events, []) |> Enum.filter(&match?(%ProviderEvent{}, &1))
    output = Map.get(facts, :output)

    Repo.transaction(fn ->
      {:ok, _run_record} = upsert_run(run_attrs(run, context))

      Enum.each(events, fn event ->
        {:ok, _event_record} = upsert_event(event_attrs(event, run, context))
      end)

      if match?(%ProviderOutput{}, output) do
        {:ok, _output_record} = upsert_output(output_attrs(output, run, context))
      end
    end)
    |> case do
      {:ok, _value} -> :ok
      {:error, reason} -> {:error, reason}
    end
  rescue
    error -> {:error, error}
  end

  defp upsert_run(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(ProviderRunRecord, id) do
      nil ->
        %ProviderRunRecord{}
        |> ProviderRunRecord.changeset(attrs)
        |> Repo.insert()

      %ProviderRunRecord{} = record ->
        record
        |> ProviderRunRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  defp upsert_event(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(ProviderEventRecord, id) do
      nil ->
        %ProviderEventRecord{}
        |> ProviderEventRecord.changeset(attrs)
        |> Repo.insert()

      %ProviderEventRecord{} = record ->
        record
        |> ProviderEventRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  defp upsert_output(%{provider_run_id: id} = attrs) when is_binary(id) do
    case Repo.get(ProviderOutputRecord, id) do
      nil ->
        %ProviderOutputRecord{}
        |> ProviderOutputRecord.changeset(attrs)
        |> Repo.insert()

      %ProviderOutputRecord{} = record ->
        record
        |> ProviderOutputRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  defp run_attrs(%ProviderRun{} = run, context) do
    %{
      id: run.provider_run_id,
      provider_call_ref: run.provider_call_ref,
      agent_run_id:
        context_ref(context, :agent_run_id) || owner_ref(run.owner_refs, :agent_run_id),
      workspace_id:
        context_ref(context, :workspace_id) || owner_ref(run.owner_refs, :workspace_id),
      work_id: context_ref(context, :work_id) || owner_ref(run.owner_refs, :work_id),
      session_id: context_ref(context, :session_id) || owner_ref(run.owner_refs, :session_id),
      parent_turn_ref:
        context_ref(context, :parent_turn_ref) || owner_ref(run.owner_refs, :parent_turn_ref),
      step_id: context_ref(context, :step_id) || owner_ref(run.owner_refs, :step_id),
      purpose: atom_string(context_ref(context, :purpose) || run.purpose),
      execution_mode: atom_string(run.execution_mode),
      status: atom_string(run.status),
      provider_id: run.provider_id,
      model: run.model,
      owner_refs: safe_map(run.owner_refs),
      metadata: safe_map(run.metadata),
      started_at: parse_datetime(run.started_at),
      completed_at: parse_datetime(run.completed_at)
    }
  end

  defp event_attrs(%ProviderEvent{} = event, %ProviderRun{} = run, context) do
    %{
      id: event.event_id,
      provider_run_id: event.provider_run_ref || run.provider_run_id,
      provider_call_ref: run.provider_call_ref,
      agent_run_id:
        context_ref(context, :agent_run_id) || owner_ref(run.owner_refs, :agent_run_id),
      sequence: event.sequence,
      event_type: atom_string(event.event_type),
      visibility: atom_string(event.visibility),
      summary: event.summary,
      payload: provider_event_payload(event),
      refs: safe_refs(event.refs),
      emitted_at: parse_datetime(event.emitted_at)
    }
  end

  defp output_attrs(%ProviderOutput{} = output, %ProviderRun{} = run, context) do
    content_length = output_content_length(output)

    %{
      provider_run_id: output.provider_run_ref || run.provider_run_id,
      provider_call_ref: output.provider_call_ref || run.provider_call_ref,
      agent_run_id:
        context_ref(context, :agent_run_id) || owner_ref(run.owner_refs, :agent_run_id),
      status: atom_string(output.status),
      output_type: atom_string(output.output_type),
      content_length: content_length,
      content_summary: %{"content_length" => content_length},
      usage: safe_map(output.usage),
      error_summary: error_summary(output.error),
      refs: safe_refs(output.refs),
      finalized_at: parse_datetime(output.finalized_at)
    }
  end

  defp usage_summary(%ProviderRunRecord{} = run, output) do
    %{
      provider_run_ref: run.id,
      provider_call_ref: run.provider_call_ref,
      purpose: run.purpose,
      status: output_status(output) || run.status,
      output_type: output_type(output),
      content_length: output_content_length(output),
      usage: output_usage(output),
      provider_id: run.provider_id,
      model: run.model
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp event_summary(%ProviderEventRecord{} = event) do
    %{
      event_id: event.id,
      provider_run_ref: event.provider_run_id,
      provider_call_ref: event.provider_call_ref,
      sequence: event.sequence,
      event_type: event.event_type,
      visibility: event.visibility,
      summary: event.summary,
      payload: safe_map(event.payload || %{}),
      refs: event.refs || [],
      emitted_at: timestamp_iso(event.emitted_at)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp output_summary(%ProviderOutputRecord{} = output) do
    %{
      status: output.status,
      output_type: output.output_type,
      content_length: output.content_length,
      content_summary: safe_map(output.content_summary || %{}),
      usage: safe_map(output.usage || %{}),
      error_summary: safe_map(output.error_summary || %{}),
      refs: output.refs || [],
      finalized_at: timestamp_iso(output.finalized_at)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp output_summary(_), do: %{}

  defp provider_event_payload(%ProviderEvent{event_type: :error, payload: payload}) do
    %{
      "reason_code" =>
        map_get(payload, :reason_code) || map_get(payload, :type) || "provider_error"
    }
  end

  defp provider_event_payload(%ProviderEvent{} = event), do: safe_map(event.payload)

  defp output_status(%ProviderOutputRecord{status: status}), do: status
  defp output_status(_), do: nil

  defp output_type(%ProviderOutputRecord{output_type: output_type}), do: output_type
  defp output_type(_), do: nil

  defp output_content_length(%ProviderOutputRecord{content_length: length}), do: length

  defp output_content_length(%ProviderOutput{content: content}) when is_map(content) do
    content
    |> map_get(:text)
    |> case do
      text when is_binary(text) -> String.length(text)
      _ -> 0
    end
  end

  defp output_content_length(_), do: nil

  defp output_usage(%ProviderOutputRecord{usage: usage}) when is_map(usage), do: usage
  defp output_usage(_), do: %{}

  defp error_summary(error) when is_map(error) and map_size(error) > 0 do
    %{
      "type" => map_get(error, :type) || map_get(error, :reason_code) || "provider_error"
    }
  end

  defp error_summary(_), do: %{}

  defp safe_map(map) when is_map(map) do
    map
    |> Enum.reject(fn {key, _value} -> unsafe_key?(key) end)
    |> Map.new(fn {key, value} -> {to_string(key), safe_value(value)} end)
  end

  defp safe_map(_), do: %{}

  defp safe_value(value) when is_map(value), do: safe_map(value)
  defp safe_value(values) when is_list(values), do: Enum.map(values, &safe_value/1)
  defp safe_value(value) when is_atom(value), do: Atom.to_string(value)
  defp safe_value(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp safe_value(value), do: value

  defp unsafe_key?(key) when is_atom(key), do: unsafe_key?(Atom.to_string(key))

  defp unsafe_key?(key) when is_binary(key) do
    normalized = key |> String.downcase() |> String.replace("-", "_")
    normalized in @unsafe_keys
  end

  defp unsafe_key?(_), do: false

  defp safe_refs(refs) when is_list(refs) do
    refs |> Enum.map(&to_string/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp safe_refs(_), do: []

  defp timestamp_iso(nil), do: nil
  defp timestamp_iso(%DateTime{} = value), do: DateTime.to_iso8601(value)

  defp timestamp_iso(%NaiveDateTime{} = value),
    do: value |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_iso8601()

  defp timestamp_iso(value), do: value

  defp execution_facts({:ok, facts}) when is_map(facts), do: facts
  defp execution_facts({:error, facts}) when is_map(facts), do: facts
  defp execution_facts(facts) when is_map(facts), do: facts
  defp execution_facts(_), do: nil

  defp owner_ref(owner_refs, key), do: map_get(owner_refs, key)
  defp context_ref(context, key), do: map_get(context, key)

  defp map_get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_get(_map, _key), do: nil

  defp atom_string(value) when is_atom(value), do: Atom.to_string(value)
  defp atom_string(value) when is_binary(value), do: value
  defp atom_string(nil), do: nil
  defp atom_string(value), do: to_string(value)

  defp parse_datetime(nil), do: nil
  defp parse_datetime(%DateTime{} = datetime), do: datetime

  defp parse_datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> datetime
      _error -> nil
    end
  end

  defp parse_datetime(_), do: nil
end
