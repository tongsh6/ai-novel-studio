defmodule NovelApplication.AuthoringCheckpoint do
  @moduledoc """
  B71 私有 canonical 历史的共享选择/校验边界（VS-00L §16.8）。

  只消费 `AuthoringTranscript` 的现有 checkpoint codec 与 Request IR 校验，不另建
  第二套消息/IR 组装。写边界由 persistence changeset 保证 append-only；本模块负责
  application 写入前的语义校验和读边界，并核对完整不可变身份。

  - 私有列非空时是唯一 canonical 选择；bounded run 没有 long-run checkpoint 时同样
    只读私有列，不依赖旧内嵌格式。
  - v3：只接受 `authoring_transcript_ref`（run_id + 格式版本），读取同一 run 的
    `agent_runs.authoring_transcript`；引用错绑/私有数据损坏时返回 error。
  - 项目未发布，不兼容历史数据格式：旧 v2 内嵌 checkpoint 不再有运行时读取路径；
    历史证据目录仍只读保留，作者数据不删除（2026-11-08 作者原则）。
  """

  alias NovelApplication.AuthoringTranscript

  @format_version "authoring-transcript/v1"
  @private_key "authoring_transcript"
  @identity_fields ["run_id", "workspace_id", "work_id", "session_id", "parent_turn_ref"]

  @type select_result ::
          {:ok, map() | nil, :private_run | :none}
          | {:partial, term()}
          | {:error, term()}

  @spec format_version() :: String.t()
  def format_version, do: @format_version

  @doc "durable checkpoint 的最小引用：只含 run_id 与 transcript 格式版本。"
  @spec ref(String.t()) :: %{String.t() => String.t()}
  def ref(run_id) when is_binary(run_id) do
    %{"run_id" => run_id, "version" => @format_version}
  end

  @doc "选择同一 run 的私有 canonical；不启动 Provider、不修补历史。"
  @spec select(map(), map() | nil) :: select_result()
  def select(record, checkpoint_data) when is_map(record) do
    record = normalize(record)
    data = normalize(checkpoint_data || %{})
    agent_run = data |> value("agent_run") |> normalize()
    version = value(agent_run, "checkpoint_version")
    private = value(record, @private_key)

    cond do
      not is_nil(private) -> select_private(record, private, agent_run, version)
      version == 3 -> select_v3(record, agent_run)
      is_nil(version) -> select_unversioned(data)
      true -> {:error, :checkpoint_version_mismatch}
    end
  end

  @doc """
  恢复并校验私有 canonical；成功返回 transcript 与来源，供离线恢复/回查使用。

  `checkpoint_data` 可以为 nil：bounded 运行没有 long-run checkpoint 时直接读取
  `agent_runs.authoring_transcript`，不依赖 long-run task，也不启动执行。
  """
  @spec restore(map(), map() | nil) ::
          {:ok, AuthoringTranscript.t() | nil, :private_run | :none}
          | {:partial, term()}
          | {:error, term()}
  def restore(record, checkpoint_data) when is_map(record) do
    record = normalize(record)

    with {:ok, checkpoint, source} <- select(record, checkpoint_data),
         {:ok, transcript} <- restore_checkpoint(record, checkpoint, source) do
      {:ok, transcript, source}
    end
  end

  @doc """
  application 写入边界：把内存 canonical 编码为私有列 JSON 形状，并用同一
  `AuthoringTranscript.restore/1`（含 Request IR 校验）与身份校验证明可回读。
  """
  @spec encode_for_write(map(), AuthoringTranscript.t() | nil) ::
          {:ok, map() | nil} | {:error, term()}
  def encode_for_write(_record, nil), do: {:ok, nil}

  def encode_for_write(record, transcript) when is_map(record) and is_map(transcript) do
    checkpoint = AuthoringTranscript.checkpoint(transcript)

    with :ok <- validate_for_write(record, checkpoint),
         {:ok, stored} <- json_roundtrip(checkpoint),
         :ok <- validate_for_write(record, stored) do
      {:ok, stored}
    end
  end

  @doc "写入前语义校验：版本/结构/完整 IR 可恢复性 + 不可变 run 身份。"
  @spec validate_for_write(map(), map()) :: :ok | {:error, term()}
  def validate_for_write(record, checkpoint) when is_map(record) and is_map(checkpoint) do
    record = normalize(record)

    case AuthoringTranscript.restore(checkpoint) do
      {:ok, transcript} -> validate_identity(record, transcript.run)
      {:error, _reason} = error -> error
    end
  end

  def validate_for_write(_record, _checkpoint), do: {:error, :invalid_authoring_checkpoint}

  defp select_private(record, private, agent_run, 3),
    do: select_private_v3(record, private, agent_run)

  defp select_private(_record, private, _agent_run, nil), do: {:ok, private, :private_run}

  defp select_private(_record, _private, _agent_run, _other),
    do: {:error, :checkpoint_version_mismatch}

  defp select_private_v3(record, private, agent_run) do
    case value(agent_run, "authoring_transcript_ref") do
      nil ->
        {:error, :authoring_transcript_ref_missing}

      ref ->
        if valid_ref?(ref, record),
          do: {:ok, private, :private_run},
          else: {:error, :authoring_transcript_ref_mismatch}
    end
  end

  defp select_v3(record, agent_run) do
    ref = value(agent_run, "authoring_transcript_ref")

    cond do
      is_nil(ref) -> {:ok, nil, :none}
      not valid_ref?(ref, record) -> {:error, :authoring_transcript_ref_mismatch}
      true -> {:error, :authoring_transcript_missing}
    end
  end

  # 没有任何 checkpoint 数据才算“没有历史”；一旦有数据却缺版本，就是未知格式，
  # 必须如实报告 partial，不能按 v2 猜测或静默当作无历史。
  defp select_unversioned(data) when map_size(data) == 0, do: {:ok, nil, :none}
  defp select_unversioned(_data), do: {:partial, :checkpoint_version_missing}

  defp valid_ref?(ref, record) when is_map(ref) do
    normalized = normalize(ref)

    Enum.sort(Map.keys(normalized)) == ["run_id", "version"] and
      value(normalized, "run_id") == identity_value(record, "run_id") and
      value(normalized, "version") == @format_version
  end

  defp valid_ref?(_ref, _record), do: false

  defp restore_checkpoint(_record, nil, _source), do: {:ok, nil}

  defp restore_checkpoint(record, checkpoint, _source) do
    with {:ok, transcript} <- AuthoringTranscript.restore(checkpoint),
         :ok <- validate_identity(record, transcript.run) do
      {:ok, transcript}
    end
  end

  defp validate_identity(record, run) do
    run = normalize(run)
    missing = Enum.filter(@identity_fields, &blank?(value(run, &1)))
    mismatched = Enum.filter(@identity_fields, &(value(run, &1) != identity_value(record, &1)))

    cond do
      missing != [] -> {:error, :authoring_transcript_identity_missing}
      mismatched != [] -> {:error, :authoring_transcript_identity_mismatch}
      true -> :ok
    end
  end

  defp identity_value(record, "run_id"),
    do: value(record, "id") || value(record, "run_id")

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
  defp json_roundtrip(checkpoint) do
    with {:ok, json} <- Jason.encode(checkpoint),
         {:ok, decoded} <- Jason.decode(json) do
      {:ok, decoded}
    else
      _error -> {:error, :authoring_transcript_not_json_encodable}
    end
  end
end
