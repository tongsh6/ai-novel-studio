defmodule NovelApplication.AuthoringTranscript.Codec do
  @moduledoc """
  canonical transcript 的纯 JSON 解码边界。

  白名单键只在结构层转为 atom；arguments、content、detail、恢复预算等 JSON
  payload 保持原样。这里只核形状，不读取历史、不调用 Provider、不代替完整 IR 校验。
  """

  alias NovelCommon.RequestIR

  @json_payload_keys ~w(arguments versions items run tools provider_state detail content coverage budget_after)a
  @canonical_keys ~w(
    run system messages tools base_refs observation_refs used_refs projection call_ids
    identity_ref instructions run_role finite_mode tool_choice
    constitution_version output_protocol_version output_schema_ref
    native_multi_turn tool_calls tool_results streaming structured_output usage
    role provenance blocks source_refs versions ref version type text call_id name arguments
    schema_version status source_refs coverage omissions next_offset content reason_code detail
    retryable budget_after
    artifact_type items adoption_required canon_written artifact_refs kind refs covers summary
    finding_count review_status policy_action turn_range
    raw_arguments provider_call_id provider_state reasoning_content
    provider_call_ref provider_run_ref message_refs run_id run_sequence
    discussion response_text response_sha256
  )a

  @doc "解码完整 transcript 形状；run 归一化仍由各恢复入口按原时序完成。"
  @spec decode_transcript(map()) :: {:ok, map()} | {:error, term()}
  def decode_transcript(data) when is_map(data) do
    transcript = normalize_checkpoint(data)

    with :ok <- validate_checkpoint_shape(transcript) do
      {:ok, transcript}
    end
  end

  def decode_transcript(_data), do: {:error, :invalid_transcript_checkpoint}

  @doc """
  段数据归一化：JSON 形状 → canonical atom-key transcript，只做文本形状校验。

  段本身允许含跨段 checkpoint（covers 指向会话历史中的更早交换），因此不做完整
  IR 校验；`AuthoringCheckpoint` 在会话视图上完成完整校验。仅供存储读取边界使用。
  """
  @spec normalize_segment(map()) :: {:ok, map()} | {:error, term()}
  def normalize_segment(data) when is_map(data) do
    with {:ok, transcript} <- decode_transcript(data) do
      # run 属于 JSON payload 保护键（normalize 不递归转键），这里用与 new/1 相同的
      # run envelope 规范化，保证恢复出的 identity 是 canonical atom-key 形状。
      {:ok, %{transcript | run: RequestIR.run_envelope(transcript.run)}}
    end
  end

  def normalize_segment(_data), do: {:error, :invalid_authoring_segment}

  defp validate_checkpoint_shape(transcript) do
    maps = [:run, :system, :projection]
    lists = [:messages, :tools, :base_refs, :observation_refs, :used_refs, :call_ids]
    map_lists = [:messages, :tools]
    ref_lists = [:base_refs, :observation_refs]

    valid? =
      Enum.all?(maps, &is_map(Map.get(transcript, &1))) and
        Enum.all?(lists, &is_list(Map.get(transcript, &1))) and
        Enum.all?(map_lists, &Enum.all?(Map.fetch!(transcript, &1), fn item -> is_map(item) end)) and
        Enum.all?(
          ref_lists,
          &Enum.all?(Map.fetch!(transcript, &1), fn item -> valid_ref?(item) end)
        ) and
        Enum.all?(transcript.messages, &valid_message_shape?/1)

    if valid?, do: :ok, else: {:error, :invalid_transcript_checkpoint}
  end

  @doc """
  把 JSON 形状的 canonical 消息归一化为内存 canonical 形状（白名单键 string→atom）。

  会话历史（持久层读出的 string-key JSON）在进入请求派生视图前必须经过本函数，
  与 `decode_transcript/1` 使用同一套键归一化与 payload 保护；调用方仍负责完整 IR 校验。
  """
  @spec normalize_messages([map()]) :: [map()]
  def normalize_messages(messages) when is_list(messages) do
    Enum.map(messages, &normalize_checkpoint/1)
  end

  def normalize_messages(_messages), do: []

  # string ref 与结构化 ref 都是已支持输入；空值/伪 ref 不得进入 canonical 范围。
  defp valid_ref?(ref) when is_binary(ref), do: String.trim(ref) != ""

  defp valid_ref?(%{} = ref) do
    case Map.get(ref, :ref) || Map.get(ref, "ref") do
      key when is_binary(key) -> String.trim(key) != ""
      _ -> false
    end
  end

  defp valid_ref?(_ref), do: false

  defp valid_message_shape?(%{blocks: blocks}) when is_list(blocks),
    do: Enum.all?(blocks, &is_map/1)

  defp valid_message_shape?(_), do: false

  defp normalize_checkpoint(value) when is_map(value) do
    Map.new(value, fn {key, item} ->
      canonical = canonical_key(key)
      restored = if canonical in @json_payload_keys, do: item, else: normalize_checkpoint(item)
      {canonical, restored}
    end)
  end

  defp normalize_checkpoint(value) when is_list(value),
    do: Enum.map(value, &normalize_checkpoint/1)

  defp normalize_checkpoint(value), do: value

  defp canonical_key(key) when is_atom(key), do: key

  defp canonical_key(key) when is_binary(key),
    do: Enum.find(@canonical_keys, key, &(Atom.to_string(&1) == key))
end
