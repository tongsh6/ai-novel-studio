defmodule NovelCommon.RequestIR.Compaction do
  @moduledoc """
  从追加式 canonical 历史派生显式压缩视图（VS-00L §16.2.1）。

  call_ids 选择完整工具交换；message_refs 选择有真实坐标、来源与版本的旧 Scope
  或纯讨论。原文永久保留，turn_range 只作说明，不能作为省略选择器。
  """
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.DiscussionSummary
  alias NovelCommon.RequestIR.MessageCoverage

  @result_types ~w(observation validation_result)

  defdelegate discussion_version(), to: DiscussionSummary, as: :version
  defdelegate discussion_material(sources), to: DiscussionSummary, as: :material
  defdelegate discussion_source_key(source, scope), to: DiscussionSummary, as: :source_key

  defdelegate valid_discussion_source_key?(key, scope),
    to: DiscussionSummary,
    as: :valid_source_key?

  defdelegate validate_discussion(discussion, sources), to: DiscussionSummary, as: :validate

  @doc "核对已通过 RequestIR 形状校验的消息所声明的压缩事实。"
  @spec validate([map()]) :: :ok | {:error, atom()}
  def validate(messages) do
    messages
    |> Enum.reduce_while({[], MapSet.new(), MapSet.new()}, &validate_message/2)
    |> case do
      {:error, _} = error -> error
      {_history, _calls, _messages} -> :ok
    end
  end

  @doc "对已校验的历史生成 Provider 视图；没有合法 checkpoint 就没有过滤。"
  @spec project([map()]) :: [map()]
  def project(messages) do
    blocks = Enum.flat_map(messages, &checkpoint_blocks/1)
    calls = MapSet.new(Enum.flat_map(blocks, &Map.get(&1.covers, :call_ids, [])))

    references =
      blocks
      |> Enum.flat_map(&Map.get(&1.covers, :message_refs, []))
      |> MapSet.new(&MessageCoverage.key/1)

    Enum.reject(messages, fn message ->
      ids = exchange_ids(message)

      MapSet.member?(references, MessageCoverage.key(MessageCoverage.identity(message))) or
        (ids != [] and Enum.all?(ids, &MapSet.member?(calls, &1)))
    end)
  end

  @doc "至少一类精确选择器非空；两类各自唯一，范围文字不能替代选择器。"
  def require_selection(%{call_ids: ids, message_refs: refs} = covers) do
    cond do
      not unique_strings?(ids) ->
        {:error, :checkpoint_invalid_call_ids}

      not is_list(refs) or not Enum.all?(refs, &MessageCoverage.valid_selector?/1) ->
        {:error, :checkpoint_invalid_message_refs}

      length(Enum.uniq_by(refs, &MessageCoverage.key/1)) != length(refs) ->
        {:error, :checkpoint_duplicate_message_refs}

      ids == [] and refs == [] ->
        {:error, :checkpoint_selection_required}

      Enum.any?(Map.keys(covers), &(&1 not in [:call_ids, :message_refs, :turn_range])) ->
        {:error, :checkpoint_invalid_selection}

      true ->
        :ok
    end
  end

  def require_selection(_covers), do: {:error, :checkpoint_selection_required}

  defp unique_strings?(ids) when is_list(ids),
    do:
      Enum.all?(ids, &(is_binary(&1) and String.valid?(&1) and String.trim(&1) != "")) and
        length(Enum.uniq(ids)) == length(ids)

  defp unique_strings?(_ids), do: false

  @doc "由真实选中源生成单次摘要输入；不读取存储，也不运行模型。"
  def discussion_sources(messages, covers) do
    with {:ok, selected} <- MessageCoverage.resolve(messages, Map.get(covers, :message_refs, [])) do
      {:ok, MessageCoverage.discussion_sources(messages, selected)}
    end
  end

  @doc "从选中来源的作者回合派生范围；归属分别绑定，不混用交错 run 的最后作者。"
  def turn_range(messages, covers, attribution) when is_function(attribution, 1) do
    ids = MapSet.new(Map.get(covers, :call_ids, []))

    {_owners, call_turns} =
      messages
      |> Enum.with_index()
      |> Enum.reduce({%{}, []}, fn {message, index}, {owners, turns} ->
        accumulate_turn(message, index, attribution.(message), ids, owners, turns)
      end)

    with {:ok, selected} <- MessageCoverage.resolve(messages, Map.get(covers, :message_refs, [])),
         {:ok, message_turns} <- MessageCoverage.turn_positions(messages, selected) do
      turns = call_turns ++ message_turns

      if turns == [] or Enum.any?(turns, &match?({_index, nil}, &1)) do
        {:error, :checkpoint_turn_range_unavailable}
      else
        first = turns |> Enum.min_by(&elem(&1, 0)) |> elem(1)
        last = turns |> Enum.max_by(&elem(&1, 0)) |> elem(1)
        {:ok, if(first == last, do: first, else: first <> ".." <> last)}
      end
    end
  end

  defp accumulate_turn(
         %{role: "user", provenance: "author"} = message,
         index,
         owner,
         _selected,
         owners,
         turns
       ),
       do: {Map.put(owners, owner, {index, author_turn_ref(message)}), turns}

  defp accumulate_turn(%{role: "assistant"} = message, _index, owner, selected, owners, turns) do
    if Enum.any?(block_ids([message], ["tool_call"]), &MapSet.member?(selected, &1)),
      do: {owners, [Map.get(owners, owner, {nil, nil}) | turns]},
      else: {owners, turns}
  end

  defp accumulate_turn(_message, _index, _owner, _selected, owners, turns), do: {owners, turns}

  defp author_turn_ref(%{source_refs: [ref]}) do
    case reference_identity(ref) do
      {id, _} when is_binary(id) -> if String.trim(id) != "", do: id
      _ -> nil
    end
  end

  defp author_turn_ref(_message), do: nil

  defp validate_message(message, {history, covered_calls, covered_messages}) do
    owner = get_in(message, [:canonical_ref, :run_id])

    result =
      Enum.reduce_while(
        checkpoint_blocks(message),
        {:ok, covered_calls, covered_messages},
        fn block, {:ok, calls, references} ->
          case validate_checkpoint(block, Enum.reverse(history), owner, calls, references) do
            {:ok, next_calls, next_references} -> {:cont, {:ok, next_calls, next_references}}
            {:error, _} = error -> {:halt, error}
          end
        end
      )

    case result do
      {:ok, calls, references} -> {:cont, {[message | history], calls, references}}
      {:error, _} = error -> {:halt, error}
    end
  end

  defp validate_checkpoint(block, messages, owner, covered_calls, covered_messages) do
    covers = block.covers
    ids = Map.get(covers, :call_ids, [])
    references = Map.get(covers, :message_refs, [])
    keys = MapSet.new(references, &MessageCoverage.key/1)

    with :ok <- require_selection(covers),
         :ok <- validate_calls(ids, messages, covered_calls, owner),
         true <- MapSet.disjoint?(keys, covered_messages),
         {:ok, selected} <- MessageCoverage.resolve(messages, references),
         :ok <-
           MessageCoverage.validate_turn_coverage(
             messages,
             selected ++ selected_exchange_sources(messages, ids),
             owner
           ),
         true <- Enum.all?(selected, &MessageCoverage.eligible?(&1, messages, owner)),
         :ok <- validate_omissions(block),
         :ok <- validate_evidence(block, messages),
         :ok <-
           DiscussionSummary.validate(
             Map.get(block, :discussion),
             MessageCoverage.discussion_sources(messages, selected)
           ) do
      {:ok, MapSet.union(covered_calls, MapSet.new(ids)), MapSet.union(covered_messages, keys)}
    else
      false -> {:error, :checkpoint_protected_or_repeated_message}
      {:error, _} = error -> error
    end
  end

  defp validate_calls(ids, messages, covered, owner) do
    selected = MapSet.new(ids)
    calls = block_ids(messages, ["tool_call"])
    results = block_ids(messages, @result_types)

    cond do
      not MapSet.disjoint?(selected, covered) ->
        {:error, :checkpoint_already_applied}

      not Enum.all?(ids, &(&1 in calls)) ->
        {:error, :checkpoint_unknown_call}

      not complete_results?(ids, results) ->
        {:error, :checkpoint_incomplete_exchange}

      partial_message?(messages, selected) ->
        {:error, :checkpoint_partial_message}

      Enum.any?(
        messages,
        &(selected_exchange?(&1, selected) and not exchange_eligible?(&1, owner))
      ) ->
        {:error, :checkpoint_protected_exchange}

      true ->
        :ok
    end
  end

  @doc "活动外 run 与提问交换保留；关闭工具协议不等于解除作者问题。"
  def exchange_eligible?(message, owner) do
    ref = Map.get(message, :canonical_ref, %{})

    foreign_active =
      Map.get(ref, :run_id) not in [nil, owner] and
        Map.get(ref, :run_status) != "completed"

    asks_author =
      Enum.any?(
        Map.get(message, :blocks, []),
        &(Map.get(&1, :type) == "tool_call" and Map.get(&1, :name) == "ask_author")
      )

    not foreign_active and not asks_author
  end

  defp selected_exchange_sources(messages, ids) do
    selected = MapSet.new(ids)

    for {message, index} <- Enum.with_index(messages),
        selected_exchange?(message, selected),
        do: %{message: message, index: index}
  end

  defp selected_exchange?(message, selected),
    do: Enum.any?(block_ids([message], ["tool_call"]), &MapSet.member?(selected, &1))

  defp complete_results?(ids, results) do
    frequencies = Enum.frequencies(results)
    Enum.all?(ids, &(Map.get(frequencies, &1) == 1))
  end

  defp partial_message?(messages, selected) do
    Enum.any?(messages, fn message ->
      ids = message |> exchange_ids() |> MapSet.new()
      not MapSet.disjoint?(ids, selected) and not MapSet.subset?(ids, selected)
    end)
  end

  defp validate_omissions(%{omissions: [_ | _]}), do: :ok
  defp validate_omissions(_), do: {:error, :checkpoint_omissions_required}

  @doc "工具观察与消息原始来源共同构成证据；消息版本保留在各选择器，不作覆盖式合并。"
  def evidence(messages, covers) do
    selected = MapSet.new(Map.get(covers, :call_ids, []))

    observations =
      for message <- messages,
          block <- Map.get(message, :blocks, []),
          Map.get(block, :type) == "observation",
          MapSet.member?(selected, Map.get(block, :call_id)),
          do: block

    payloads = Enum.flat_map(observations, &RequestIR.observation_payloads/1)
    references = Map.get(covers, :message_refs, [])

    refs =
      Enum.flat_map(payloads, &Map.get(&1, :source_refs, [])) ++
        Enum.flat_map(
          references,
          &(Map.get(&1, :source_refs, []) ++ [MessageCoverage.source_ref(&1)])
        )

    versions = Enum.reduce(payloads, %{}, &Map.merge(&2, Map.get(&1, :versions, %{})))
    {refs, versions}
  end

  defp validate_evidence(block, messages) do
    {refs, versions} = evidence(messages, block.covers)

    if reference_identities(refs) == reference_identities(Map.get(block, :source_refs, [])) and
         RequestIR.json_value(versions) == RequestIR.json_value(Map.get(block, :versions, %{})),
       do: :ok,
       else: {:error, :checkpoint_evidence_mismatch}
  end

  defp reference_identities(refs), do: MapSet.new(refs, &reference_identity/1)

  defp reference_identity(ref) when is_map(ref),
    do:
      {Map.get(ref, :ref) || Map.get(ref, "ref"),
       Map.get(ref, :version) || Map.get(ref, "version")}

  defp reference_identity(ref), do: {ref, nil}

  defp checkpoint_blocks(%{role: "checkpoint", blocks: blocks}),
    do: Enum.filter(blocks, &(Map.get(&1, :type) == "checkpoint"))

  defp checkpoint_blocks(_message), do: []

  defp exchange_ids(%{role: role} = message) when role in ["assistant", "tool"],
    do: block_ids([message], ["tool_call" | @result_types])

  defp exchange_ids(_message), do: []

  defp block_ids(messages, types) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) in types,
        do: Map.get(block, :call_id)
  end
end
