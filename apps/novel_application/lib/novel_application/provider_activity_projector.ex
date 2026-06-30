defmodule NovelApplication.ProviderActivityProjector do
  @moduledoc """
  Projects provider execution facts into author-safe AgentRun stage events.

  ProviderRun / ProviderEvent / ProviderOutput stay owned by novel_agent and
  novel_common. The application layer decides how those facts are summarized for
  authors inside the AgentRun activity stream.
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
          record_provider_execution(snapshot, execution_result, opts)
          emit_provider_activity(sink, execution_result, opts)
        end)
    end
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

    stage_sink.(%{
      event_type: :provider_progress,
      summary: summary(event, purpose, output),
      reason_codes: reason_codes(event),
      refs: refs(event, run, output),
      payload: payload(event, run, output, purpose)
    })

    :ok
  end

  defp summary(%ProviderEvent{event_type: :started}, purpose, _output),
    do: "#{purpose_label(purpose)}已开始调用创作模型。"

  defp summary(%ProviderEvent{event_type: :progress, payload: payload}, purpose, _output) do
    case payload_phase(payload) do
      "request_prepared" -> "#{purpose_label(purpose)}已准备模型请求。"
      "request_dispatched" -> "#{purpose_label(purpose)}已发送模型请求，等待结果。"
      "response_received" -> "#{purpose_label(purpose)}已收到模型响应，正在整理输出。"
      _ -> "#{purpose_label(purpose)}正在接收创作模型进展。"
    end
  end

  defp summary(%ProviderEvent{event_type: :chunk}, purpose, _output),
    do: "#{purpose_label(purpose)}正在接收模型片段。"

  defp summary(%ProviderEvent{event_type: :final_output}, purpose, %ProviderOutput{status: :ok}),
    do: "#{purpose_label(purpose)}已收到创作模型结果。"

  defp summary(%ProviderEvent{event_type: :usage_recorded}, purpose, _output),
    do: "#{purpose_label(purpose)}已记录模型用量。"

  defp summary(%ProviderEvent{event_type: :error}, purpose, _output),
    do: "#{purpose_label(purpose)}调用创作模型失败。"

  defp summary(%ProviderEvent{event_type: :cancel_requested}, purpose, _output),
    do: "#{purpose_label(purpose)}已请求取消模型调用。"

  defp summary(%ProviderEvent{event_type: :cancelled}, purpose, _output),
    do: "#{purpose_label(purpose)}模型调用已取消。"

  defp summary(_event, purpose, _output),
    do: "#{purpose_label(purpose)}模型调用状态已更新。"

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
      chunk_index: payload_number(event.payload, :chunk_index),
      chunk_content_length: payload_number(event.payload, :content_length),
      accumulated_content_length: payload_number(event.payload, :accumulated_content_length),
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

  defp purpose_label(:conversation), do: "对话判断"
  defp purpose_label(:planner), do: "步骤规划"
  defp purpose_label(:writer), do: "内容生成"
  defp purpose_label(:evaluator), do: "质量复核"
  defp purpose_label(:revision), do: "修订生成"
  defp purpose_label(:tool), do: "工具执行"
  defp purpose_label(:narration), do: "回应整理"
  defp purpose_label(_), do: "模型调用"

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
