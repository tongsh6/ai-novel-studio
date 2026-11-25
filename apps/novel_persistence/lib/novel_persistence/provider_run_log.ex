defmodule NovelPersistence.ProviderRunLog do
  @moduledoc """
  Provider 执行事实的唯一持久提交边界。

  审计与 UI 只读取安全引用、状态、用量和摘要。已准入操作的待提交计划与最终
  文本由私有 operation_checkpoint 暂存，canonical 提交同事务清除，不进入展示。
  run、event、output 及待提交文本在同一
  read-compare-write 事务内提交，进入事务时先声明 SQLite 写意图并复用既有
  busy_timeout；错误与正常载荷在比较/写入前统一为作者安全的持久 JSON 形态。
  """

  import Ecto.Query, only: [from: 2]

  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.{ProviderFactMerge, ProviderFactProjection, Repo}

  alias NovelPersistence.Schemas.{
    ProviderEventRecord,
    ProviderOutputRecord,
    ProviderRunRecord
  }

  @spec record_execution(term(), map()) :: :ok | {:error, term()}
  def record_execution(execution_result, context \\ %{}) do
    case execution_facts(execution_result) do
      %{provider_run: %ProviderRun{} = run} = facts ->
        do_record_execution(run, facts, context)

      _ ->
        {:error, :provider_run_missing}
    end
  end

  @doc "在同一写事务中核定剩余根额度并提交唯一 initialized 物理调用。"
  @spec admit_execution(ProviderRun.t(), map(), non_neg_integer()) :: :ok | {:error, term()}
  def admit_execution(%ProviderRun{status: :initialized} = run, context, limit)
      when is_integer(limit) and limit >= 0 do
    do_record_execution(run, %{provider_run: run, events: []}, context, {:admit_execution, limit})
  end

  @doc """
  为已核实的同一作品/会话来源集原子授予一次 Provider 执行权。
  来源核验与 initialized 写入在同一个写事务内；提交前不得派发。
  """
  @spec admit_operation(ProviderRun.t(), map(), non_neg_integer(), (-> :ok | {:error, term()})) ::
          :ok | {:error, term()}
  def admit_operation(%ProviderRun{status: :initialized} = run, context, limit, validate_sources)
      when is_integer(limit) and limit >= 0 and is_function(validate_sources, 0) do
    do_record_execution(
      run,
      %{provider_run: run, events: []},
      context,
      {:admit_operation, limit, validate_sources}
    )
  end

  # 执行资格属于真实来源坐标；coverage_key 只核验冻结请求的完整性。
  @spec operation_owned?(map(), String.t(), [String.t()]) :: boolean()
  defp operation_owned?(scope, operation, source_keys) do
    requested_sources = Jason.encode!(source_keys)
    query = operation_runs(scope, operation)

    from(r in query,
      where:
        fragment(
          "EXISTS (SELECT 1 FROM json_each(?, '$.discussion_source_keys') AS stored JOIN json_each(?) AS requested ON stored.value = requested.value)",
          r.owner_refs,
          ^requested_sources
        )
    )
    |> Repo.exists?()
  end

  @doc "读取已授予的来源归属；不等于执行完成，未知持久格式也不等于没有归属。"
  @spec operation_source_keys(map(), String.t()) :: {:ok, MapSet.t(String.t())} | {:error, atom()}
  def operation_source_keys(scope, operation) do
    query = operation_runs(scope, operation)

    groups =
      from(r in query, select: r.owner_refs)
      |> Repo.all()
      |> Enum.map(&map_get(&1, :discussion_source_keys))

    if Enum.all?(groups, &ProviderFactMerge.valid_operation_sources?(&1, scope)),
      do: {:ok, groups |> List.flatten() |> MapSet.new()},
      else: {:error, :provider_operation_sources_unsupported}
  end

  @doc "Private recovery candidates; public activity/usage continue their explicit projections."
  def pending_operations(scope, operation) do
    query = operation_runs(scope, operation)

    from(r in query,
      where: r.status == "completed" and not is_nil(r.operation_checkpoint),
      where: fragment("json_type(?, '$.response_text') = 'text'", r.operation_checkpoint),
      order_by: [asc: r.inserted_at, asc: r.id]
    )
    |> Repo.all()
  end

  @doc "Transfer pending output ownership only with the canonical snapshot's transaction."
  def consume_operation_outputs(_run_record, nil), do: :ok

  def consume_operation_outputs(run_record, %{messages: messages}) do
    if Repo.in_transaction?() do
      messages
      |> Enum.filter(&(map_get(&1, :role) == "checkpoint"))
      |> Enum.flat_map(&map_get(&1, :blocks))
      |> Enum.filter(&is_map(map_get(&1, :discussion)))
      |> Enum.reduce_while(:ok, &consume_operation_block(&1, run_record, &2))
    else
      {:error, :provider_operation_transaction_required}
    end
  end

  defp consume_operation_block(block, run_record, :ok) do
    discussion = map_get(block, :discussion)
    execution = get_run(map_get(discussion, :provider_run_ref))
    origin = if execution, do: NovelPersistence.AgentRunLog.get_run(execution.agent_run_id)
    persisted_target = NovelPersistence.AgentRunLog.get_run(run_record.id)

    decision =
      ProviderFactMerge.consume_operation(execution, origin, run_record, persisted_target, block)

    case apply_decision(decision, execution, :provider_run) do
      {:ok, _record} -> {:cont, :ok}
      {:error, _} = error -> {:halt, error}
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

  @doc "同一 run 的实际派发及尚不能释放的占用；按物理调用去重，不使用结果次数估算。"
  @spec budget_usage(String.t()) :: %{consumed: non_neg_integer(), reserved: non_neg_integer()}
  def budget_usage(agent_run_id) when is_binary(agent_run_id) do
    from(r in ProviderRunRecord,
      left_join: e in ProviderEventRecord,
      on: e.provider_run_id == r.id,
      where: r.agent_run_id == ^agent_run_id,
      group_by: [r.id, r.status],
      select: {
        r.status,
        fragment(
          "MAX(CASE WHEN ? IN ('chunk','usage_recorded') OR json_extract(?, '$.phase') = 'request_dispatched' THEN 1 ELSE 0 END)",
          e.event_type,
          e.payload
        ),
        fragment(
          "MAX(CASE WHEN ? = 'progress' AND json_extract(?, '$.phase') = 'request_not_dispatched' THEN 1 ELSE 0 END)",
          e.event_type,
          e.payload
        )
      }
    )
    |> Repo.all()
    |> Enum.reduce(%{consumed: 0, reserved: 0}, fn
      {status, dispatched, _}, acc when status == "completed" or dispatched == 1 ->
        %{acc | consumed: acc.consumed + 1}

      {status, 0, 1}, acc when status in ["failed", "cancelled"] ->
        acc

      _, acc ->
        %{acc | reserved: acc.reserved + 1}
    end)
  end

  @spec list_events(String.t()) :: [ProviderEventRecord.t()]
  def list_events(provider_run_id) when is_binary(provider_run_id) do
    from(e in ProviderEventRecord,
      where: e.provider_run_id == ^provider_run_id,
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec get_run(String.t()) :: ProviderRunRecord.t() | nil
  def get_run(provider_run_id) when is_binary(provider_run_id),
    do: Repo.get(ProviderRunRecord, provider_run_id)

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
    |> Enum.map(&ProviderFactProjection.usage_summary(&1, Map.get(outputs_by_run, &1.id)))
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
          ProviderFactProjection.usage_summary(run, Map.get(outputs_by_run, run.id))
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
      |> ProviderFactProjection.usage_summary(output)
      |> Map.merge(%{
        events: Enum.map(list_events(run.id), &ProviderFactProjection.event_summary/1),
        output: ProviderFactProjection.output_summary(output)
      })
    end)
  end

  defp do_record_execution(run, facts, context, mode \\ :record) do
    events = facts |> Map.get(:events, []) |> Enum.filter(&match?(%ProviderEvent{}, &1))
    output = Map.get(facts, :output)

    run_attrs = ProviderFactProjection.run_attrs(run, context)

    run_attrs =
      if match?({:admit_operation, _, _}, mode),
        do:
          Map.put(
            run_attrs,
            :operation_checkpoint,
            NovelCommon.RequestIR.json_value(Map.get(context, :operation_checkpoint))
          ),
        else: run_attrs

    event_attrs = Enum.map(events, &ProviderFactProjection.event_attrs(&1, run, context))

    output_attrs =
      if match?(%ProviderOutput{}, output),
        do: ProviderFactProjection.output_attrs(output, run, context)

    # VS-00L §16.12：本边界是 read-compare-write 事务，进入时先声明写意图，
    # 复用数据库既有的 busy_timeout，避免 DEFERRED 读后在并发提交时升级失败。
    Repo.transaction(
      fn ->
        with :ok <- ensure_operation_admission(run_attrs, mode),
             {:ok, _run_record} <- commit_run(run_attrs),
             {:ok, _event_records} <- commit_events(run_attrs.id, event_attrs),
             {:ok, _output_record} <- commit_output(run_attrs, output_attrs),
             :ok <- record_operation_output(run_attrs.id, output) do
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

  defp ensure_operation_admission(attrs, :record) do
    existing = Repo.get(ProviderRunRecord, attrs.id)
    ProviderFactMerge.operation_ownership(existing, attrs)
  end

  defp ensure_operation_admission(attrs, {:admit_execution, limit}) do
    with :ok <- ProviderFactMerge.runtime_admission_claim(attrs) do
      ensure_capacity(attrs, limit)
    end
  end

  defp ensure_operation_admission(attrs, {:admit_operation, limit, validate_sources}) do
    existing = Repo.get(ProviderRunRecord, attrs.id)

    with {:ok, {operation, _coverage_key, source_keys}} <-
           ProviderFactMerge.operation_claim(attrs),
         {:ok, _owned_sources} <- operation_source_keys(attrs, operation),
         :ok <- validate_operation_sources(validate_sources) do
      cond do
        operation_owned?(attrs, operation, source_keys) ->
          {:error, :provider_operation_already_owned}

        not is_nil(existing) ->
          {:error, :provider_operation_identity_conflict}

        not ProviderFactMerge.valid_new_operation_checkpoint?(attrs.operation_checkpoint) ->
          {:error, :provider_operation_checkpoint_invalid}

        true ->
          ensure_capacity(attrs, limit)
      end
    end
  end

  # 已派发与未知占用都占同一个根 grant。事务内查重与提交，不能在查询之后再派发。
  defp ensure_capacity(attrs, limit) do
    cond do
      not is_binary(attrs.agent_run_id) or attrs.agent_run_id == "" ->
        {:error, :provider_execution_scope_missing}

      Repo.get(ProviderRunRecord, attrs.id) || existing_run_call_owner(attrs.provider_call_ref) ->
        {:error, :provider_execution_identity_conflict}

      true ->
        %{consumed: consumed, reserved: reserved} = budget_usage(attrs.agent_run_id)
        if consumed + reserved < limit, do: :ok, else: {:error, :provider_budget_exhausted}
    end
  end

  defp validate_operation_sources(validate_sources) do
    case validate_sources.() do
      :ok -> :ok
      {:error, _reason} = error -> error
      _ -> {:error, :provider_operation_source_validation_invalid}
    end
  end

  defp record_operation_output(_run_id, nil), do: :ok

  defp record_operation_output(run_id, output) do
    record = get_run(run_id)

    case apply_decision(ProviderFactMerge.operation_output(record, output), record, :provider_run) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  defp operation_runs(scope, operation) do
    workspace_id = map_get(scope, :workspace_id)
    work_id = map_get(scope, :work_id)
    session_id = map_get(scope, :session_id)

    from(r in ProviderRunRecord,
      where:
        r.workspace_id == ^workspace_id and r.work_id == ^work_id and r.session_id == ^session_id,
      where: fragment("json_extract(?, '$.operation') = ?", r.owner_refs, ^operation)
    )
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

  defp execution_facts({:ok, facts}) when is_map(facts), do: facts
  defp execution_facts({:error, facts}) when is_map(facts), do: facts
  defp execution_facts(facts) when is_map(facts), do: facts
  defp execution_facts(_), do: nil

  defp map_get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_get(_map, _key), do: nil

  defp normalize_ids(ids) do
    ids
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.uniq()
  end
end
