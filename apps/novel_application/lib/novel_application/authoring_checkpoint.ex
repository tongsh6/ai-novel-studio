defmodule NovelApplication.AuthoringCheckpoint do
  @moduledoc """
  会话级 canonical 创作历史的 application 读写边界（ADR-0035 / B81 CP1）。

  canonical 历史的作用域是**会话**（`AuthoringSessionLog` 的
  `authoring_session_messages` / `authoring_run_segments`）；AgentRun 只是执行段。
  本模块是 application 层访问该历史的唯一入口：

  - 写入：把内存 `AuthoringTranscript` 编码为 run 执行段（header + messages），
    完成 JSON 真实形状归一化、完整 IR 可恢复性与不可变身份校验后交给持久层；
  - 读取：按 run 从会话存储重建执行段 transcript，并核对 durable checkpoint 的
    段引用；未知版本/错绑/损坏一律 fail-closed，不猜测、不补造、不回退内嵌副本。
    有会话段时，task checkpoint 缺版本不阻断（段是唯一 canonical 真源，task 数据
    只用于核对引用）；该组合由测试锁定，避免后续同步改动无声。

  不新建第二套校验：身份字段（run_id/workspace_id/work_id/session_id/
  parent_turn_ref）、版本、前缀语义与旧 run 级私有 checkpoint 保持一致（B71 /
  VS-00L §16.8），只是落点从 run 列改为会话存储。
  """

  alias NovelApplication.AuthoringTranscript
  alias NovelPersistence.AuthoringSessionLog

  @identity_fields ["run_id", "workspace_id", "work_id", "session_id", "parent_turn_ref"]
  @durable_checkpoint_version 3

  @type restore_result ::
          {:ok, AuthoringTranscript.t() | nil, :session_segment | :none}
          | {:partial, term()}
          | {:error, term()}

  @doc "durable checkpoint 段引用的格式版本（由持久层唯一持有）。"
  @spec format_version() :: String.t()
  def format_version, do: AuthoringSessionLog.segment_format_version()

  @doc "durable checkpoint 的最小段引用：run_id 与格式版本。"
  @spec ref(String.t()) :: %{String.t() => String.t()}
  def ref(run_id) when is_binary(run_id) do
    %{"run_id" => run_id, "version" => format_version()}
  end

  @doc """
  application 写入边界：把内存 canonical 编码为会话执行段（header + messages）。

  与旧 `encode_for_write` 同等强度：先按真实 JSON 落库形状归一化，再用同一
  `AuthoringTranscript.restore/1`（含 Request IR 全量校验）和不可变身份校验证明
  可回读；不可 JSON 表示的值返回 error 且不泄漏内容。
  """
  @spec encode_segment_for_write(map(), AuthoringTranscript.t() | nil) ::
          {:ok, %{header: map(), messages: [map()]} | nil} | {:error, term()}
  def encode_segment_for_write(_record, nil), do: {:ok, nil}

  def encode_segment_for_write(record, transcript) when is_map(record) and is_map(transcript) do
    segment = %{
      "header" => segment_header(transcript),
      "messages" => AuthoringTranscript.checkpoint(transcript).transcript.messages
    }

    with {:ok, decoded} <- json_roundtrip(segment),
         stored = %{header: decoded["header"], messages: decoded["messages"]},
         :ok <- validate_segment(record, stored) do
      {:ok, stored}
    end
  end

  @doc "写入前语义校验：结构/完整 IR 可恢复性 + 不可变 run 身份。"
  @spec validate_segment(map(), map()) :: :ok | {:error, term()}
  def validate_segment(record, %{header: header, messages: messages}) do
    with {:ok, transcript} <- restore_from_parts(header, messages) do
      validate_identity(record, transcript.run)
    end
  end

  def validate_segment(_record, _segment), do: {:error, :invalid_authoring_segment}

  @doc """
  恢复本 run 的执行段 transcript；`checkpoint_data` 用于核对 durable 段引用。

  `checkpoint_data` 可以为 nil/空：bounded run 没有 long-run checkpoint 时直接读
  会话存储，不依赖 long-run task，也不启动执行。失败只用 error/partial 如实报告，
  不重建 `stage_state`、不伪造历史。
  """
  @spec restore(map(), map() | nil) :: restore_result()
  def restore(record, checkpoint_data) when is_map(record) do
    data = normalize(checkpoint_data || %{})

    case load_transcript(record) do
      {:ok, nil} -> select_without_segment(record, data)
      {:ok, transcript} -> select_with_segment(record, data, transcript)
      {:error, reason} -> {:error, reason}
    end
  end

  # 私有列/会话段存在时是唯一 canonical：checkpoint_data 只用来核对引用关系。
  defp select_with_segment(record, data, transcript) do
    version = durable_checkpoint_version(data)

    cond do
      map_size(data) == 0 -> {:ok, transcript, :session_segment}
      is_nil(version) -> {:ok, transcript, :session_segment}
      version != @durable_checkpoint_version -> {:error, :checkpoint_version_mismatch}
      is_nil(segment_ref(data)) -> {:error, :authoring_segment_ref_missing}
      not valid_ref?(segment_ref(data), record) -> {:error, :authoring_segment_ref_mismatch}
      true -> {:ok, transcript, :session_segment}
    end
  end

  # 没有任何会话段时：只有完全空 checkpoint 才是“没有历史”；有数据却缺版本是未知
  # 格式，必须如实报告 partial，不能按旧 v2 猜测或静默当作无历史。
  defp select_without_segment(record, data) do
    version = durable_checkpoint_version(data)
    ref = segment_ref(data)

    cond do
      map_size(data) == 0 ->
        {:ok, nil, :none}

      is_nil(version) ->
        {:partial, :checkpoint_version_missing}

      version != @durable_checkpoint_version ->
        {:error, :checkpoint_version_mismatch}

      is_nil(ref) ->
        {:ok, nil, :none}

      not valid_ref?(ref, record) ->
        {:error, :authoring_segment_ref_mismatch}

      true ->
        {:error, :authoring_segment_missing}
    end
  end

  defp load_transcript(record) do
    case AuthoringSessionLog.fetch_run_segment(record_id(record)) do
      {:ok, nil} ->
        {:ok, nil}

      {:ok, %{header: header, messages: messages}} ->
        with {:ok, transcript} <- restore_from_parts(header, messages),
             :ok <- validate_identity(record, transcript.run) do
          {:ok, transcript}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp restore_from_parts(header, messages) when is_map(header) and is_list(messages) do
    data = %{
      "run" => Map.get(header, "run", %{}),
      "system" => Map.get(header, "system", %{}),
      "messages" => messages,
      "tools" => Map.get(header, "tools", []),
      "base_refs" => Map.get(header, "base_refs", []),
      "observation_refs" => Map.get(header, "observation_refs", []),
      "used_refs" => Map.get(header, "used_refs", []),
      "call_ids" => Map.get(header, "call_ids", []),
      "projection" => Map.get(header, "projection", %{})
    }

    AuthoringTranscript.restore(%{
      "version" => AuthoringTranscript.checkpoint_version(),
      "transcript" => data
    })
  end

  defp restore_from_parts(_header, _messages), do: {:error, :invalid_authoring_segment}

  defp segment_header(transcript) do
    checkpoint = AuthoringTranscript.checkpoint(transcript).transcript

    %{
      "version" => format_version(),
      "run" => checkpoint.run,
      "system" => checkpoint.system,
      "tools" => checkpoint.tools,
      "projection" => checkpoint.projection,
      "base_refs" => checkpoint.base_refs,
      "observation_refs" => checkpoint.observation_refs,
      "used_refs" => checkpoint.used_refs,
      "call_ids" => checkpoint.call_ids
    }
  end

  defp durable_checkpoint_version(data) do
    data |> nested_run_data() |> value("checkpoint_version")
  end

  defp segment_ref(data) do
    data |> nested_run_data() |> value("authoring_segment_ref")
  end

  defp nested_run_data(data) when is_map(data) do
    case value(data, "agent_run") do
      %{} = agent_run -> agent_run
      _other -> %{}
    end
  end

  defp valid_ref?(ref, record) when is_map(ref) do
    normalized = normalize(ref)

    Enum.sort(Map.keys(normalized)) == ["run_id", "version"] and
      value(normalized, "run_id") == record_id(record) and
      value(normalized, "version") == format_version()
  end

  defp valid_ref?(_ref, _record), do: false

  defp validate_identity(record, run) do
    record = normalize(record)
    run = normalize(run)
    missing = Enum.filter(@identity_fields, &blank?(value(run, &1)))
    mismatched = Enum.filter(@identity_fields, &(value(run, &1) != identity_value(record, &1)))

    cond do
      missing != [] -> {:error, :authoring_segment_identity_missing}
      mismatched != [] -> {:error, :authoring_segment_identity_mismatch}
      true -> :ok
    end
  end

  defp record_id(record) do
    record = normalize(record)
    value(record, "id") || value(record, "run_id")
  end

  defp identity_value(record, "run_id"), do: value(record, "id") || value(record, "run_id")
  defp identity_value(record, field), do: value(record, field)

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false

  # 只读固定字符串键；调用方先 normalize 一次，不在递归中动态造 atom。
  defp value(map, key) when is_map(map), do: Map.get(map, key)
  defp value(_map, _key), do: nil

  defp normalize(value) when is_struct(value) do
    value
    |> Map.from_struct()
    |> normalize()
  end

  defp normalize(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {normalize_key(key), normalize(item)} end)
  end

  defp normalize(value) when is_list(value), do: Enum.map(value, &normalize/1)
  defp normalize(value), do: value

  defp normalize_key(key) when is_binary(key), do: key
  defp normalize_key(key) when is_atom(key), do: Atom.to_string(key)
  defp normalize_key(key), do: key

  # 真实落库边界：复用 Jason 正式 encoder，而不是消费者自建的 Date/struct 例外表。
  # 编码后再解码，后续 restore/IR 校验的对象就是数据库实际写出的 JSON 形状。
  defp json_roundtrip(value) do
    with {:ok, json} <- Jason.encode(value),
         {:ok, decoded} <- Jason.decode(json) do
      {:ok, decoded}
    else
      _error -> {:error, :authoring_segment_not_json_encodable}
    end
  end
end
