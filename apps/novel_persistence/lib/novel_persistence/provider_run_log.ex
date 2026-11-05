defmodule NovelPersistence.ProviderRunLog do
  @moduledoc """
  Provider 执行事实的唯一持久提交边界。

  Provider 运行时可以在内存中持有原始模型文本或错误细节；本模块只落库审计与
  UI 用量展示所需的引用、状态、用量和摘要事实。run、event、output 在同一
  read-compare-write 事务内提交，进入事务时先声明 SQLite 写意图并复用既有
  busy_timeout；错误与正常载荷在比较/写入前统一为作者安全的持久 JSON 形态。
  """

  import Ecto.Query, only: [from: 2]

  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.{ProviderFactMerge, Repo}

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

  @spec list_usage_summaries_by_agent_run_ids([String.t()]) :: %{String.t() => [map()]}
  def list_usage_summaries_by_agent_run_ids(agent_run_ids) when is_list(agent_run_ids) do
    case normalize_ids(agent_run_ids) do
      [] ->
        %{}

      ids ->
        outputs_by_run =
          from(o in ProviderOutputRecord,
            where: o.agent_run_id in ^ids
          )
          |> Repo.all()
          |> Map.new(&{&1.provider_run_id, &1})

        from(r in ProviderRunRecord,
          where: r.agent_run_id in ^ids,
          order_by: [asc: r.agent_run_id, asc: r.inserted_at, asc: r.id]
        )
        |> Repo.all()
        |> Enum.group_by(& &1.agent_run_id, fn run ->
          usage_summary(run, Map.get(outputs_by_run, run.id))
        end)
    end
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

    run_attrs = run_attrs(run, context)
    event_attrs = Enum.map(events, &event_attrs(&1, run, context))
    output_attrs = if match?(%ProviderOutput{}, output), do: output_attrs(output, run, context)

    # VS-00L §16.12：本边界是 read-compare-write 事务，进入时先声明写意图，
    # 复用数据库既有的 busy_timeout，避免 DEFERRED 读后在并发提交时升级失败。
    Repo.transaction(
      fn ->
        with {:ok, _run_record} <- commit_run(run_attrs),
             {:ok, _event_records} <- commit_events(run_attrs.id, event_attrs),
             {:ok, _output_record} <- commit_output(run_attrs, output_attrs) do
          :ok
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end,
      mode: :immediate
    )
    |> case do
      {:ok, :ok} ->
        :ok

      {:error, %{__exception__: true} = error} ->
        {:error, {:provider_fact_transaction_failed, error.__struct__}}

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    error in [DBConnection.ConnectionError, DBConnection.OwnershipError, Exqlite.Error] ->
      {:error, {:provider_fact_transaction_failed, error.__struct__}}
  end

  defp commit_run(attrs) do
    case Repo.get(ProviderRunRecord, attrs.id) do
      nil ->
        case existing_run_call_owner(attrs.provider_call_ref) do
          nil ->
            insert_record(ProviderRunRecord, attrs, :provider_run)

          %ProviderRunRecord{} ->
            {:error, {:provider_run_call_ref_conflict, attrs.provider_call_ref}}
        end

      %ProviderRunRecord{} = record ->
        apply_decision(ProviderFactMerge.run(record, attrs), record, :provider_run)
    end
  end

  defp commit_events(run_id, event_attrs) do
    Enum.reduce_while(event_attrs, {:ok, nil}, fn attrs, _acc ->
      case commit_event(run_id, attrs) do
        {:ok, _record} -> {:cont, {:ok, nil}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp commit_event(run_id, attrs) do
    with :ok <- ensure_event_owner(run_id, attrs) do
      existing = Repo.get(ProviderEventRecord, attrs.id)

      case Repo.get_by(ProviderEventRecord,
             provider_run_id: attrs.provider_run_id,
             sequence: attrs.sequence
           ) do
        %ProviderEventRecord{id: id} when id != attrs.id ->
          {:error, {:provider_event_sequence_conflict, attrs.sequence}}

        _ ->
          apply_decision(ProviderFactMerge.event(existing, attrs), existing, :provider_event)
      end
    end
  end

  defp commit_output(_run_attrs, nil), do: {:ok, nil}

  defp commit_output(run_attrs, attrs) do
    with :ok <- ensure_output_owner(run_attrs, attrs) do
      case Repo.get(ProviderOutputRecord, attrs.provider_run_id) do
        nil ->
          insert_output(attrs)

        %ProviderOutputRecord{} = record ->
          apply_decision(ProviderFactMerge.output(record, attrs), record, :provider_output)
      end
    end
  end

  defp insert_output(attrs) do
    case existing_output_call_owner(attrs.provider_call_ref) do
      nil ->
        insert_record(ProviderOutputRecord, attrs, :provider_output)

      %ProviderOutputRecord{} ->
        {:error, {:provider_output_call_ref_conflict, attrs.provider_call_ref}}
    end
  end

  defp apply_decision(:unchanged, _record, _kind), do: {:ok, nil}

  defp apply_decision({:insert, attrs}, _existing, kind),
    do: insert_record(schema_for(kind), attrs, kind)

  defp apply_decision({:update, updates}, %{__struct__: _schema} = record, kind),
    do: update_record(record, updates, kind)

  defp apply_decision({:error, reason}, _record, _kind), do: {:error, reason}

  defp schema_for(:provider_run), do: ProviderRunRecord
  defp schema_for(:provider_event), do: ProviderEventRecord
  defp schema_for(:provider_output), do: ProviderOutputRecord

  defp insert_record(schema, attrs, kind) do
    schema
    |> struct()
    |> schema.changeset(attrs)
    |> Repo.insert()
    |> write_result(kind)
  end

  defp update_record(record, updates, kind) do
    schema = record.__struct__

    record
    |> schema.changeset(updates)
    |> Repo.update()
    |> write_result(kind)
  end

  defp write_result({:ok, record}, _kind), do: {:ok, record}

  defp write_result({:error, %Ecto.Changeset{} = changeset}, kind) do
    fields =
      changeset.errors
      |> Enum.map(fn {field, _error} -> field end)
      |> Enum.uniq()

    {:error, {write_error(kind), fields}}
  end

  defp write_result({:error, _other}, kind), do: {:error, {write_error(kind), []}}

  defp write_error(:provider_run), do: :provider_run_write_failed
  defp write_error(:provider_event), do: :provider_event_write_failed
  defp write_error(:provider_output), do: :provider_output_write_failed

  defp ensure_event_owner(run_id, attrs) do
    if attrs.provider_run_id == run_id do
      :ok
    else
      {:error, {:provider_event_run_conflict, attrs.id}}
    end
  end

  defp ensure_output_owner(run_attrs, attrs) do
    cond do
      attrs.provider_run_id != run_attrs.id ->
        {:error, {:provider_output_run_conflict, attrs.provider_run_id}}

      attrs.provider_call_ref != run_attrs.provider_call_ref ->
        {:error, {:provider_output_call_conflict, attrs.provider_call_ref}}

      true ->
        :ok
    end
  end

  defp existing_run_call_owner(ref) when is_binary(ref) and ref != "",
    do: Repo.get_by(ProviderRunRecord, provider_call_ref: ref)

  defp existing_run_call_owner(_ref), do: nil

  defp existing_output_call_owner(ref) when is_binary(ref) and ref != "",
    do: Repo.get_by(ProviderOutputRecord, provider_call_ref: ref)

  defp existing_output_call_owner(_ref), do: nil

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
      finite_mode_name: finite_mode_name(run.metadata),
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
      content_summary: output_content_summary(output, content_length),
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
      step_ref: run.step_id,
      purpose: run.purpose,
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
    summary = %{"content_length" => content_length}

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

  defp normalize_ids(ids) do
    ids
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.uniq()
  end
end
