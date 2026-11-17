defmodule NovelPersistence.AuthoringSessionLog do
  @moduledoc """
  会话级 canonical 创作历史的唯一持久化边界（ADR-0035 / B81 CP1）。

  职责（单一）：把一次 run 提交中的 canonical 事实按会话**追加**为消息流，并维护
  该 run 的执行段头；读取时按 run 重建执行段。事务边界由调用方
  （`NovelPersistence.AgentRunLog.commit_snapshot/2`）持有：
  失败只返回 error，由调用方回滚整个 run 提交，保证「run 状态 / 消息 / 段头 /
  durable checkpoint / Interaction」同生共死。读取复用调用方事务，独立读取时开启同一读快照。

  ## 语义

  - **append-only**：消息只追加，既有前缀必须逐条相等；回退（新列表比已存短）
    拒绝，不猜测、不修补。
  - **幂等**：同一 run 用同一完整消息列表重复提交不产生重复行。
  - **身份不可错绑**：段头 run 身份（run_id/workspace_id/work_id/session_id/
    parent_turn_ref）必须与 run 行一致；已有段头身份不可被新提交改写。
  - **未知版本 fail-closed**：段头版本不是当前 `segment_format_version/0` 时拒绝。
  - **顺序唯一**：会话内 `sequence`、run 内 `run_sequence` 各自唯一（DB 唯一索引）；
    同一会话并发 run 由 SQLite 单写者 + immediate 事务串行化。

  ## 格式

  - 消息行版本：`authoring-session-message/v1`；`message` 列是 Request IR 消息的
    JSON 形状（由 application 写入边界完成 JSON 归一化与完整 IR 校验）。
  - 段头版本：`authoring-run-segment/v1`；`header` 是
    `%{"version" => ..., "run" => map, "system" => map, "tools" => [map],
    "projection" => map, "base_refs" => [map], "observation_refs" => [map],
    "used_refs" => [map], "call_ids" => [String.t()]}`。
  """

  import Ecto.Query

  alias NovelPersistence.AuthoringSessionIntegrity, as: Integrity
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{AgentRunRecord, AuthoringRunSegment, AuthoringSessionMessage}

  # durable 执行 checkpoint 的格式版本（写入与恢复校验共用）。
  @task_checkpoint_version 3
  @message_row_fields [
    :sequence,
    :run_id,
    :run_sequence,
    :role,
    :message,
    :format_version,
    :workspace_id,
    :work_id,
    :session_id
  ]

  @type segment_state :: %{
          run_id: String.t(),
          workspace_id: String.t(),
          work_id: String.t(),
          session_id: String.t(),
          message_count: non_neg_integer(),
          first_sequence: pos_integer() | nil,
          last_sequence: pos_integer() | nil
        }

  @type segment_input :: %{header: map(), messages: [map()]}

  @spec segment_format_version() :: String.t()
  defdelegate segment_format_version(), to: Integrity

  @doc "durable 执行 checkpoint 的格式版本唯一真源（写入与恢复校验共用）。"
  @spec task_checkpoint_version() :: pos_integer()
  def task_checkpoint_version, do: @task_checkpoint_version

  @doc """
  段头携带的 transcript data 键（atom 形式；段头 JSON 键是其 `Atom.to_string/1`）。

  application 的写入/读取边界消费本函数构造与解析段头，避免跨层重复定义键集合；
  新增 data 键时只改本模块的键契约。
  """
  @spec header_data_keys() :: [atom()]
  defdelegate header_data_keys(), to: Integrity

  @doc """
  在调用方事务内追加一次 run 提交的 canonical 事实。

  `run_record` 是即将 upsert 的 `agent_runs` 行 attrs（含 id/workspace_id/
  work_id/session_id/parent_turn_ref）；`segment` 为 `nil` 表示该提交没有 canonical
  历史（零调用/尚无会话），此时不写任何行。成功返回该 run 的执行段状态，供
  durable checkpoint 的段引用校验使用。
  """
  @spec append_run(map(), segment_input() | nil) ::
          {:ok, segment_state() | nil} | {:error, term()}
  def append_run(_run_record, nil), do: {:ok, nil}

  def append_run(run_record, %{header: header, messages: messages}) do
    run_id = run_id!(run_record)

    with :ok <- Integrity.validate_run(run_record),
         :ok <- Integrity.validate_header(header, run_record),
         :ok <- Integrity.validate_messages(messages),
         {:ok, stored} <- stored_run_messages(run_id),
         :ok <- validate_existing_segment(run_id, run_record),
         :ok <- validate_prefix(stored, messages),
         {:ok, state} <- append_messages(run_id, run_record, stored, messages),
         :ok <- upsert_segment(run_id, run_record, header, state) do
      {:ok, state}
    end
  end

  def append_run(_run_record, _segment), do: {:error, :authoring_segment_shape_invalid}

  @doc "在调用方的写事务内，以当前会话校验实际待追加的执行段。"
  def validate_write!(_run_record, nil, _validator), do: :ok
  def validate_write!(_run_record, _segment, nil), do: :ok

  def validate_write!(run_record, segment, validator) when is_function(validator, 2) do
    case validator.(run_record, segment) do
      :ok -> :ok
      {:error, reason} -> Repo.rollback(reason)
      _other -> Repo.rollback(:invalid_authoring_segment_validation)
    end
  end

  @doc "按同一快照校验并读取 run 执行段；孤立消息或坏段不得伪装成没有历史。"
  @spec fetch_run_segment(String.t()) :: {:ok, segment_input() | nil} | {:error, term()}
  def fetch_run_segment(run_id) when is_binary(run_id) do
    read_snapshot(fn ->
      segment = Repo.get(AuthoringRunSegment, run_id)

      rows =
        from(m in AuthoringSessionMessage,
          where: m.run_id == ^run_id,
          order_by: m.run_sequence
        )
        |> message_rows()

      assemble_segment(segment, rows)
    end)
  end

  @doc "同一快照绑定消息/段/真实 run 的身份、格式与顺序，再返回已验证行及 refs。"
  @spec fetch_session(String.t()) :: {:ok, %{rows: [map()], refs: map()}} | {:error, term()}
  def fetch_session(session_id) when is_binary(session_id) do
    read_snapshot(fn ->
      segments =
        Repo.all(
          from(s in AuthoringRunSegment,
            where: s.session_id == ^session_id,
            order_by: s.first_sequence
          )
        )

      rows =
        from(m in AuthoringSessionMessage,
          where: m.session_id == ^session_id,
          order_by: m.sequence
        )
        |> message_rows()

      runs = read_runs(segments)

      with :ok <- Integrity.validate_snapshot(:session, rows, segments, runs) do
        {:ok, %{rows: Enum.map(rows, &with_run_metadata(&1, runs)), refs: session_refs(segments)}}
      end
    end)
  end

  defp read_snapshot(fun) do
    if Repo.in_transaction?(), do: fun.(), else: Repo.transact(fun)
  end

  defp message_rows(query), do: Repo.all(from(m in query, select: map(m, @message_row_fields)))

  defp read_runs(segments) do
    ids = Enum.map(segments, & &1.run_id)

    from(r in AgentRunRecord,
      where: r.id in ^ids,
      select: map(r, [:id, :workspace_id, :work_id, :session_id, :parent_turn_ref, :status])
    )
    |> Repo.all()
    |> Map.new(&{&1.id, &1})
  end

  defp with_run_metadata(row, runs) do
    run = Map.fetch!(runs, row.run_id)
    Map.merge(row, %{run_status: run.status, parent_turn_ref: run.parent_turn_ref})
  end

  defp session_refs(segments) do
    Enum.reduce(segments, Map.new(Integrity.ref_keys(), &{&1, []}), fn segment, acc ->
      Map.new(acc, fn {key, refs} ->
        {key, refs ++ Map.fetch!(segment.header, Atom.to_string(key))}
      end)
    end)
  end

  @doc "run 是否已有执行段（durable checkpoint 段引用校验用）。"
  @spec segment_present?(String.t()) :: boolean()
  def segment_present?(run_id) when is_binary(run_id), do: Repo.exists?(segment_query(run_id))

  # ── 追加 ────────────────────────────────────────────────────────────────

  # 已存消息（message 列）与已存的会话序号，供段状态复用。
  defp stored_run_messages(run_id) do
    rows =
      AuthoringSessionMessage
      |> where([m], m.run_id == ^run_id)
      |> order_by([m], asc: m.run_sequence)
      |> select([m], {m.message, m.sequence})
      |> Repo.all()

    {:ok, rows}
  end

  defp validate_existing_segment(run_id, run_record) do
    case Repo.get(AuthoringRunSegment, run_id) do
      nil -> :ok
      %AuthoringRunSegment{} = segment -> Integrity.validate_segment_identity(segment, run_record)
    end
  end

  defp validate_prefix(stored_rows, messages) do
    stored = Enum.map(stored_rows, &elem(&1, 0))

    cond do
      length(stored) > length(messages) ->
        {:error, :authoring_history_rollback_rejected}

      Enum.take(messages, length(stored)) != stored ->
        {:error, :authoring_history_prefix_mismatch}

      true ->
        :ok
    end
  end

  defp append_messages(run_id, run_record, stored_rows, messages) do
    stored_count = length(stored_rows)
    new_messages = Enum.drop(messages, stored_count)

    if new_messages == [] do
      {first_sequence, last_sequence} = stored_bounds(stored_rows)

      {:ok,
       %{
         run_id: run_id,
         workspace_id: field(run_record, :workspace_id),
         work_id: field(run_record, :work_id),
         session_id: field(run_record, :session_id),
         message_count: stored_count,
         first_sequence: first_sequence,
         last_sequence: last_sequence
       }}
    else
      append_new_messages(run_id, run_record, stored_rows, stored_count, new_messages)
    end
  end

  defp stored_bounds([]), do: {nil, nil}
  defp stored_bounds([{_message, first} | _] = rows), do: {first, rows |> List.last() |> elem(1)}

  defp append_new_messages(run_id, run_record, stored_rows, stored_count, new_messages) do
    next_sequence = next_session_sequence(field(run_record, :session_id))

    with :ok <- insert_new_messages(run_id, run_record, new_messages, stored_count, next_sequence) do
      {first_stored, _last_stored} = stored_bounds(stored_rows)

      {:ok,
       %{
         run_id: run_id,
         workspace_id: field(run_record, :workspace_id),
         work_id: field(run_record, :work_id),
         session_id: field(run_record, :session_id),
         message_count: stored_count + length(new_messages),
         first_sequence: first_stored || next_sequence,
         last_sequence: next_sequence + length(new_messages) - 1
       }}
    end
  end

  defp insert_new_messages(run_id, run_record, new_messages, stored_count, next_sequence) do
    base = %{
      workspace_id: field(run_record, :workspace_id),
      work_id: field(run_record, :work_id),
      session_id: field(run_record, :session_id),
      run_id: run_id,
      format_version: Integrity.message_format_version()
    }

    new_messages
    |> Enum.with_index(stored_count + 1)
    |> Enum.reduce_while(:ok, fn {message, run_sequence}, :ok ->
      attrs =
        Map.merge(base, %{
          sequence: next_sequence + (run_sequence - stored_count - 1),
          run_sequence: run_sequence,
          role: message["role"],
          message: message
        })

      case %AuthoringSessionMessage{}
           |> AuthoringSessionMessage.changeset(attrs)
           |> Repo.insert() do
        {:ok, _row} -> {:cont, :ok}
        {:error, _changeset} -> {:halt, {:error, :authoring_message_write_failed}}
      end
    end)
  end

  # 会话内全局序号：从当前会话最大 sequence 之后继续（事务内调用，写锁已持有）。
  defp next_session_sequence(session_id) do
    AuthoringSessionMessage
    |> where([m], m.session_id == ^session_id)
    |> select([m], max(m.sequence))
    |> Repo.one()
    |> case do
      nil -> 1
      max_sequence when is_integer(max_sequence) -> max_sequence + 1
    end
  end

  defp upsert_segment(run_id, run_record, header, state) do
    attrs = %{
      run_id: run_id,
      workspace_id: field(run_record, :workspace_id),
      work_id: field(run_record, :work_id),
      session_id: field(run_record, :session_id),
      parent_turn_ref: field(run_record, :parent_turn_ref),
      header: header,
      message_count: state.message_count,
      first_sequence: state.first_sequence,
      last_sequence: state.last_sequence,
      format_version: segment_format_version()
    }

    case Repo.get(AuthoringRunSegment, attrs.run_id) do
      nil ->
        %AuthoringRunSegment{}
        |> AuthoringRunSegment.changeset(attrs)
        |> Repo.insert()
        |> unwrap(:authoring_segment_write_failed)

      %AuthoringRunSegment{} = segment ->
        segment
        |> AuthoringRunSegment.changeset(attrs)
        |> Repo.update()
        |> unwrap(:authoring_segment_write_failed)
    end
  end

  # ── 查询辅助 ────────────────────────────────────────────────────────────

  defp assemble_segment(nil, []), do: {:ok, nil}

  defp assemble_segment(segment, rows) do
    segments = List.wrap(segment)
    runs = read_runs(segments)

    with :ok <- Integrity.validate_snapshot(:run, rows, segments, runs) do
      {:ok, %{header: segment.header, messages: Enum.map(rows, & &1.message)}}
    end
  end

  defp segment_query(run_id), do: from(s in AuthoringRunSegment, where: s.run_id == ^run_id)

  defp run_id!(run_record), do: field(run_record, :id)

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, to_string(key))
  end

  defp field(_map, _key), do: nil

  defp unwrap({:ok, value}, _reason), do: {:ok, value}
  defp unwrap({:error, _changeset}, reason), do: {:error, reason}
end
