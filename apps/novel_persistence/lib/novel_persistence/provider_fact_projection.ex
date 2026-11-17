defmodule NovelPersistence.ProviderFactProjection do
  @moduledoc """
  Provider 持久事实的纯表示边界。

  将执行契约转换为作者安全的持久 JSON，并将持久行转换为用量与活动摘要。
  输出 digest 只绑定真实文本字节；原始正文与隐私载荷不进入展示或持久摘要。
  由 ProviderRunLog 唯一消费，本模块不查询、提交、归并或授予执行资格。
  """

  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}

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
    operation_checkpoint
    response_text
    provider_error_payload
    raw_messages
    raw_prompt
    raw_provider_error
    secret
    system_prompt
    text
    turn_result
  ]

  @spec run_attrs(ProviderRun.t(), map()) :: map()
  def run_attrs(%ProviderRun{} = run, context) do
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
      finite_mode_name: finite_mode_name(run.metadata),
      started_at: parse_datetime(run.started_at),
      completed_at: parse_datetime(run.completed_at)
    }
  end

  @spec event_attrs(ProviderEvent.t(), ProviderRun.t(), map()) :: map()
  def event_attrs(%ProviderEvent{} = event, %ProviderRun{} = run, context) do
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

  @spec output_attrs(ProviderOutput.t(), ProviderRun.t(), map()) :: map()
  def output_attrs(%ProviderOutput{} = output, %ProviderRun{} = run, context) do
    content_length = output_content_length(output)

    %{
      provider_run_id: output.provider_run_ref || run.provider_run_id,
      provider_call_ref: output.provider_call_ref || run.provider_call_ref,
      agent_run_id:
        context_ref(context, :agent_run_id) || owner_ref(run.owner_refs, :agent_run_id),
      status: atom_string(output.status),
      output_type: atom_string(output.output_type),
      content_length: content_length,
      content_summary: output_content_summary(output, content_length),
      usage: safe_map(output.usage),
      error_summary: error_summary(output.error),
      refs: safe_refs(output.refs),
      finalized_at: parse_datetime(output.finalized_at)
    }
  end

  @spec usage_summary(ProviderRunRecord.t(), ProviderOutputRecord.t() | nil) :: map()
  def usage_summary(%ProviderRunRecord{} = run, output) do
    %{
      provider_run_ref: run.id,
      provider_call_ref: run.provider_call_ref,
      step_ref: run.step_id,
      purpose: run.purpose,
      operation: map_get(run.owner_refs, :operation),
      status: output_status(output) || run.status,
      output_type: output_type(output),
      content_length: output_content_length(output),
      usage: output_usage(output),
      system_identity_ref: identity_ref(run.metadata),
      provider_id: run.provider_id,
      model: run.model
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp identity_ref(metadata) when is_map(metadata) do
    Map.get(metadata, "system_identity_ref") || Map.get(metadata, :system_identity_ref)
  end

  defp identity_ref(_metadata), do: nil

  # VS-00L §6.4：有限模式必须进入持久执行事实。完整声明仍在 metadata.finite_mode；
  # 这里提取可索引的 name 列，供查询与验收读侧消费（缺省 = 完整模式）。
  defp finite_mode_name(metadata) when is_map(metadata) do
    case Map.get(metadata, :finite_mode) || Map.get(metadata, "finite_mode") do
      %{} = mode -> Map.get(mode, :name) || Map.get(mode, "name")
      name when is_binary(name) -> name
      _other -> nil
    end
  end

  defp finite_mode_name(_metadata), do: nil

  @spec event_summary(ProviderEventRecord.t()) :: map()
  def event_summary(%ProviderEventRecord{} = event) do
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

  @spec output_summary(ProviderOutputRecord.t() | nil) :: map()
  def output_summary(%ProviderOutputRecord{} = output) do
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

  def output_summary(_), do: %{}

  # §16.12 唯一存储边界：错误载荷与正常载荷使用同一作者安全 JSON 形态。
  # atom/string 表示同一事实，在比较/写入前归一；归并不放宽逐字段严格比较。
  defp provider_event_payload(%ProviderEvent{event_type: :error, payload: payload}) do
    %{
      "reason_code" =>
        safe_value(map_get(payload, :reason_code) || map_get(payload, :type) || "provider_error")
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

  defp output_content_summary(%ProviderOutput{} = output, content_length) do
    summary =
      case map_get(output.content, :text) do
        text when is_binary(text) ->
          %{
            "content_length" => content_length,
            "content_sha256" => :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
          }

        _ ->
          %{"content_length" => content_length}
      end

    case output_tool_call_names(output) do
      [] ->
        summary

      names ->
        summary
        |> Map.put("native_tool_call_count", length(output_tool_calls(output)))
        |> Map.put("native_tool_call_names", names)
    end
  end

  defp output_tool_call_names(%ProviderOutput{} = output) do
    output
    |> output_tool_calls()
    |> Enum.flat_map(fn call ->
      case map_get(call, :name) do
        name when is_binary(name) and name != "" -> [name]
        _ -> []
      end
    end)
    |> Enum.uniq()
  end

  defp output_tool_calls(%ProviderOutput{content: content}) when is_map(content) do
    case map_get(content, :tool_calls) do
      calls when is_list(calls) -> Enum.filter(calls, &is_map/1)
      _ -> []
    end
  end

  defp output_tool_calls(_), do: []

  defp error_summary(error) when is_map(error) and map_size(error) > 0 do
    %{
      "type" =>
        safe_value(map_get(error, :type) || map_get(error, :reason_code) || "provider_error")
    }
  end

  defp error_summary(_), do: %{}

  defp safe_map(map) when is_map(map) do
    map
    |> Enum.reject(fn {key, _value} -> unsafe_key?(key) end)
    |> Map.new(fn {key, value} -> {to_string(key), safe_value(value)} end)
  end

  defp safe_map(_), do: %{}

  defp safe_value(value) when is_boolean(value), do: value
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
