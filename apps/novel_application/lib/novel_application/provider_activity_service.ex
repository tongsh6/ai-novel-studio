defmodule NovelApplication.ProviderActivityService do
  @moduledoc """
  Author-safe ProviderRun activity query scoped by work/session/turn.

  This service reads persisted ProviderExecution facts only. It never calls a
  provider while building the activity report.
  """

  alias NovelApplication.WorkService
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, WorkSessionRepo}

  @doc "Fetch persisted ProviderRun activity for one author turn."
  @spec fetch_turn_activity(String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :session_not_found}
  def fetch_turn_activity(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         session when not is_nil(session) <- WorkSessionRepo.get_by_work(work_id, session_id) do
      agent_runs = AgentRunLog.list_by_parent_turn(work.id, session.id, turn_id)

      events_by_run =
        agent_runs |> Enum.map(& &1.id) |> AgentRunLog.list_author_events_by_run_ids()

      provider_runs = Enum.flat_map(agent_runs, &provider_runs_for_agent_run/1)

      {:ok,
       %{
         work_id: work.id,
         session_id: session.id,
         turn_id: turn_id,
         provider_runs: provider_runs,
         agent_runs: Enum.map(agent_runs, &agent_run_summary(&1, events_by_run)),
         totals: totals(provider_runs)
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

  defp agent_run_summary(run, events_by_run) do
    %{
      run_id: run.id,
      run_mode: run.run_mode,
      profile_ref: run.profile_ref,
      status: run.status,
      phase: run.phase,
      parent_turn_ref: run.parent_turn_ref,
      trigger: run.trigger,
      long_run_task_ref: run.long_run_task_ref,
      plan_ref: run.plan_ref,
      plan_version: run.plan_version,
      event_count: length(Map.get(events_by_run, run.id, [])),
      provider_run_count: length(ProviderRunLog.list_runs(run.id)),
      events: Enum.map(Map.get(events_by_run, run.id, []), &agent_event_summary(&1, run))
    }
  end

  defp agent_event_summary(event, run) do
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

  defp provider_runs_for_agent_run(run) do
    run.id
    |> ProviderRunLog.list_activity_summaries()
    |> Enum.map(&Map.put(&1, :run_id, run.id))
  end

  defp totals(provider_runs) do
    %{
      provider_run_count: length(provider_runs),
      provider_call_refs:
        provider_runs
        |> Enum.map(&map_value(&1, :provider_call_ref))
        |> Enum.reject(&blank?/1),
      total_tokens: Enum.reduce(provider_runs, 0, &(&2 + provider_tokens(&1))),
      content_length: Enum.reduce(provider_runs, 0, &(&2 + content_length(&1)))
    }
  end

  defp provider_tokens(run) do
    usage =
      case map_value(run, :output) do
        output when is_map(output) -> map_value(output, :usage)
        _ -> nil
      end

    usage = if is_map(usage), do: usage, else: map_value(run, :usage)

    total_tokens = integer_value(usage, :total_tokens)

    if total_tokens > 0 do
      total_tokens
    else
      integer_value(usage, :input_tokens) + integer_value(usage, :output_tokens) +
        integer_value(usage, :prompt_tokens) + integer_value(usage, :completion_tokens)
    end
  end

  defp content_length(run), do: integer_value(run, :content_length)

  defp integer_value(map, key) when is_map(map) do
    case map_value(map, key) do
      value when is_integer(value) -> value
      value when is_binary(value) -> parse_integer(value)
      _ -> 0
    end
  end

  defp integer_value(_map, _key), do: 0

  defp parse_integer(value) do
    case Integer.parse(value) do
      {number, ""} -> number
      _ -> 0
    end
  end

  defp map_value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_value(_map, _key), do: nil

  defp blank?(value), do: value in [nil, ""]

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
end
