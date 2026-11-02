defmodule NovelPersistence.ProviderFactMerge do
  @moduledoc """
  `ProviderRunLog` 唯一事实边界的纯归并判据。

  将 incoming run/event/output 与已提交行比较：同次调用身份与归属不可换绑，
  生命周期只前进，终态不能互换成另一种终态，event/output 内容冲突拒绝。
  调用方在同一个数据库事务内应用判据；本模块不做任何 I/O，也不按到达时间
  或 updated_at 决定覆盖。
  """

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
