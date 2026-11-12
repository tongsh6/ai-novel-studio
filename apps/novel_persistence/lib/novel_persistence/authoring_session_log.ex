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

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{AuthoringRunSegment, AuthoringSessionMessage}

  @message_format_version "authoring-session-message/v1"
  @segment_format_version "authoring-run-segment/v1"

  # durable 执行 checkpoint 的格式版本（`checkpoint_data["agent_run"]["checkpoint_version"]`）。
  # 写入侧（AgentRunPersistence）与读取校验侧（AuthoringCheckpoint）共同消费本契约，
  # 不再各自持有常量——任一侧独立升版会让所有恢复静默失败（checkpoint_version_mismatch）。
  @task_checkpoint_version 3

  # 段头 run 身份：{header 内的 run 字段, run 行字段}。与旧 run 级 checkpoint 的
  # 不可变身份一致（B71/VS-00L §16.8），只是落点从 run 列改为会话段头。
  @identity_fields [
    {"run_id", :id},
    {"workspace_id", :workspace_id},
    {"work_id", :work_id},
    {"session_id", :session_id},
    {"parent_turn_ref", :parent_turn_ref}
  ]

  # 段头 data 键 = header 携带的 transcript data 键（不含 messages；messages 是独立
  # 列）。这是存储格式契约的单一来源：application 写入/读取边界消费
  # `header_data_keys/0`，不再各自重复键列表（DRY / OCP：新增键只改这里）。
  @header_maps ~w(run system projection)a
  @ref_keys ~w(base_refs observation_refs used_refs)a
  @header_lists ~w(tools call_ids)a ++ @ref_keys
  @header_data_keys @header_maps ++ @header_lists

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
  def segment_format_version, do: @segment_format_version

  @doc "durable 执行 checkpoint 的格式版本唯一真源（写入与恢复校验共用）。"
  @spec task_checkpoint_version() :: pos_integer()
  def task_checkpoint_version, do: @task_checkpoint_version

  @doc """
  段头携带的 transcript data 键（atom 形式；段头 JSON 键是其 `Atom.to_string/1`）。

  application 的写入/读取边界消费本函数构造与解析段头，避免跨层重复定义键集合；
  新增 data 键时只改本模块的键契约。
  """
  @spec header_data_keys() :: [atom()]
  def header_data_keys, do: @header_data_keys

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

    with :ok <- validate_run_record(run_record),
         :ok <- validate_header(header, run_record),
         :ok <- validate_messages(messages),
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

  @doc "按 run 读取执行段（段头 + 该 run 的消息，按 run_sequence 升序）。"
  @spec fetch_run_segment(String.t()) :: {:ok, segment_input() | nil} | {:error, term()}
  def fetch_run_segment(run_id) when is_binary(run_id) do
    read_snapshot(fn ->
      case Repo.get(AuthoringRunSegment, run_id) do
        nil -> {:ok, nil}
        segment -> assemble_segment(run_id, segment)
      end
    end)
  end

  @doc "按同一事务快照读取会话有序消息及 refs，拒绝未知段头和行数不一致。"
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
        Repo.all(
          from(m in AuthoringSessionMessage,
            where: m.session_id == ^session_id,
            order_by: m.sequence,
            select: map(m, [:sequence, :run_id, :run_sequence, :role, :message])
          )
        )

      with {:ok, refs} <- session_refs(segments),
           :ok <- check_segment_counts(rows, segments) do
        {:ok, %{rows: rows, refs: refs}}
      end
    end)
  end

  defp read_snapshot(fun) do
    if Repo.in_transaction?(), do: fun.(), else: Repo.transact(fun)
  end

  defp session_refs(segments) do
    Enum.reduce_while(segments, {:ok, Map.new(@ref_keys, &{&1, []})}, fn segment, {:ok, acc} ->
      case validate_header_format(segment.header) do
        :ok ->
          {:cont,
           {:ok,
            Map.new(acc, fn {key, refs} ->
              {key, refs ++ Map.fetch!(segment.header, Atom.to_string(key))}
            end)}}

        {:error, _reason} = error ->
          {:halt, error}
      end
    end)
  end

  defp check_segment_counts(rows, segments) do
    if Enum.frequencies_by(rows, & &1.run_id) == Map.new(segments, &{&1.run_id, &1.message_count}),
      do: :ok,
      else: {:error, :authoring_segment_inconsistent}
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
      %AuthoringRunSegment{} = segment -> validate_segment_identity(segment, run_record)
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
      format_version: @message_format_version
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
      format_version: @segment_format_version
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

  # ── 校验 ────────────────────────────────────────────────────────────────

  defp validate_run_record(run_record) when is_map(run_record) do
    if missing_identity_fields(run_record) == [] do
      :ok
    else
      {:error, :authoring_run_identity_missing}
    end
  end

  defp validate_run_record(_run_record), do: {:error, :authoring_run_identity_missing}

  defp validate_header(header, run_record) when is_map(header) do
    with :ok <- validate_header_format(header) do
      validate_header_identity(header, run_record)
    end
  end

  defp validate_header(_header, _run_record), do: {:error, :authoring_segment_shape_invalid}

  defp validate_header_format(header) do
    with :ok <- validate_header_version(header), do: validate_header_shape(header)
  end

  defp validate_header_version(header) when is_map(header) do
    case Map.get(header, "version") do
      @segment_format_version -> :ok
      _other -> {:error, :authoring_segment_version_unsupported}
    end
  end

  defp validate_header_version(_header), do: {:error, :authoring_segment_shape_invalid}

  defp validate_header_shape(header) when is_map(header) do
    valid? =
      Enum.all?(@header_maps, &is_map(Map.get(header, Atom.to_string(&1)))) and
        Enum.all?(@header_lists, &is_list(Map.get(header, Atom.to_string(&1))))

    if valid?, do: :ok, else: {:error, :authoring_segment_shape_invalid}
  end

  defp validate_header_shape(_header), do: {:error, :authoring_segment_shape_invalid}

  defp validate_header_identity(header, run_record) do
    run = Map.get(header, "run", %{})

    mismatched =
      Enum.filter(@identity_fields, fn {header_field, row_field} ->
        Map.get(run, header_field) != field(run_record, row_field)
      end)

    if mismatched == [], do: :ok, else: {:error, :authoring_segment_identity_mismatch}
  end

  defp validate_messages([]), do: {:error, :authoring_segment_empty_history}

  defp validate_messages(messages) when is_list(messages) do
    if Enum.all?(messages, &valid_message?/1) do
      :ok
    else
      {:error, :authoring_message_shape_invalid}
    end
  end

  defp validate_messages(_messages), do: {:error, :authoring_message_shape_invalid}

  defp valid_message?(message) when is_map(message) do
    case Map.get(message, "role") do
      role when is_binary(role) -> String.trim(role) != ""
      _other -> false
    end
  end

  defp valid_message?(_message), do: false

  # 段行身份列与 header 同名字段（run_id/workspace_id/work_id/session_id/
  # parent_turn_ref），但 run 行的主键字段是 :id，故列映射单独给出，避免拿
  # :id 去段行上取值导致恒错绑。
  @segment_row_columns %{
    "run_id" => :run_id,
    "workspace_id" => :workspace_id,
    "work_id" => :work_id,
    "session_id" => :session_id,
    "parent_turn_ref" => :parent_turn_ref
  }

  defp validate_segment_identity(%AuthoringRunSegment{} = segment, run_record) do
    mismatched =
      Enum.filter(@identity_fields, fn {header_field, row_field} ->
        Map.get(segment, Map.fetch!(@segment_row_columns, header_field)) !=
          field(run_record, row_field)
      end)

    if mismatched == [], do: :ok, else: {:error, :authoring_segment_identity_mismatch}
  end

  # ── 查询辅助 ────────────────────────────────────────────────────────────

  defp assemble_segment(run_id, %AuthoringRunSegment{} = segment) do
    with :ok <- validate_header_format(segment.header),
         {:ok, rows} <- stored_run_messages(run_id) do
      if length(rows) == segment.message_count,
        do: {:ok, %{header: segment.header, messages: Enum.map(rows, &elem(&1, 0))}},
        else: {:error, :authoring_segment_inconsistent}
    end
  end

  defp segment_query(run_id), do: from(s in AuthoringRunSegment, where: s.run_id == ^run_id)

  defp missing_identity_fields(record) do
    Enum.filter(@identity_fields, fn {_header_field, row_field} ->
      record |> field(row_field) |> blank?()
    end)
  end

  defp run_id!(run_record), do: field(run_record, :id)

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, to_string(key))
  end

  defp field(_map, _key), do: nil

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false

  defp unwrap({:ok, value}, _reason), do: {:ok, value}
  defp unwrap({:error, _changeset}, reason), do: {:error, reason}
end
