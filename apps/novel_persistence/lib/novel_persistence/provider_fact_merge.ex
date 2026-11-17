defmodule NovelPersistence.ProviderFactMerge do
  @moduledoc """
  `ProviderRunLog` 唯一事实边界的纯归并判据。

  将 incoming run/event/output 与已提交行比较：同次调用身份与归属不可换绑，
  生命周期只前进，终态不能互换成另一种终态，event/output 内容冲突拒绝。
  调用方在同一个数据库事务内应用判据；本模块不做任何 I/O，也不按到达时间
  或 updated_at 决定覆盖。
  """

  alias NovelCommon.RequestIR.Compaction

  @type decision :: :unchanged | {:insert, map()} | {:update, map()} | {:error, term()}

  @terminal_statuses ~w[completed failed cancelled]
  @non_terminal_rank %{"initialized" => 0, "running" => 1, "cancel_requested" => 2}

  @run_identity_fields [:provider_call_ref, :purpose, :execution_mode]

  @run_attribution_fields [
    :agent_run_id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :step_id
  ]

  @run_descriptive_fields [
    :provider_id,
    :model,
    :owner_refs,
    :metadata,
    :started_at,
    :completed_at
  ]

  @event_identity_fields [:provider_run_id, :sequence]
  @event_attribution_fields [:agent_run_id]

  @event_content_fields [
    :provider_call_ref,
    :event_type,
    :visibility,
    :summary,
    :payload,
    :refs,
    :emitted_at
  ]

  @output_identity_fields [:provider_run_id, :provider_call_ref]
  @output_attribution_fields [:agent_run_id]

  @output_content_fields [
    :status,
    :output_type,
    :content_length,
    :content_summary,
    :usage,
    :error_summary,
    :refs,
    :finalized_at
  ]

  @spec run(map() | nil, map()) :: decision()
  def run(nil, attrs), do: {:insert, attrs}

  def run(existing, attrs) do
    with :ok <- identity(existing, attrs, @run_identity_fields, :provider_run),
         :ok <- attribution(existing, attrs, @run_attribution_fields, :provider_run),
         {:ok, status} <- run_status(existing.status, attrs.status) do
      updates =
        @run_identity_fields
        |> Kernel.++(@run_attribution_fields)
        |> Kernel.++(@run_descriptive_fields)
        |> fill_missing(existing, attrs)
        |> put_status(existing.status, status)

      if map_size(updates) == 0, do: :unchanged, else: {:update, updates}
    end
  end

  @doc "操作阶段事实只能延续已经准入的完整执行归属，不能创建、删除或改绑该归属。"
  @spec operation_ownership(map() | nil, map()) :: :ok | {:error, atom()}
  def operation_ownership(existing, attrs) do
    cond do
      operation_record?(existing) ->
        immutable =
          @run_identity_fields ++ @run_attribution_fields ++ [:provider_id, :model, :owner_refs]

        if same_values?(existing, attrs, immutable),
          do: :ok,
          else: {:error, :provider_operation_identity_conflict}

      operation_record?(attrs) ->
        {:error, :provider_operation_not_admitted}

      true ->
        :ok
    end
  end

  @doc "核验已归一持久表示中的操作范围和来源形状；来源资格由 Log 事务内查询决定。"
  @spec operation_claim(map()) ::
          {:ok, {String.t(), String.t(), [String.t()]}} | {:error, atom()}
  def operation_claim(attrs) do
    operation = Map.get(attrs.owner_refs, "operation")
    coverage_key = Map.get(attrs.owner_refs, "coverage_key")
    source_keys = Map.get(attrs.owner_refs, "discussion_source_keys")

    cond do
      not Enum.all?(
        [attrs.workspace_id, attrs.work_id, attrs.session_id, operation, coverage_key],
        &present_ref?/1
      ) ->
        {:error, :provider_operation_scope_missing}

      not valid_operation_sources?(source_keys, attrs) ->
        {:error, :provider_operation_sources_missing}

      true ->
        {:ok, {operation, coverage_key, source_keys}}
    end
  end

  @doc "准入与已有来源归属读取共用当前编码；未知格式不能当作无归属。"
  def valid_operation_sources?(sources, scope) when is_list(sources) and sources != [],
    do:
      Enum.all?(sources, &Compaction.valid_discussion_source_key?(&1, scope)) and
        Enum.uniq(sources) == sources

  def valid_operation_sources?(_sources, _scope), do: false

  @operation_checkpoint_version "provider-operation-checkpoint/v1"
  @plan_fields ~w(covers source_refs versions omissions summary retained_items scope history_target)
  @required_plan_fields ~w(covers source_refs versions omissions summary)

  def operation_checkpoint_version, do: @operation_checkpoint_version

  def valid_operation_checkpoint?(
        %{"version" => @operation_checkpoint_version, "goal_version" => version, "plan" => plan} =
          checkpoint
      ) do
    is_integer(version) and version > 0 and is_map(plan) and
      Enum.sort(Map.keys(checkpoint)) == ~w(goal_version plan version) and
      Enum.all?(Map.keys(plan), &(&1 in @plan_fields)) and
      Enum.all?(@required_plan_fields, &Map.has_key?(plan, &1))
  end

  def valid_operation_checkpoint?(_checkpoint), do: false

  # Raw terminal bytes have one temporary owner. Replayed final events cannot recreate
  # a capsule that the canonical commit already consumed.
  def operation_output(%{operation_checkpoint: nil}, _output), do: :unchanged

  def operation_output(%{operation_checkpoint: checkpoint}, %{status: :ok, content: content})
      when is_map(checkpoint) and is_map(content) do
    text = field(content, :text)

    if is_binary(text) and String.valid?(text) and byte_size(text) <= 131_072 and
         field(content, :tool_calls) in [nil, []] do
      case Map.get(checkpoint, "response_text") do
        nil -> {:update, %{operation_checkpoint: Map.put(checkpoint, "response_text", text)}}
        ^text -> :unchanged
        _ -> {:error, :provider_operation_response_conflict}
      end
    else
      :unchanged
    end
  end

  def operation_output(_record, _output), do: :unchanged

  @doc "Recovery never revives a cancelled direction or takes another active run's output."
  def recoverable_operation?(record, origin, target) when is_map(origin) and is_map(target) do
    checkpoint = record.operation_checkpoint
    target_id = field(target, :run_id) || field(target, :id)
    target_version = field(target, :goal_version) || field(field(target, :goal), :version)

    is_map(checkpoint) and checkpoint["version"] == @operation_checkpoint_version and
      operation_scope_matches?(record, origin, target) and
      operation_direction_matches?(checkpoint, origin, target_id, target_version) and
      operation_states_allow?(origin, target, target_id)
  end

  def recoverable_operation?(_record, _origin, _target), do: false

  defp operation_scope_matches?(record, origin, target) do
    origin.id == record.agent_run_id and origin.parent_turn_ref == record.parent_turn_ref and
      Enum.all?([:workspace_id, :work_id, :session_id], fn key ->
        field(record, key) == field(origin, key) and field(record, key) == field(target, key)
      end)
  end

  defp operation_direction_matches?(checkpoint, origin, target_id, target_version) do
    origin.goal_version == checkpoint["goal_version"] and
      (origin.id != target_id or target_version == origin.goal_version)
  end

  defp operation_states_allow?(origin, target, target_id) do
    origin.status not in ~w(cancelled cancelling paused pausing) and
      to_string(field(target, :status)) not in ~w(cancelled cancelling paused pausing) and
      (origin.id == target_id or origin.status in ~w(completed failed))
  end

  # Called only inside the canonical snapshot transaction. Once consumed, historical
  # snapshots remain valid even when their originating run later changes direction.
  def consume_operation(
        %{operation_checkpoint: nil},
        _origin,
        _target,
        _persisted_target,
        _block
      ),
      do: :unchanged

  def consume_operation(record, origin, target, persisted_target, block) when is_map(record) do
    if operation_payload_matches?(record, block) and
         current_receiving_target?(persisted_target, target) and
         recoverable_operation?(record, origin, target) and
         recoverable_operation?(record, origin, persisted_target),
       do: {:update, %{operation_checkpoint: nil}},
       else: {:error, :provider_operation_checkpoint_mismatch}
  end

  def consume_operation(_record, _origin, _target, _persisted_target, _block),
    do: {:error, :provider_operation_checkpoint_missing}

  defp operation_payload_matches?(record, block) do
    checkpoint = record.operation_checkpoint
    discussion = field(block, :discussion)
    plan = if is_map(checkpoint), do: checkpoint["plan"], else: nil

    is_map(discussion) and is_map(plan) and
      record.id == field(discussion, :provider_run_ref) and
      record.provider_call_ref == field(discussion, :provider_call_ref) and
      checkpoint["response_text"] == field(discussion, :response_text) and
      Enum.all?(@required_plan_fields, fn key ->
        NovelCommon.RequestIR.json_value(field(block, String.to_existing_atom(key))) == plan[key]
      end)
  end

  defp current_receiving_target?(persisted, target) when is_map(persisted) do
    Enum.all?(
      [:id, :workspace_id, :work_id, :session_id, :parent_turn_ref, :goal_version],
      fn key ->
        field(persisted, key) == field(target, key)
      end
    )
  end

  defp current_receiving_target?(_persisted, _target), do: false

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_map, _key), do: nil

  @spec event(map() | nil, map()) :: decision()
  def event(nil, attrs), do: {:insert, attrs}

  def event(existing, attrs) do
    with :ok <- identity(existing, attrs, @event_identity_fields, :provider_event),
         :ok <- attribution(existing, attrs, @event_attribution_fields, :provider_event),
         :ok <- event_content(existing, attrs) do
      updates = fill_missing(@event_attribution_fields, existing, attrs)
      if map_size(updates) == 0, do: :unchanged, else: {:update, updates}
    end
  end

  @spec output(map() | nil, map()) :: decision()
  def output(nil, attrs), do: {:insert, attrs}

  def output(existing, attrs) do
    with :ok <- identity(existing, attrs, @output_identity_fields, :provider_output),
         :ok <- attribution(existing, attrs, @output_attribution_fields, :provider_output),
         :ok <- output_content(existing, attrs) do
      updates = fill_missing(@output_attribution_fields, existing, attrs)
      if map_size(updates) == 0, do: :unchanged, else: {:update, updates}
    end
  end

  defp operation_record?(%{owner_refs: refs}) when is_map(refs) do
    Enum.any?(
      [:operation, :coverage_key, :discussion_source_keys],
      &(Map.has_key?(refs, &1) or Map.has_key?(refs, to_string(&1)))
    )
  end

  defp operation_record?(_record), do: false

  defp present_ref?(value), do: is_binary(value) and String.trim(value) != ""

  defp identity(existing, attrs, fields, kind) do
    Enum.reduce_while(fields, :ok, fn field, :ok ->
      current = Map.get(existing, field)
      incoming = Map.get(attrs, field)

      if blank?(incoming) or blank?(current) or current == incoming do
        {:cont, :ok}
      else
        {:halt, {:error, identity_error(kind, field)}}
      end
    end)
  end

  defp attribution(existing, attrs, fields, kind) do
    identity(existing, attrs, fields, kind)
    |> case do
      :ok ->
        :ok

      {:error, {_prefix, field}} ->
        {:error, attribution_error(kind, field)}
    end
  end

  defp run_status(current, incoming) do
    current = normalize_status(current)
    incoming = normalize_status(incoming)

    cond do
      is_nil(incoming) -> {:ok, current}
      is_nil(current) -> {:ok, incoming}
      current == incoming -> {:ok, current}
      terminal?(current) -> terminal_transition(current, incoming)
      terminal?(incoming) -> {:ok, incoming}
      true -> advance(current, incoming)
    end
  end

  defp terminal_transition(current, incoming) do
    if terminal?(incoming) do
      {:error, {:provider_run_terminal_conflict, current, incoming}}
    else
      {:ok, current}
    end
  end

  defp advance(current, incoming) do
    if rank(incoming) > rank(current), do: {:ok, incoming}, else: {:ok, current}
  end

  defp event_content(existing, attrs) do
    if same_values?(existing, attrs, @event_content_fields) do
      :ok
    else
      {:error, {:provider_event_content_conflict, Map.get(attrs, :id)}}
    end
  end

  defp output_content(existing, attrs) do
    if same_values?(existing, attrs, @output_content_fields) do
      :ok
    else
      {:error, {:provider_output_content_conflict, Map.get(attrs, :provider_run_id)}}
    end
  end

  defp same_values?(existing, attrs, fields) do
    Enum.all?(fields, fn field ->
      Map.get(existing, field) == Map.get(attrs, field)
    end)
  end

  defp fill_missing(fields, existing, attrs) do
    Enum.reduce(fields, %{}, fn field, updates ->
      current = Map.get(existing, field)
      incoming = Map.get(attrs, field)

      if blank?(current) and not blank?(incoming) do
        Map.put(updates, field, incoming)
      else
        updates
      end
    end)
  end

  defp put_status(updates, current, merged) when current == merged, do: updates
  defp put_status(updates, _current, merged), do: Map.put(updates, :status, merged)

  defp identity_error(:provider_run, field), do: {:provider_run_identity_conflict, field}
  defp identity_error(:provider_event, field), do: {:provider_event_identity_conflict, field}

  defp identity_error(:provider_output, field),
    do: {:provider_output_identity_conflict, field}

  defp attribution_error(:provider_run, field),
    do: {:provider_run_attribution_conflict, field}

  defp attribution_error(:provider_event, field),
    do: {:provider_event_attribution_conflict, field}

  defp attribution_error(:provider_output, field),
    do: {:provider_output_attribution_conflict, field}

  defp normalize_status(nil), do: nil
  defp normalize_status(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_status(value) when is_binary(value), do: value
  defp normalize_status(_value), do: nil

  defp terminal?(status), do: status in @terminal_statuses
  defp rank(status), do: Map.get(@non_terminal_rank, status, -1)

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(_value), do: false
end
