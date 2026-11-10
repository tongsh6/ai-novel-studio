defmodule NovelApplication.AuthoringSessionHistory do
  @moduledoc """
  B81 CP2：会话 canonical 历史 → 请求派生视图（application 层唯一组装点）。

  裁决（B81 §8.4.6，2026-11-09 作者「按推荐」批准）：

  - 不新增 `novel_common` 纯契约；会话历史读取经 persistence 读端口
    （`AuthoringSessionLog.fetch_session_messages/1`、
    `fetch_session_refs/1`），组装在 application 内完成。
  - **请求派生视图** = 当前 `application_base` 一次 → 全部非 base 已提交消息
    （会话 sequence 原序，含当前 run 已提交行）→ 当前段未提交尾部；**run 执行段
    transcript 不受影响**（持久化仍只落本 run 消息）。
  - 外 run 的已提交消息在视图上临时标记 `session_history_run_id`（实际归属
    run_id，不入库）；本 run 已提交行与局部新增消息不带标记。请求边界按同一
    归属标记一次剥离，当前 run 已提交行不重复拼接本地副本。
  - refs 按会话累计合并（base/observation/used，按 ref 值去重；历史在前、当前在后），
    使 I-ART-9（used_refs ⊆ base ∪ observation）在跨 turn 观察下仍可机械校验。
  """

  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelPersistence.AuthoringSessionLog

  @history_run_id_key :session_history_run_id

  @type row :: %{
          required(:run_id) => String.t(),
          required(:message) => map(),
          optional(:sequence) => pos_integer(),
          optional(:run_sequence) => pos_integer(),
          optional(:role) => String.t()
        }

  @type t :: %{
          rows: [row()],
          refs: %{
            base_refs: list(),
            observation_refs: list(),
            used_refs: list()
          }
        }

  @doc """
  读取本会话已提交的 canonical 行；只有存在外 run 的非 base 行时才返回全序 rows
  （含当前 run），否则返回 `{:ok, nil}`（当前段局部已拥有完整顺序）。

  `application_base` 不计入历史（base 由当前 run 唯一承载，保证请求前缀稳定）。
  会话身份缺失视为「无会话历史可派生」（首轮/非会话入口，行为与 CP1 一致）；
  有会话但段头损坏/版本未知 fail-closed（不静默把它当成空历史）。
  """
  @spec fetch(map()) :: {:ok, t() | nil} | {:error, term()}
  def fetch(run) when is_map(run) do
    session_id = field(run, :session_id)

    # 无会话身份 = 无会话历史可派生（首轮/非会话入口），不是损坏。
    if nonblank?(session_id),
      do: fetch_session(session_id, field(run, :run_id)),
      else: {:ok, nil}
  end

  defp fetch_session(session_id, run_id) do
    with {:ok, %{rows: rows, refs: refs}} <- AuthoringSessionLog.fetch_session(session_id) do
      rows = Enum.reject(rows, &(&1.role == "application_base"))

      # 只有本 run 自己的已提交行时，局部段已有完整顺序，不归并自身历史 refs。
      if Enum.any?(rows, &(&1.run_id != run_id)),
        do: {:ok, %{rows: rows, refs: refs}},
        else: {:ok, nil}
    end
  end

  @doc """
  把会话已提交行与当前段拼成请求派生视图，直接返回 view。

  顺序：当前 `application_base` 最前 → 已提交非 base 行按会话 sequence 原序 →
  当前段未提交尾部。当前 run 已提交行数与本地段前缀一致（写入边界已保证不可变），
  因此用非 base 已提交计数取本地未提交尾部，不重复拼接已提交副本。

  `nil` 历史（首轮）返回原 transcript，行为与 CP1 完全一致。
  """
  @spec compose(AuthoringTranscript.t(), t() | nil) :: AuthoringTranscript.t()
  def compose(transcript, nil), do: transcript

  def compose(transcript, %{rows: rows, refs: refs}) when is_list(rows) and is_map(refs) do
    run_id = field(transcript.run, :run_id)
    {base, rest} = split_base(transcript.messages)
    committed_count = Enum.count(rows, &(field(&1, :run_id) == run_id))
    tail = Enum.drop(rest, committed_count)

    messages =
      List.wrap(base) ++ committed_messages(rows, run_id) ++ tail

    %{
      transcript
      | messages: messages,
        base_refs: merge_refs(Map.get(refs, :base_refs, []), transcript.base_refs),
        observation_refs:
          merge_refs(Map.get(refs, :observation_refs, []), transcript.observation_refs),
        used_refs: merge_refs(Map.get(refs, :used_refs, []), transcript.used_refs)
    }
  end

  defp committed_messages(rows, run_id) do
    run_ids = Enum.map(rows, &field(&1, :run_id))

    rows
    |> Enum.map(&field(&1, :message))
    |> AuthoringTranscript.normalize_messages()
    |> Enum.zip(run_ids)
    |> Enum.map(fn {message, row_run_id} ->
      if row_run_id == run_id,
        do: message,
        else: Map.put(message, @history_run_id_key, row_run_id)
    end)
  end

  @doc """
  视图消息的外 run 归属；`nil` 表示本 run 已提交行或本 run 局部新增消息。

  归属是请求视图的临时事实：只用于按 run 剥离与按 run 绑定作者回合，不持久化。
  """
  @spec session_history_run_id(map()) :: String.t() | nil
  def session_history_run_id(message) when is_map(message),
    do: Map.get(message, @history_run_id_key)

  def session_history_run_id(_message), do: nil

  @doc "按归属剥离视图中的外 run 已提交消息，恢复当前 run 段。"
  def strip_request_history(%{messages: messages} = transcript) do
    segment = Enum.reject(messages, &session_history_run_id/1)
    %{transcript | messages: segment, call_ids: RequestIR.call_ids(segment)}
  end

  def strip_request_history(transcript), do: transcript

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
