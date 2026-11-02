defmodule NovelApplication.TranscriptCompaction do
  @moduledoc """
  B71 显式压缩的唯一派生边界（VS-00L §16.2、§16.4）。

  只从 canonical transcript 的事实派生作者显式压缩所需的内容：

  - 选择当前全部「未覆盖且已闭合」的完整工具交换，不按消息数/字符数/上下文
    规模设置阈值；作者意图就是「把已经完成的整理掉」。
  - 来源 refs 与版本逐字取自选中观察，与 `RequestIR.Compaction` 的证据校验同构；
    不选中未完成、结果重复或已覆盖的调用。
  - 摘要只陈述已整理项数与保留边界，不调用模型、不推断未读或已采纳事实。
  - 不改写 transcript、不写持久化、不产生 Provider 调用或运行事件。

  第一个真实消费者是 `AgentRunServer` 的作者显式压缩命令；作者可见面的安全投影
  由既有 `AuthoringReplay` 统一负责，本模块不回传内部 ref/call_id。
  """

  alias NovelApplication.AuthoringTranscript

  @result_types ["observation", "validation_result"]
  @omissions [
    "较早的已完成操作不再逐字进入后续模型请求；原始记录仍保留在会话历史中，可回查。",
    "本次整理只折叠已完成的记录，不代表新的阅读、采纳或授权。"
  ]

  @type plan :: %{
          covers: %{call_ids: [String.t()]},
          source_refs: [map() | String.t()],
          versions: map(),
          omissions: [String.t()],
          summary: String.t()
        }

  @doc """
  派生一次显式压缩的 canonical 事实。

  没有可整理的完整交换时返回 `{:ok, :nothing_to_compact}`（产品级幂等），
  而不是错误；缺失 transcript 或非法输入如实报错。
  """
  @spec plan(AuthoringTranscript.t() | nil) ::
          {:ok, plan()} | {:ok, :nothing_to_compact} | {:error, term()}
  def plan(%{messages: messages}) when is_list(messages) do
    covered = covered_call_ids(messages)

    case select_call_ids(messages, covered) do
      [] ->
        {:ok, :nothing_to_compact}

      call_ids ->
        {source_refs, versions} = evidence(messages, call_ids)

        {:ok,
         %{
           covers: %{call_ids: call_ids},
           source_refs: source_refs,
           versions: versions,
           omissions: @omissions,
           summary:
             "已整理本次任务较早的 #{length(call_ids)} 项已完成操作；这些记录的真实来源与版本仍按原记录保留。"
         }}
    end
  end

  def plan(_transcript), do: {:error, :transcript_not_found}

  @doc "作者可见回执：只含整理项数与幂等结论；摘要/省略/来源由 AuthoringReplay 提供。"
  @spec receipt(plan() | :nothing_to_compact) :: map()
  def receipt(:nothing_to_compact), do: %{compacted: false, reason: :nothing_to_compact}

  def receipt(%{covers: %{call_ids: call_ids}}) when is_list(call_ids),
    do: %{compacted: true, covered_exchanges: length(call_ids)}

  # ── 选择器 ───────────────────────────────────────────────────────────────

  defp select_call_ids(messages, covered) do
    completed = completed_call_ids(messages)

    messages
    |> Enum.filter(&(Map.get(&1, :role) == "assistant"))
    |> Enum.flat_map(fn message ->
      call_ids = call_ids_of(message, "tool_call")

      cond do
        call_ids == [] -> []
        Enum.any?(call_ids, &MapSet.member?(covered, &1)) -> []
        not Enum.all?(call_ids, &MapSet.member?(completed, &1)) -> []
        true -> call_ids
      end
    end)
  end

  # 一个调用可被整体整理，当且仅当它恰好有一次真实结果；重复结果是损坏历史，
  # 缺失结果是未完成交换，都不进入作者显式整理范围。
  defp completed_call_ids(messages) do
    messages
    |> Enum.flat_map(&call_ids_of(&1, @result_types))
    |> Enum.frequencies()
    |> Enum.flat_map(fn {call_id, count} -> if count == 1, do: [call_id], else: [] end)
    |> MapSet.new()
  end

  defp covered_call_ids(messages) do
    messages
    |> Enum.filter(&(Map.get(&1, :role) == "checkpoint"))
    |> Enum.flat_map(&checkpoint_call_ids/1)
    |> MapSet.new()
  end

  defp checkpoint_call_ids(message) do
    for block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "checkpoint",
        call_id <- get_in(block, [:covers, :call_ids]) || [],
        do: call_id
  end

  defp call_ids_of(message, types) do
    for block <- Map.get(message, :blocks, []),
        Map.get(block, :type) in List.wrap(types),
        call_id when is_binary(call_id) <- [Map.get(block, :call_id)],
        do: call_id
  end

  # ── 证据派生 ─────────────────────────────────────────────────────────────

  # 与 `RequestIR.Compaction.validate_evidence/3` 同构：只看选中观察的 source_refs 与
  # versions，顺序与合并方式保持一致，避免派生与校验对同一事实给出不同结果。
  defp evidence(messages, call_ids) do
    selected = MapSet.new(call_ids)

    observations =
      for message <- messages,
          block <- Map.get(message, :blocks, []),
          Map.get(block, :type) == "observation",
          MapSet.member?(selected, Map.get(block, :call_id)),
          do: block

    source_refs = Enum.flat_map(observations, &(Map.get(&1, :source_refs) || []))

    versions =
      Enum.reduce(observations, %{}, fn block, acc ->
        Map.merge(acc, Map.get(block, :versions) || %{})
      end)

    {source_refs, versions}
  end
end
