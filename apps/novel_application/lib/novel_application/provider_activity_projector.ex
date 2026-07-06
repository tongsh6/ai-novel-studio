defmodule NovelApplication.ProviderActivityProjector do
  @moduledoc """
  Projects provider execution facts into developer AgentRun stage events.

  ProviderRun / ProviderEvent / ProviderOutput stay owned by novel_agent and
  novel_common. Ordinary provider facts remain developer telemetry here. The
  narrow exception is `:author_reasoning` chunk deltas, which are model bytes
  from the author-visible reasoning segment and are later verified against the
  terminal ProviderOutput by N-NARR.
  """

  alias NovelAgent.Provider.Execution
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelDomain.AgentRun
  alias NovelPersistence.ProviderRunLog

  @spec with_stage_sink(Execution.dependency(), map() | nil, keyword()) :: Execution.dependency()
  def with_stage_sink(provider_execution, snapshot, opts \\ []) do
    provider_execution =
      provider_execution
      |> Execution.with_cancellation_token(cancellation_token(snapshot))

    case stage_sink(snapshot) do
      nil ->
        provider_execution

      sink ->
        Execution.with_event_sink(provider_execution, fn execution_result ->
          emit_provider_activity(sink, execution_result, opts)
          record_provider_execution_async(snapshot, execution_result, opts)
        end)
    end
  end

  defp record_provider_execution_async(snapshot, execution_result, opts) do
    cond do
      not runtime_fact_persistence_enabled?() ->
        :ok

      not recordable_provider_execution?(execution_result) ->
        :ok

      async_persistence_enabled?() ->
        Task.Supervisor.start_child(NovelApplication.BackgroundTaskSupervisor, fn ->
          record_provider_execution(snapshot, execution_result, opts)
        end)

        :ok

      true ->
        record_provider_execution(snapshot, execution_result, opts)
    end
  rescue
    _error ->
      record_provider_execution(snapshot, execution_result, opts)
  catch
    _kind, _reason ->
      record_provider_execution(snapshot, execution_result, opts)
  end

  defp runtime_fact_persistence_enabled? do
    Application.get_env(:novel_application, :agent_run_fact_persistence_enabled, true)
  end

  defp recordable_provider_execution?(execution_result) do
    case execution_facts(execution_result) do
      %{provider_run: %ProviderRun{}} = facts -> provider_execution_has_facts?(facts)
      _ -> false
    end
  end

  defp provider_execution_has_facts?(facts) when is_map(facts) do
    events? =
      facts
      |> Map.get(:events, [])
      |> Enum.any?(&match?(%ProviderEvent{}, &1))

    events? or match?(%ProviderOutput{}, Map.get(facts, :output))
  end

  defp async_persistence_enabled? do
    :novel_persistence
    |> Application.get_env(NovelPersistence.Repo, [])
    |> Keyword.get(:pool) != Ecto.Adapters.SQL.Sandbox
  end

  defp record_provider_execution(snapshot, execution_result, opts) do
    context = provider_run_context(snapshot, opts)

    case ProviderRunLog.record_execution(execution_result, context) do
      :ok -> :ok
      {:error, _reason} -> :ok
    end
  rescue
    _error -> :ok
  catch
    :exit, _reason -> :ok
  end

  defp emit_provider_activity(stage_sink, execution_result, opts)
       when is_function(stage_sink, 1) do
    execution_result
    |> execution_facts()
    |> case do
      nil ->
        :ok

      facts ->
        facts
        |> Map.get(:events, [])
        |> Enum.filter(&match?(%ProviderEvent{}, &1))
        |> Enum.each(&emit_provider_event(stage_sink, &1, facts, opts))
    end
  end

  defp execution_facts({:ok, facts}) when is_map(facts), do: facts
  defp execution_facts({:error, facts}) when is_map(facts), do: facts
  defp execution_facts(facts) when is_map(facts), do: facts
  defp execution_facts(_), do: nil

  defp emit_provider_event(stage_sink, %ProviderEvent{} = event, facts, opts) do
    run = Map.get(facts, :provider_run)
    output = Map.get(facts, :output)
    purpose = Keyword.get(opts, :purpose) || provider_purpose(run)
    payload = payload(event, run, output, purpose)

    stage_sink.(%{
      event_type: :provider_progress,
      visibility: visibility(event, purpose, payload),
      summary: summary(event, purpose, output, payload),
      reason_codes: reason_codes(event),
      refs: refs(event, run, output),
      payload: payload
    })

    :ok
  end

  defp summary(%ProviderEvent{}, _purpose, _output, %{author_narrative_delta: delta})
       when is_binary(delta) and delta != "",
       do: delta

  defp summary(%ProviderEvent{event_type: :progress, payload: payload}, _purpose, _output, _attrs) do
    case payload_phase(payload) do
      phase when is_binary(phase) -> "provider_event:progress phase=#{phase}"
      _ -> "provider_event:progress"
    end
  end

  defp summary(%ProviderEvent{event_type: type}, _purpose, _output, _attrs),
    do: "provider_event:#{type}"

  defp visibility(%ProviderEvent{event_type: :chunk}, purpose, %{author_narrative_delta: delta})
       when purpose in [:author_reasoning, "author_reasoning"] and is_binary(delta) and
              delta != "",
       do: :author

  defp visibility(_event, _purpose, _payload), do: :developer

  defp reason_codes(%ProviderEvent{} = event) do
    [
      "provider_execution_stream",
      "provider_#{event.event_type}",
      phase_reason_code(event)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp payload(%ProviderEvent{} = event, run, output, purpose) do
    %{
      stage: :provider_execution_recorded,
      provider_event_type: event.event_type,
      provider_progress_phase: payload_phase(event.payload),
      provider_run_ref: provider_run_ref(event, run, output),
      provider_call_ref: provider_call_ref(event, run, output),
      purpose: normalize_atom(purpose),
      status: output_status(output) || run_status(run),
      output_type: projected_output_type(event, output),
      content_length: projected_content_length(event, output),
      native_tool_call_count: projected_tool_call_count(event, output),
      native_tool_call_names: projected_tool_call_names(event, output),
      chunk_index: payload_number(event.payload, :chunk_index),
      chunk_content_length: payload_number(event.payload, :content_length),
      accumulated_content_length: payload_number(event.payload, :accumulated_content_length),
      author_narrative_delta: author_narrative_delta(event, purpose),
      usage: projected_usage(event, output)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp refs(%ProviderEvent{} = event, run, output) do
    [
      ref("provider_event", event.event_id),
      ref("provider_run", provider_run_ref(event, run, output)),
      ref("provider_call", provider_call_ref(event, run, output))
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp ref(_prefix, nil), do: nil
  defp ref(_prefix, ""), do: nil
  defp ref(prefix, value), do: "#{prefix}:#{value}"

  defp provider_run_ref(%ProviderEvent{provider_run_ref: ref}, _run, _output)
       when is_binary(ref) and ref != "",
       do: ref

  defp provider_run_ref(_event, %ProviderRun{provider_run_id: ref}, _output), do: ref
  defp provider_run_ref(_event, _run, %ProviderOutput{provider_run_ref: ref}), do: ref
  defp provider_run_ref(_event, _run, _output), do: nil

  defp provider_call_ref(%ProviderEvent{refs: [ref | _rest]}, _run, _output)
       when is_binary(ref) and ref != "",
       do: ref

  defp provider_call_ref(_event, %ProviderRun{provider_call_ref: ref}, _output), do: ref
  defp provider_call_ref(_event, _run, %ProviderOutput{provider_call_ref: ref}), do: ref
  defp provider_call_ref(_event, _run, _output), do: nil

  defp provider_purpose(%ProviderRun{purpose: purpose}), do: purpose
  defp provider_purpose(_), do: :other

  defp output_status(%ProviderOutput{status: status}), do: normalize_atom(status)
  defp output_status(_), do: nil

  defp run_status(%ProviderRun{status: status}), do: normalize_atom(status)
  defp run_status(_), do: nil

  defp output_type(%ProviderOutput{output_type: type}), do: normalize_atom(type)
  defp output_type(_), do: nil

  defp projected_output_type(%ProviderEvent{event_type: type, payload: payload}, _output)
       when type in [:chunk, :progress],
       do: payload_output_type(payload)

  defp projected_output_type(%ProviderEvent{event_type: type}, output)
       when type in [:final_output, :error],
       do: output_type(output)

  defp projected_output_type(_event, _output), do: nil

  defp projected_content_length(%ProviderEvent{event_type: :progress, payload: payload}, _output),
    do: payload_number(payload, :content_length)

  defp projected_content_length(
         %ProviderEvent{event_type: :final_output, payload: payload},
         output
       ),
       do: content_length(output) || payload_number(payload, :content_length)

  defp projected_content_length(_event, _output), do: nil

  defp projected_tool_call_count(%ProviderEvent{event_type: :final_output}, output) do
    case output_tool_calls(output) do
      [] -> nil
      calls -> length(calls)
    end
  end

  defp projected_tool_call_count(_event, _output), do: nil

  defp projected_tool_call_names(%ProviderEvent{event_type: :final_output}, output) do
    output
    |> output_tool_calls()
    |> Enum.flat_map(fn call ->
      case map_get(call, :name) do
        name when is_binary(name) and name != "" -> [name]
        _ -> []
      end
    end)
    |> Enum.uniq()
    |> case do
      [] -> nil
      names -> names
    end
  end

  defp projected_tool_call_names(_event, _output), do: nil

  defp projected_usage(%ProviderEvent{event_type: type, payload: payload}, output)
       when type in [:final_output, :usage_recorded] do
    usage(output) || payload_usage(payload)
  end

  defp projected_usage(_event, _output), do: nil

  defp payload_output_type(payload) when is_map(payload) do
    payload
    |> map_get(:output_type)
    |> normalize_atom()
  end

  defp payload_output_type(_), do: nil

  defp content_length(%ProviderOutput{content: content}) when is_map(content) do
    content
    |> Map.get(:text, Map.get(content, "text"))
    |> case do
      text when is_binary(text) -> String.length(text)
      _ -> nil
    end
  end

  defp content_length(_), do: nil

  defp output_tool_calls(%ProviderOutput{content: content}) when is_map(content) do
    case map_get(content, :tool_calls) do
      calls when is_list(calls) -> Enum.filter(calls, &is_map/1)
      _ -> []
    end
  end

  defp output_tool_calls(_output), do: []

  defp usage(%ProviderOutput{usage: usage}) when is_map(usage) and map_size(usage) > 0,
    do: usage

  defp usage(_), do: nil

  defp payload_usage(payload) when is_map(payload) do
    case map_get(payload, :usage) do
      usage when is_map(usage) and map_size(usage) > 0 -> usage
      _ -> nil
    end
  end

  defp payload_usage(_), do: nil

  defp payload_phase(payload) when is_map(payload) do
    payload
    |> map_get(:phase)
    |> normalize_atom()
  end

  defp payload_phase(_), do: nil

  defp payload_number(payload, key) when is_map(payload) do
    case map_get(payload, key) do
      value when is_integer(value) and value >= 0 -> value
      value when is_float(value) and value >= 0 -> trunc(value)
      _ -> nil
    end
  end

  defp payload_number(_payload, _key), do: nil

  defp payload_string(payload, key) when is_map(payload) do
    case map_get(payload, key) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp payload_string(_payload, _key), do: nil

  defp author_narrative_delta(%ProviderEvent{event_type: :chunk, payload: payload}, purpose)
       when purpose in [:author_reasoning, "author_reasoning"],
       do: payload_string(payload, :author_narrative_delta)

  defp author_narrative_delta(_event, _purpose), do: nil

  defp phase_reason_code(%ProviderEvent{event_type: :progress, payload: payload}) do
    case payload_phase(payload) do
      "request_prepared" -> "provider_request_prepared"
      "request_dispatched" -> "provider_request_dispatched"
      "response_received" -> "provider_response_received"
      _ -> nil
    end
  end

  defp phase_reason_code(_event), do: nil

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp normalize_atom(nil), do: nil
  defp normalize_atom(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_atom(value) when is_binary(value), do: value
  defp normalize_atom(_), do: nil

  defp stage_sink(%{stage_sink: sink}) when is_function(sink, 1), do: sink
  defp stage_sink(_), do: nil

  defp cancellation_token(%{provider_cancellation_token: token}) when is_pid(token), do: token
  defp cancellation_token(_snapshot), do: nil

  defp provider_run_context(%{run: %AgentRun{} = run}, opts) do
    %{
      agent_run_id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      step_id: run.current_step_ref,
      purpose: Keyword.get(opts, :purpose)
    }
  end

  defp provider_run_context(_snapshot, opts), do: %{purpose: Keyword.get(opts, :purpose)}
end
