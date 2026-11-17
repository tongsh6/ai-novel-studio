defmodule NovelPersistence.AuthoringSessionIntegrity do
  @moduledoc """
  会话 canonical 存储的纯完整性规则（ADR-0035 / B87 R03）。

  同一份身份与格式契约供 AuthoringSessionLog 的写入、会话读取和执行段恢复消费。
  快照校验绑定真实 run、段头和消息行，验证序号及范围；不读取数据库、不推定
  运行完成，也不解释 Request IR 的业务内容或压缩语义。
  """

  alias NovelPersistence.Schemas.AgentRunRecord

  @message_format_version "authoring-session-message/v1"
  @segment_format_version "authoring-run-segment/v1"
  @identity_fields [
    {"run_id", :run_id, :id},
    {"workspace_id", :workspace_id, :workspace_id},
    {"work_id", :work_id, :work_id},
    {"session_id", :session_id, :session_id},
    {"parent_turn_ref", :parent_turn_ref, :parent_turn_ref}
  ]
  @message_identity_fields Enum.reject(@identity_fields, &(elem(&1, 1) == :parent_turn_ref))
  @header_maps ~w(run system projection)a
  @ref_keys ~w(base_refs observation_refs used_refs)a
  @header_lists ~w(tools call_ids)a ++ @ref_keys

  def message_format_version, do: @message_format_version
  def segment_format_version, do: @segment_format_version
  def header_data_keys, do: @header_maps ++ @header_lists
  def ref_keys, do: @ref_keys

  def validate_run(record) when is_map(record) do
    if Enum.all?(@identity_fields, fn {_, _, key} -> nonblank?(field(record, key)) end),
      do: :ok,
      else: {:error, :authoring_run_identity_missing}
  end

  def validate_run(_record), do: {:error, :authoring_run_identity_missing}

  def validate_header(header, record) when is_map(header) do
    with :ok <- validate_header_format(header),
         true <-
           Enum.all?(@identity_fields, fn {key, _, row_key} ->
             Map.get(header["run"], key) == field(record, row_key)
           end) do
      :ok
    else
      false -> {:error, :authoring_segment_identity_mismatch}
      error -> error
    end
  end

  def validate_header(_header, _record), do: {:error, :authoring_segment_shape_invalid}

  @doc "durable checkpoint 的纯 header 规则；状态更新可省略，新增 header 只接受本 run 的 v3。"
  def validate_checkpoint_header(nil, _record), do: :ok

  def validate_checkpoint_header(data, record) when is_map(data) do
    header = field(data, :agent_run)

    cond do
      not is_map(header) ->
        {:error, :checkpoint_header_missing}

      field(header, :checkpoint_version) != 3 ->
        {:error, :checkpoint_version_not_writable}

      field(header, :run_id) != field(record, :id) ->
        {:error, :checkpoint_run_mismatch}

      true ->
        :ok
    end
  end

  def validate_checkpoint_header(_data, _record), do: {:error, :invalid_checkpoint}

  def validate_segment_identity(segment, record) do
    if Enum.all?(@identity_fields, fn {_, key, row_key} ->
         Map.get(segment, key) == field(record, row_key)
       end),
       do: :ok,
       else: {:error, :authoring_segment_identity_mismatch}
  end

  def validate_messages([]), do: {:error, :authoring_segment_empty_history}

  def validate_messages(messages) when is_list(messages) do
    if Enum.all?(messages, &valid_message?/1),
      do: :ok,
      else: {:error, :authoring_message_shape_invalid}
  end

  def validate_messages(_messages), do: {:error, :authoring_message_shape_invalid}

  @doc """
  核对一次实际读快照；完整会话序号须从 1 连续，单段会话序号允许被其它 run 交错。
  两种读取都要求每段 run_sequence 从 1 连续、段首尾精确且消息身份/版本真实。
  """
  def validate_snapshot(scope, rows, segments, runs) do
    grouped = Enum.group_by(rows, & &1.run_id)

    with :ok <- validate_counts(grouped, segments),
         :ok <- validate_session_sequence(scope, rows),
         :ok <- validate_session_identity(scope, segments) do
      validate_segments(segments, grouped, runs)
    end
  end

  defp validate_segments(segments, grouped, runs) do
    Enum.reduce_while(segments, :ok, fn segment, :ok ->
      case validate_segment(segment, Map.fetch!(grouped, segment.run_id), runs) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  defp validate_header_format(header) when is_map(header) do
    cond do
      header["version"] != @segment_format_version ->
        {:error, :authoring_segment_version_unsupported}

      Enum.all?(@header_maps, &is_map(Map.get(header, Atom.to_string(&1)))) and
          Enum.all?(@header_lists, &is_list(Map.get(header, Atom.to_string(&1)))) ->
        :ok

      true ->
        {:error, :authoring_segment_shape_invalid}
    end
  end

  defp validate_header_format(_header), do: {:error, :authoring_segment_shape_invalid}

  defp validate_counts(grouped, segments) do
    counts = Map.new(grouped, fn {id, rows} -> {id, length(rows)} end)

    if counts == Map.new(segments, &{&1.run_id, &1.message_count}) and
         Enum.all?(segments, &(&1.message_count > 0)),
       do: :ok,
       else: {:error, :authoring_segment_inconsistent}
  end

  defp validate_session_sequence(:run, _rows), do: :ok

  defp validate_session_sequence(:session, rows) do
    if Enum.all?(Enum.with_index(rows, 1), fn {row, index} -> row.sequence == index end),
      do: :ok,
      else: {:error, :authoring_message_sequence_invalid}
  end

  defp validate_session_identity(:run, _segments), do: :ok

  defp validate_session_identity(:session, segments) do
    identities = Enum.uniq_by(segments, &{&1.workspace_id, &1.work_id, &1.session_id})

    if length(identities) <= 1,
      do: :ok,
      else: {:error, :authoring_session_identity_mismatch}
  end

  defp validate_segment(segment, rows, runs) do
    run = Map.get(runs, segment.run_id)

    with :ok <- validate_run(run),
         :ok <- validate_run_status(run),
         :ok <- validate_segment_version(segment),
         :ok <- validate_header(segment.header, run),
         :ok <- validate_segment_identity(segment, run),
         :ok <- validate_segment_sequence(segment, rows) do
      validate_rows(rows, run)
    end
  end

  defp validate_rows(rows, run) do
    Enum.reduce_while(rows, :ok, fn row, :ok ->
      case validate_row(row, run) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  defp validate_run_status(run) do
    if AgentRunRecord.valid_status?(field(run, :status)),
      do: :ok,
      else: {:error, :authoring_run_status_invalid}
  end

  defp validate_segment_version(%{format_version: @segment_format_version}), do: :ok
  defp validate_segment_version(_), do: {:error, :authoring_segment_version_unsupported}

  defp validate_segment_sequence(segment, rows) do
    sequence = Enum.map(rows, & &1.sequence)

    cond do
      not Enum.all?(Enum.with_index(rows, 1), fn {row, index} -> row.run_sequence == index end) ->
        {:error, :authoring_message_sequence_invalid}

      not Enum.all?(sequence, &(is_integer(&1) and &1 > 0)) or
          sequence != Enum.sort(Enum.uniq(sequence)) ->
        {:error, :authoring_message_sequence_invalid}

      segment.first_sequence != List.first(sequence) or
          segment.last_sequence != List.last(sequence) ->
        {:error, :authoring_segment_inconsistent}

      true ->
        :ok
    end
  end

  defp validate_row(row, run) do
    cond do
      row.format_version != @message_format_version ->
        {:error, :authoring_message_version_unsupported}

      not Enum.all?(@message_identity_fields, fn {_, key, run_key} ->
        Map.get(row, key) == field(run, run_key)
      end) ->
        {:error, :authoring_message_identity_mismatch}

      not valid_message?(row.message) or row.role != row.message["role"] ->
        {:error, :authoring_message_shape_invalid}

      true ->
        :ok
    end
  end

  defp valid_message?(message) when is_map(message), do: nonblank?(Map.get(message, "role"))
  defp valid_message?(_message), do: false

  defp field(record, key) when is_map(record),
    do: Map.get(record, key) || Map.get(record, Atom.to_string(key))

  defp nonblank?(value) when is_binary(value), do: String.trim(value) != ""
  defp nonblank?(_value), do: false
end
