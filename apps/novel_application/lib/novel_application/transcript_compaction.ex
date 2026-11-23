defmodule NovelApplication.TranscriptCompaction do
  @moduledoc """
  会话压缩的唯一确定性规划边界（VS-00L §16.2.1）。

  当前工作回合、最近 K 项、活动外 run 和提问交换始终保留。较早的完整工具组、
  有效替代的 Scope、已结束 run 的纯讨论使用同一 covers；纯讨论原文仅交给
  TranscriptCompactionSummary 作一次有界摘要，本模块不执行模型、不写存储。
  """
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.MessageCoverage

  @result_types ["observation", "validation_result"]
  @default_keep_recent_items 4
  @max_discussion_sources 4
  @omissions [
    "已整理的较早操作、旧范围与讨论正文不再逐字进入后续请求；完整原文仍保留在会话历史，可按来源回查。",
    "历史讨论摘要属于模型派生内容；整理不代表新的阅读、事实确认、采纳、授权或承诺已经履行。"
  ]

  @type plan :: %{
          required(:covers) => map(),
          required(:source_refs) => [map() | String.t()],
          required(:versions) => map(),
          required(:omissions) => [String.t()],
          required(:summary) => String.t(),
          required(:discussion_sources) => [map()],
          required(:retained_items) => non_neg_integer(),
          required(:scope) => String.t(),
          optional(:history_target) => map()
        }

  @doc "应用内显式整理与自动维护共用保护集；调用方不能指定任意删选范围。"
  @spec plan(AuthoringTranscript.t() | nil) ::
          {:ok, plan() | :nothing_to_compact} | {:error, term()}
  def plan(transcript), do: plan_maintenance(transcript)

  @doc "保留当前工作回合与最近 K 项；并行工具调用按完整消息保留，纯讨论按一项计。"
  @spec plan_maintenance(AuthoringTranscript.t() | nil, keyword()) ::
          {:ok, plan() | :nothing_to_compact} | {:error, term()}
  def plan_maintenance(transcript, opts \\ [])

  def plan_maintenance(%{messages: messages} = transcript, opts)
      when is_list(messages) and is_list(opts) do
    with {:ok, ir} <- AuthoringTranscript.to_request_ir(transcript),
         {:ok, {current_start, _}} <-
           MessageCoverage.current_turn_position(ir.messages, field(ir.run, :run_id)) do
      select_plan(ir, opts, current_start)
    end
  end

  def plan_maintenance(_transcript, _opts), do: {:error, :transcript_not_found}

  defp select_plan(ir, opts, current_start) do
    messages = ir.messages
    owner = field(ir.run, :run_id)
    {covered_calls, covered_messages} = covered(messages)
    groups = item_groups(messages, covered_calls, covered_messages)
    {earlier, current} = Enum.split_with(groups, &(&1.index < current_start))
    {kept, older} = split_groups(earlier, max(keep_recent_items(opts) - item_count(current), 0))
    owned = opts |> Keyword.get(:owned_source_keys, []) |> MapSet.new()

    selected =
      older
      |> Enum.filter(&compactable?(&1, messages, owner))
      |> bound_discussions(messages, ir.run, owned)

    with {:ok, protected_turns} <- turn_indices(messages, kept ++ current),
         {:ok, scopes} <-
           select_scopes(
             messages,
             covered_messages,
             owner,
             current_start,
             MapSet.put(protected_turns, current_start)
           ) do
      build_plan(messages, selected, scopes, item_count(groups) - item_count(selected))
    end
  end

  @doc "作者回执只包含真实覆盖类别数量；原文来源导航复用 Interaction。"
  def receipt(:nothing_to_compact), do: %{compacted: false, reason: :nothing_to_compact}
  def receipt(%{covers: covers}), do: %{compacted: true, covered_counts: counts(covers)}

  def counts(covers) do
    refs = Map.get(covers, :message_refs, [])

    %{
      tool_exchanges: length(Map.get(covers, :call_ids, [])),
      scope_updates: Enum.count(refs, &(&1.role == "scope_update")),
      discussion_messages: Enum.count(refs, &(&1.role == "assistant"))
    }
  end

  defp item_groups(messages, covered_calls, covered_messages) do
    completed =
      messages
      |> Enum.flat_map(&call_ids_of(&1, @result_types))
      |> Enum.frequencies()

    messages
    |> Enum.with_index()
    |> Enum.flat_map(fn {message, index} ->
      ids = call_ids_of(message, ["tool_call"])
      candidate = %{message: message, index: index, call_ids: ids}

      cond do
        ids != [] and
            Enum.all?(
              ids,
              &(Map.get(completed, &1) == 1 and not MapSet.member?(covered_calls, &1))
            ) ->
          [candidate]

        MessageCoverage.discussion?(message, messages, index) and
            not MapSet.member?(
              covered_messages,
              MessageCoverage.key(MessageCoverage.identity(message))
            ) ->
          [candidate]

        true ->
          []
      end
    end)
  end

  # 最近 K 在真实工具交换与未被拒收的讨论中计数；拒收原件和回执始终留在历史。
  defp compactable?(%{call_ids: []} = group, messages, owner),
    do: MessageCoverage.eligible?(group, messages, owner)

  defp compactable?(group, _messages, owner),
    do: Compaction.exchange_eligible?(group.message, owner)

  defp select_scopes(messages, covered, owner, current_start, protected_turns) do
    messages
    |> Enum.with_index()
    |> Enum.map(fn {message, index} -> %{message: message, index: index} end)
    |> Enum.filter(fn %{message: message, index: index} = candidate ->
      message.role == "scope_update" and index < current_start and
        not MapSet.member?(covered, MessageCoverage.key(MessageCoverage.identity(message))) and
        MessageCoverage.eligible?(candidate, messages, owner)
    end)
    |> Enum.reduce_while({:ok, []}, fn candidate, {:ok, scopes} ->
      with {:ok, turns} <- turn_indices(messages, [candidate]),
           true <- MapSet.disjoint?(turns, protected_turns) do
        {:cont, {:ok, [candidate | scopes]}}
      else
        false -> {:cont, {:ok, scopes}}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp split_groups(groups, keep) do
    groups
    |> Enum.reverse()
    |> Enum.reduce({[], []}, fn group, {kept, selected} ->
      if item_count(kept) >= keep,
        do: {kept, [group | selected]},
        else: {[group | kept], selected}
    end)
  end

  defp bound_discussions(groups, messages, scope, owned) do
    owned_messages =
      messages
      |> MessageCoverage.discussion_sources(groups)
      |> Enum.filter(&MapSet.member?(owned, Compaction.discussion_source_key(&1, scope)))
      |> MapSet.new(&MessageCoverage.key(&1.source))

    {selected, _count} =
      Enum.reduce(groups, {[], 0}, fn group, {selected, count} ->
        cond do
          group.call_ids != [] ->
            {[group | selected], count}

          MapSet.member?(
            owned_messages,
            MessageCoverage.key(MessageCoverage.identity(group.message))
          ) ->
            {selected, count}

          count >= @max_discussion_sources ->
            {selected, count}

          discussion_fits?(messages, [group | selected]) ->
            {[group | selected], count + 1}

          true ->
            {selected, count}
        end
      end)

    Enum.reverse(selected)
  end

  defp discussion_fits?(messages, reversed) do
    sources = MessageCoverage.discussion_sources(messages, Enum.reverse(reversed))
    match?({:ok, _material}, Compaction.discussion_material(sources))
  end

  defp item_count(groups),
    do: Enum.reduce(groups, 0, &(max(length(Map.get(&1, :call_ids, [])), 1) + &2))

  defp turn_indices(messages, groups) do
    with {:ok, turns} <- MessageCoverage.turn_positions(messages, groups) do
      {:ok, MapSet.new(turns, &elem(&1, 0))}
    end
  end

  defp covered(messages) do
    blocks =
      for message <- messages,
          message.role == "checkpoint",
          block <- message.blocks,
          block.type == "checkpoint",
          do: block

    calls = MapSet.new(Enum.flat_map(blocks, &Map.get(&1.covers, :call_ids, [])))

    refs =
      blocks
      |> Enum.flat_map(&Map.get(&1.covers, :message_refs, []))
      |> MapSet.new(&MessageCoverage.key/1)

    {calls, refs}
  end

  defp call_ids_of(message, types) do
    for block <- Map.get(message, :blocks, []),
        Map.get(block, :type) in types,
        id when is_binary(id) <- [Map.get(block, :call_id)],
        do: id
  end

  defp keep_recent_items(opts) do
    case Keyword.get(opts, :keep_recent_items, @default_keep_recent_items) do
      value when is_integer(value) and value >= 0 -> value
      _ -> @default_keep_recent_items
    end
  end

  defp build_plan(_messages, [], [], _retained), do: {:ok, :nothing_to_compact}

  defp build_plan(messages, groups, scopes, retained) do
    selections = Enum.sort_by(groups ++ scopes, & &1.index)

    refs =
      selections
      |> Enum.filter(&(Map.get(&1, :call_ids, []) == []))
      |> Enum.map(&MessageCoverage.selector(&1.message))

    covers = %{call_ids: Enum.flat_map(groups, & &1.call_ids), message_refs: refs}

    with :ok <- Compaction.require_selection(covers),
         {:ok, range} <-
           Compaction.turn_range(messages, covers, &get_in(&1, [:canonical_ref, :run_id])),
         {:ok, sources} <- Compaction.discussion_sources(messages, covers),
         {:ok, target} <- history_target(hd(selections).message) do
      {source_refs, versions} = Compaction.evidence(messages, covers)
      counts = counts(covers)

      {:ok,
       %{
         covers: Map.put(covers, :turn_range, range),
         source_refs: source_refs,
         versions: versions,
         omissions: @omissions,
         summary:
           "已整理 #{counts.tool_exchanges} 项已完成操作、#{counts.scope_updates} 项旧范围和 #{counts.discussion_messages} 条较早讨论；原始来源与各自版本仍保留。",
         discussion_sources: sources,
         retained_items: retained,
         scope: "earlier_work_turns",
         history_target: target
       }}
    end
  end

  defp history_target(message) do
    reference = Map.get(message, :canonical_ref, %{})
    session = Map.get(reference, :session_id)
    turn = Map.get(reference, :parent_turn_ref)

    if Enum.all?([session, turn], &(is_binary(&1) and String.trim(&1) != "")),
      do: {:ok, %{session_id: session, turn_id: turn}},
      else: {:error, :checkpoint_history_target_unavailable}
  end

  defp field(map, key), do: Map.get(map, key) || Map.get(map, to_string(key))
end
