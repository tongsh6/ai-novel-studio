defmodule NovelApplication.AuthoringSessionHistory do
  @moduledoc """
  B81 CP2：会话 canonical 历史 → 请求派生视图（application 层唯一组装点）。

  裁决（B81 §8.4.6，2026-11-09 作者「按推荐」批准）：

  - 不新增 `novel_common` 纯契约；会话历史读取经 persistence 读端口
    （`AuthoringSessionLog.fetch_session_messages/1`、
    `fetch_session_refs/1`），组装在 application 内完成。
  - **请求派生视图** = 当前 run 段 transcript 前置会话历史消息；**run 执行段
    transcript 不受影响**（持久化仍只落本 run 消息，`strip/2` 在请求边界剥离）。
  - 历史消息排除当前 run 已提交消息（避免重复）与历史 `application_base`
    （base 是应用注入的稳定说明，由当前 run 的 base 唯一承载，保证请求前缀稳定）。
  - refs 按会话累计合并（base/observation/used，按 ref 值去重；历史在前、当前在后），
    使 I-ART-9（used_refs ⊆ base ∪ observation）在跨 turn 观察下仍可机械校验。
  """

  alias NovelApplication.AuthoringTranscript
  alias NovelPersistence.AuthoringSessionLog

  @type t :: %{
          messages: [map()],
          refs: %{
            base_refs: list(),
            observation_refs: list(),
            used_refs: list()
          }
        }

  @doc """
  读取本 run 的会话历史视图；无历史消息时返回 `{:ok, nil}`。

  当前 run 已提交消息与会话级 `application_base` 不计入历史（见 moduledoc）。
  会话身份缺失视为「无会话历史可派生」（首轮/非会话入口，行为与 CP1 一致）；
  有会话但段头损坏/版本未知 fail-closed（不静默把它当成空历史）。
  """
  @spec fetch(map()) :: {:ok, t() | nil} | {:error, term()}
  def fetch(run) when is_map(run) do
    session_id = field(run, :session_id)
    run_id = field(run, :run_id)

    if nonblank?(session_id) do
      with {:ok, refs} <- AuthoringSessionLog.fetch_session_refs(session_id) do
        messages =
          session_id
          |> AuthoringSessionLog.fetch_session_messages()
          |> Enum.reject(&(field(&1, :run_id) == run_id))
          |> Enum.reject(&(field(&1, :role) == "application_base"))
          |> Enum.map(&field(&1, :message))
          |> AuthoringTranscript.normalize_messages()

        if messages == [] do
          {:ok, nil}
        else
          {:ok, %{messages: messages, refs: refs}}
        end
      end
    else
      # 无会话身份 = 无会话历史可派生（首轮/非会话入口），不是损坏。
      {:ok, nil}
    end
  end

  @doc """
  把会话历史前置到当前 run 的段 transcript，返回 `{请求派生视图, 历史消息数}`。

  顺序：当前 run 的 `application_base` 保持最前 → 历史消息（会话 sequence 原序）→
  当前 run 其余消息（scope/作者/…）。refs 合并为会话累计（按 ref 值去重）。

  `nil` 历史（首轮）返回原 transcript 与 0，行为与 CP1 完全一致。
  """
  @spec compose(AuthoringTranscript.t(), t() | nil) ::
          {AuthoringTranscript.t(), non_neg_integer()}
  def compose(transcript, nil), do: {transcript, 0}

  def compose(transcript, %{messages: history_messages, refs: refs})
      when is_list(history_messages) and is_map(refs) do
    {base, rest} = split_base(transcript.messages)

    messages =
      case base do
        nil -> history_messages ++ rest
        base_message -> [base_message] ++ history_messages ++ rest
      end

    merged = %{
      transcript
      | messages: messages,
        base_refs: merge_refs(Map.get(refs, :base_refs, []), transcript.base_refs),
        observation_refs:
          merge_refs(Map.get(refs, :observation_refs, []), transcript.observation_refs),
        used_refs: merge_refs(Map.get(refs, :used_refs, []), transcript.used_refs)
    }

    {merged, length(history_messages)}
  end

  @doc """
  从请求派生视图剥离历史前缀，恢复当前 run 段 transcript。

  持久化/回写只接受段视图（裁决④：`stage_state` 只保存本 run 执行段）。
  """
  @spec strip(AuthoringTranscript.t(), non_neg_integer()) :: AuthoringTranscript.t()
  def strip(transcript, 0), do: transcript

  def strip(transcript, history_count)
      when is_integer(history_count) and history_count > 0 and is_list(transcript.messages) do
    case transcript.messages do
      [%{role: "application_base"} = base | rest] ->
        {_history, segment_rest} = Enum.split(rest, history_count)
        %{transcript | messages: [base | segment_rest]}

      messages ->
        {_history, segment_rest} = Enum.split(messages, history_count)
        %{transcript | messages: segment_rest}
    end
  end

  def strip(transcript, _history_count), do: transcript

  # 段 transcript 的首条消息是当前 run 的 application_base；历史合并时保持它最前，
  # 保证 Provider 请求前缀稳定（I-CACHE）与 base 唯一。
  defp split_base([%{role: "application_base"} = base | rest]), do: {base, rest}
  defp split_base(messages), do: {nil, messages}

  defp merge_refs(history_refs, current_refs) do
    (List.wrap(history_refs) ++ List.wrap(current_refs))
    |> Enum.map(&normalize_ref/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq_by(& &1.ref)
  end

  defp normalize_ref(%{ref: ref}) when is_binary(ref), do: %{ref: ref}
  defp normalize_ref(%{"ref" => ref}) when is_binary(ref), do: %{ref: ref}
  defp normalize_ref(ref) when is_binary(ref) and ref != "", do: %{ref: ref}
  defp normalize_ref(_ref), do: nil

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, to_string(key))
  end

  defp field(_map, _key), do: nil

  defp nonblank?(value) when is_binary(value), do: String.trim(value) != ""
  defp nonblank?(_value), do: false
end
