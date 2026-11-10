defmodule NovelApplication.TranscriptCompaction do
  @moduledoc """
  B71 显式压缩的唯一派生边界（VS-00L §16.2、§16.4；§18 自动维护变更提案）。

  两个派生模式：

  - `plan/1`：作者显式整理——选择当前**全部**「未覆盖且已闭合」的完整工具交换。
  - `plan_maintenance/2`：安全点自动维护（阶段 4 基础设施；触发门控于 VS-00L §18
    变更提案评审）——**保留当前工作回合**与最近 `keep_recent_items` 项已完成交换，
    只整理更早的交换。工作回合以本 run 的本地作者消息（`role == "user"` 且无外 run
    归属）为界，不按消息数；外 run 的交错作者消息不移动本 run 的当前回合起点。

  共同约束：回合范围、来源 refs 与版本复用 `RequestIR.Compaction` 的派生规则；
  不选中未完成、结果重复或已覆盖的调用；摘要只陈述真实项数与保留边界，不调用
  模型、不推断未读或已采纳事实；不改写 transcript、不写持久化、不产生 Provider 调用。

  第一个真实消费者是 `AgentRunServer` 的压缩路径；作者可见面的安全投影由既有
  `AuthoringReplay` 统一负责，本模块不回传内部 ref/call_id。
  """

  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR.Compaction

  @result_types ["observation", "validation_result"]
  @default_keep_recent_items 4
  @maintenance_scope "earlier_work_turns"
  @omissions [
    "较早的已完成操作不再逐字进入后续模型请求；原始记录仍保留在会话历史中，可回查。",
    "本次整理只折叠已完成的记录，不代表新的阅读、采纳或授权。"
  ]

  @type plan :: %{
          required(:covers) => %{call_ids: [String.t()], turn_range: String.t()},
          required(:source_refs) => [map() | String.t()],
          required(:versions) => map(),
          required(:omissions) => [String.t()],
          required(:summary) => String.t(),
          optional(:retained_items) => non_neg_integer(),
          optional(:scope) => String.t()
        }

  @doc """
  派生一次作者显式压缩的 canonical 事实（全部未覆盖完整交换）。

  没有可整理的完整交换时返回 `{:ok, :nothing_to_compact}`（产品级幂等），
  而不是错误；缺失 transcript 或非法输入如实报错。
  """
  @spec plan(AuthoringTranscript.t() | nil) ::
          {:ok, plan()} | {:ok, :nothing_to_compact} | {:error, term()}
  def plan(%{messages: messages}) when is_list(messages) do
    covered = covered_call_ids(messages)

    case select_call_ids(messages, covered) do
      [] -> {:ok, :nothing_to_compact}
      call_ids -> build_plan(messages, call_ids)
    end
  end

  def plan(_transcript), do: {:error, :transcript_not_found}

  @doc """
  派生一次安全点维护的 canonical 事实（保留当前工作回合与最近 K 项）。

  选项：`keep_recent_items`（默认 4，按已完成交换的 call 项累计；整条 assistant 消息的
  并行调用作为一个交换整体保留/整理）。没有可整理的更早交换时返回
  `{:ok, :nothing_to_compact}`。

  本函数只是派生，不触发压缩；自动触发由 VS-00L §18 评审通过后的安全点维护接入。
  """
  @spec plan_maintenance(AuthoringTranscript.t() | nil, keyword()) ::
          {:ok, plan()} | {:ok, :nothing_to_compact} | {:error, term()}
  def plan_maintenance(transcript, opts \\ [])

  def plan_maintenance(%{messages: messages}, opts)
      when is_list(messages) and is_list(opts) do
    keep = keep_recent_items(opts)
    covered = covered_call_ids(messages)
    current_turn_start = current_turn_start(messages)

    groups = exchange_groups(messages, covered)
    {earlier, current} = Enum.split_with(groups, &(&1.message_index < current_turn_start))
    {kept, selected} = split_groups(earlier, keep)

    case Enum.flat_map(selected, & &1.call_ids) do
      [] ->
        {:ok, :nothing_to_compact}

      call_ids ->
        retained_items = (kept ++ current) |> Enum.flat_map(& &1.call_ids) |> length()

        build_plan(messages, call_ids,
          retained_items: retained_items,
          scope: @maintenance_scope
        )
    end
  end

  def plan_maintenance(_transcript, _opts), do: {:error, :transcript_not_found}

  @doc "作者可见回执：只含整理项数与幂等结论；摘要/省略/来源由 AuthoringReplay 提供。"
  @spec receipt(plan() | :nothing_to_compact) :: map()
  def receipt(:nothing_to_compact), do: %{compacted: false, reason: :nothing_to_compact}

  def receipt(%{covers: %{call_ids: call_ids}}) when is_list(call_ids),
    do: %{compacted: true, covered_exchanges: length(call_ids)}

  # ── 选择器 ───────────────────────────────────────────────────────────────

  defp select_call_ids(messages, covered) do
    messages
    |> exchange_groups(covered)
    |> Enum.flat_map(& &1.call_ids)
  end

  # 一个完整交换 = 一条 assistant 消息及其全部 tool_call 的恰好一次真实结果。
  # 并行调用必须整体选择（契约禁止部分选择同一 assistant 的并行调用）；已覆盖或
  # 未闭合的组整体跳过。
  defp exchange_groups(messages, covered) do
    completed = completed_call_ids(messages)

    messages
    |> Enum.with_index()
    |> Enum.flat_map(fn {message, index} ->
      call_ids = call_ids_of(message, "tool_call")

      cond do
        call_ids == [] -> []
        Enum.any?(call_ids, &MapSet.member?(covered, &1)) -> []
        not Enum.all?(call_ids, &MapSet.member?(completed, &1)) -> []
        true -> [%{message_index: index, call_ids: call_ids}]
      end
    end)
  end

  # 当前工作回合起点 = 本 run 最后一条本地作者消息（`role == "user"`，无外 run 归属）
  # 的位置；该位置之后的交换永不进入维护范围。外 run 作者消息不能移动本 run 的
  # 保护起点。没有本地作者消息时不整理（保守失败方向）。
  defp current_turn_start(messages) do
    messages
    |> Enum.with_index()
    |> Enum.reduce(0, fn {message, index}, acc ->
      if local_author_message?(message), do: index, else: acc
    end)
  end

  defp local_author_message?(%{role: "user"} = message),
    do: is_nil(AuthoringSessionHistory.session_history_run_id(message))

  defp local_author_message?(_message), do: false

  # 从最近往前保留至少 keep 项（按 call 计），更早的组进入整理范围。
  defp split_groups(groups, keep) do
    groups
    |> Enum.reverse()
    |> Enum.reduce({[], []}, fn group, {kept, selected} ->
      if call_count(kept) >= keep,
        do: {kept, [group | selected]},
        else: {[group | kept], selected}
    end)
  end

  defp call_count(groups), do: Enum.reduce(groups, 0, &(length(&1.call_ids) + &2))

  # 一个调用可被整体整理，当且仅当它恰好有一次真实结果；重复结果是损坏历史，
  # 缺失结果是未完成交换，都不进入压缩范围。
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

  defp keep_recent_items(opts) do
    case Keyword.get(opts, :keep_recent_items, @default_keep_recent_items) do
      value when is_integer(value) and value >= 0 -> value
      _other -> @default_keep_recent_items
    end
  end

  # ── plan 构造 / 证据派生 ─────────────────────────────────────────────────

  defp build_plan(messages, call_ids, extra \\ []) do
    with {:ok, turn_range} <-
           Compaction.turn_range(
             messages,
             call_ids,
             &AuthoringSessionHistory.session_history_run_id/1
           ) do
      {source_refs, versions} = Compaction.evidence(messages, call_ids)

      base = %{
        covers: %{call_ids: call_ids, turn_range: turn_range},
        source_refs: source_refs,
        versions: versions,
        omissions: @omissions,
        summary: "已整理本次任务较早的 #{length(call_ids)} 项已完成操作；这些记录的真实来源与版本仍按原记录保留。"
      }

      {:ok, Enum.into(extra, base)}
    end
  end
end
