defmodule NovelApplication.AuthoringCheckpoint do
  @moduledoc """
  会话级 canonical 创作历史的 application 读写边界（ADR-0035 / B81 CP1）。

  canonical 历史的作用域是**会话**（`AuthoringSessionLog` 的
  `authoring_session_messages` / `authoring_run_segments`）；AgentRun 只是执行段。
  本模块是 application 层访问该历史的唯一入口：

  - 写入：把内存 `AuthoringTranscript` 编码为 run 执行段（header + messages），
    完成 JSON 真实形状归一化后交给持久层；不可变身份和完整会话 IR 由
    `validate_segment/2` 在写事务中一起校验；
  - 读取：按 run 从会话存储重建执行段 transcript，并核对 durable checkpoint 的
    段引用；未知版本/错绑/损坏一律 fail-closed，不猜测、不补造、不回退内嵌副本。
    有会话段时，task checkpoint 缺版本不阻断（段是唯一 canonical 真源，task 数据
    只用于核对引用）；该组合由测试锁定，避免后续同步改动无声。

  不新建第二套校验：身份字段（run_id/workspace_id/work_id/session_id/
  parent_turn_ref）、版本、前缀语义与旧 run 级私有 checkpoint 保持一致（B71 /
  VS-00L §16.8），只是落点从 run 列改为会话存储。
  """

  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
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
  生成只含 canonical run 事实的 JSON 检查点（编码边界；不保存 Provider 请求/私有会话）。

  从 `AuthoringTranscript.checkpoint/1` 移入本模块：检查点编码属存储边界职责，
  transcript 模块只保留组装操作（B81 CP3 收尾拆分，SRP）。
  """
  @spec checkpoint(AuthoringTranscript.t()) :: map()
  def checkpoint(transcript) do
    %{
      version: AuthoringTranscript.checkpoint_version(),
      transcript:
        Map.take(transcript, [
          :run,
          :system,
          :messages,
          :tools,
          :base_refs,
          :observation_refs,
          :used_refs,
          :projection,
          :call_ids
        ])
        |> Map.update(:system, %{}, &AuthoringTranscript.system_run_rules/1)
    }
  end

  @doc """
  以「执行段」语义恢复：归一化 + 文本形状 + run envelope 规范化，不做完整 IR 校验。

  跨段压缩的 checkpoint 可能覆盖本段之前会话历史中的交换（covers 在本段内不可见），
  因此段本身不保证独立构成合法 IR；调用方必须随后在会话视图上完成完整校验
  （本模块 `validate_segment/2`/`restore/2` 负责）。仅用于存储读取边界。
  """
  @spec restore_segment(map()) :: {:ok, AuthoringTranscript.t()} | {:error, term()}
  def restore_segment(%{"version" => version, "transcript" => data}) when is_map(data),
    do: restore_segment_data(version, data)

  def restore_segment(%{version: version, transcript: data}) when is_map(data),
    do: restore_segment_data(version, data)

  def restore_segment(_), do: {:error, :unsupported_transcript_checkpoint}

  defp restore_segment_data(version, data) do
    if version == AuthoringTranscript.checkpoint_version() do
      AuthoringTranscript.normalize_segment(data)
    else
      {:error, :unsupported_transcript_checkpoint}
    end
  end

  @doc """
  按压缩 plan 追加 checkpoint 消息；不要求 covers 在本段内可见（跨段压缩由会话视图校验）。

  同一 checkpoint 幂等；plan 形状先经 `Compaction.require_call_ids/1` 校验。
  """
  @spec append_checkpoint(AuthoringTranscript.t(), map()) ::
          {:ok, AuthoringTranscript.t()} | {:error, term()}
  def append_checkpoint(transcript, %{
        covers: covers,
        source_refs: refs,
        versions: versions,
        omissions: omissions,
        summary: summary
      }) do
    with :ok <- Compaction.require_call_ids(covers) do
      block = RequestIR.checkpoint_block(covers, refs, versions, omissions, summary)
      checkpoint = RequestIR.message(:checkpoint, :application, [block])

      if checkpoint in transcript.messages do
        {:ok, transcript}
      else
        {:ok, %{transcript | messages: transcript.messages ++ [checkpoint]}}
      end
    end
  end

  def append_checkpoint(_transcript, _plan), do: {:error, :invalid_compaction_request}

  @doc "把内存 canonical 编码成真实落库的 JSON 段。会话校验在提交事务中执行。"
  @spec encode_segment_for_write(AuthoringTranscript.t() | nil) ::
          {:ok, %{header: map(), messages: [map()]} | nil} | {:error, term()}
  def encode_segment_for_write(nil), do: {:ok, nil}

  def encode_segment_for_write(transcript) when is_map(transcript) do
    data = checkpoint(transcript).transcript

    with :ok <- validate_transcript_data_keys(data),
         {:ok, decoded} <-
           json_roundtrip(%{"header" => segment_header(data), "messages" => data.messages}) do
      {:ok, %{header: decoded["header"], messages: decoded["messages"]}}
    end
  end

  # transcript 结构的 data 键必须与段头键契约完全一致：AuthoringTranscript 结构新增
  # 键而 AuthoringSessionLog 契约未扩展时，写入会静默丢数据——这里 fail-closed。
  defp validate_transcript_data_keys(data) when is_map(data) do
    actual = data |> Map.keys() |> Enum.reject(&(&1 == :messages)) |> Enum.sort()

    if actual == Enum.sort(header_data_keys()) do
      :ok
    else
      {:error, :authoring_segment_key_contract_mismatch}
    end
  end

  defp validate_transcript_data_keys(_data), do: {:error, :invalid_authoring_segment}

  @doc """
  写入事务内的语义校验：结构与完整 IR 可恢复性 + 不可变 run 身份 + 会话视图语义。

  必须在持有写锁（`AgentRunLog.commit_snapshot/2` 的 immediate 事务）后、任何该
  snapshot 变更前调用，传入实际将写入的 run_record 与 segment；构造 snapshot 时
  的历史可能已被其他写者推进，不能作为最终判定依据。
  """
  @spec validate_segment(map(), map()) :: :ok | {:error, term()}
  def validate_segment(record, %{header: header, messages: messages}) do
    with {:ok, transcript} <- restore_from_parts(header, messages),
         :ok <- validate_identity(normalize(record), transcript.run) do
      validate_in_session(transcript)
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
    record = normalize(record)

    case load_transcript(record) do
      {:ok, nil} -> select_without_segment(record, data)
      {:ok, transcript} -> select_with_segment(record, data, transcript)
      {:error, reason} -> {:error, reason}
    end
  end

  # 私有列/会话段存在时是唯一 canonical：checkpoint_data 只用来核对引用关系。
  defp select_with_segment(record, data, transcript) do
    version = durable_checkpoint_version(data)
    ref = segment_ref(data)

    cond do
      map_size(data) == 0 or is_nil(version) -> {:ok, transcript, :session_segment}
      version != @durable_checkpoint_version -> {:error, :checkpoint_version_mismatch}
      is_nil(ref) -> {:error, :authoring_segment_ref_missing}
      not valid_ref?(ref, record) -> {:error, :authoring_segment_ref_mismatch}
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
             :ok <- validate_identity(record, transcript.run),
             :ok <- validate_in_session(transcript) do
          {:ok, transcript}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp restore_from_parts(header, messages) when is_map(header) and is_list(messages) do
    # 键集合由持久层契约单一来源提供；缺键由 AuthoringTranscript 结构校验 fail-closed。
    data =
      header
      |> Map.take(Enum.map(header_data_keys(), &Atom.to_string/1))
      |> Map.put("messages", messages)

    restore_segment(%{
      "version" => AuthoringTranscript.checkpoint_version(),
      "transcript" => data
    })
  end

  defp restore_from_parts(_header, _messages), do: {:error, :invalid_authoring_segment}

  # 段 transcript 允许含跨段 checkpoint（covers 指向会话历史中的更早交换），因此
  # 完整 IR 校验必须放在「会话视图」上：历史（排除本 run 已提交消息）+ 本 run 段。
  # 首轮/无历史时视图就是段本身，与 CP1 校验强度一致。
  defp validate_in_session(%{run: run} = transcript) do
    # 用 canonical run envelope 的 run_id/session_id 读取历史：restore 的 record 是
    # 归一化后的存储行（id/字段名可能与 envelope 不同），不能作为排除当前 run 的依据。
    with {:ok, history} <- AuthoringSessionHistory.fetch(run) do
      view = AuthoringSessionHistory.compose(transcript, history)

      case AuthoringTranscript.to_request_ir(view) do
        {:ok, _ir} -> :ok
        error -> error
      end
    end
  end

  # 键集合由持久层契约单一来源提供；新增 data 键只改 AuthoringSessionLog。
  defp segment_header(data) do
    data
    |> Map.take(header_data_keys())
    |> Map.new(fn {key, value} -> {Atom.to_string(key), value} end)
    |> Map.put("version", format_version())
  end

  defp header_data_keys, do: NovelPersistence.AuthoringSessionLog.header_data_keys()

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

  # `record` 由调用方 normalize 一次（restore/validate_segment 入口）；`run` 来自
  # transcript（atom 键），此处统一转成字符串键后比较。
  defp validate_identity(record, run) do
    run = normalize(run)
    missing = Enum.filter(@identity_fields, &blank?(value(run, &1)))
    mismatched = Enum.filter(@identity_fields, &(value(run, &1) != identity_value(record, &1)))

    cond do
      missing != [] -> {:error, :authoring_segment_identity_missing}
      mismatched != [] -> {:error, :authoring_segment_identity_mismatch}
      true -> :ok
    end
  end

  defp record_id(record), do: value(record, "id") || value(record, "run_id")

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
