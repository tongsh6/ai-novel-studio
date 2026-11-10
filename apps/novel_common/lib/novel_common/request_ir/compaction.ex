defmodule NovelCommon.RequestIR.Compaction do
  @moduledoc """
  B71：从追加式 canonical 历史派生显式压缩视图（VS-00L §16.2）。

  checkpoint 以 call_ids 精确选择已经闭合的完整交换。原始消息始终留在
  transcript 中；只有 Provider 投影视图省略这些消息，恢复和回查不依赖摘要。
  仅带 turn_range 的历史 checkpoint 是说明事实，不授权删除任何消息。
  """

  @result_types ~w(observation validation_result)

  @spec validate([map()]) :: :ok | {:error, atom()}
  def validate(messages) do
    messages
    |> Enum.reduce_while({[], MapSet.new()}, &validate_message/2)
    |> case do
      {:error, _} = error -> error
      {_history, _covered} -> :ok
    end
  end

  @doc "对已校验的 canonical 历史生成 Provider 消息视图，不改写或复制原始事实。"
  @spec project([map()]) :: [map()]
  def project(messages) do
    covered =
      for message <- messages,
          block <- checkpoint_blocks(message),
          id <- Map.get(Map.get(block, :covers, %{}), :call_ids, []),
          into: MapSet.new(),
          do: id

    Enum.reject(messages, fn message ->
      ids = exchange_ids(message)
      ids != [] and Enum.all?(ids, &MapSet.member?(covered, &1))
    end)
  end

  @doc "实际压缩必须有明确调用选择器；纯范围说明仅供历史兼容读取。"
  @spec require_call_ids(map()) :: :ok | {:error, atom()}
  def require_call_ids(%{call_ids: ids}) when is_list(ids) and ids != [] do
    if Enum.all?(ids, &(is_binary(&1) and &1 != "")) and length(Enum.uniq(ids)) == length(ids),
      do: :ok,
      else: {:error, :checkpoint_invalid_call_ids}
  end

  def require_call_ids(%{call_ids: _}), do: {:error, :checkpoint_invalid_call_ids}
  def require_call_ids(_), do: {:error, :checkpoint_call_ids_required}

  @doc "从选中调用所在的作者回合派生首末范围；只有 call_ids 决定投影折叠。"
  @spec turn_range([map()], [String.t()]) :: {:ok, String.t()} | {:error, atom()}
  def turn_range(messages, ids) do
    selected = MapSet.new(ids)

    {_, turns} =
      Enum.reduce(messages, {nil, []}, fn
        %{role: "user", provenance: "author"} = message, {_, turns} ->
          {author_turn_ref(message), turns}

        %{role: "assistant"} = message, {turn, turns} ->
          if Enum.any?(block_ids([message], ["tool_call"]), &MapSet.member?(selected, &1)),
            do: {turn, [turn | turns]},
            else: {turn, turns}

        _, acc ->
          acc
      end)

    case turns do
      [last | _] ->
        if nil in turns,
          do: {:error, :checkpoint_turn_range_unavailable},
          else: {:ok, format_range(List.last(turns), last)}

      [] ->
        {:error, :checkpoint_turn_range_unavailable}
    end
  end

  defp author_turn_ref(%{source_refs: [ref]}) do
    case reference_identity(ref) do
      {id, _} when is_binary(id) -> if String.trim(id) != "", do: id
      _ -> nil
    end
  end

  defp author_turn_ref(_message), do: nil

  defp format_range(first, first), do: first
  defp format_range(first, last), do: first <> ".." <> last

  defp validate_message(message, {history, covered}) do
    result =
      Enum.reduce_while(checkpoint_blocks(message), {:ok, covered}, fn block, {:ok, previous} ->
        case validate_checkpoint(block, history, previous) do
          {:ok, next} -> {:cont, {:ok, next}}
          {:error, _} = error -> {:halt, error}
        end
      end)

    case result do
      {:ok, next} -> {:cont, {[message | history], next}}
      {:error, _} = error -> {:halt, error}
    end
  end

  defp validate_checkpoint(%{covers: %{call_ids: ids} = covers} = block, history, covered) do
    messages = Enum.reverse(history)

    with :ok <- require_call_ids(covers),
         :ok <- validate_selection(ids, history, covered),
         :ok <- validate_omissions(block),
         :ok <- validate_evidence(block, ids, messages) do
      {:ok, MapSet.union(covered, MapSet.new(ids))}
    end
  end

  defp validate_checkpoint(_block, _history, covered), do: {:ok, covered}

  defp validate_selection(ids, history, covered) do
    selected = MapSet.new(ids)
    calls = block_ids(history, ["tool_call"])
    results = block_ids(history, @result_types)

    cond do
      not MapSet.disjoint?(selected, covered) -> {:error, :checkpoint_already_applied}
      not Enum.all?(ids, &(&1 in calls)) -> {:error, :checkpoint_unknown_call}
      not complete_results?(ids, results) -> {:error, :checkpoint_incomplete_exchange}
      partial_message?(history, selected) -> {:error, :checkpoint_partial_message}
      true -> :ok
    end
  end

  defp complete_results?(ids, results) do
    frequencies = Enum.frequencies(results)
    Enum.all?(ids, &(Map.get(frequencies, &1) == 1))
  end

  defp partial_message?(history, selected) do
    Enum.any?(history, fn message ->
      ids = message |> exchange_ids() |> MapSet.new()
      not MapSet.disjoint?(ids, selected) and not MapSet.subset?(ids, selected)
    end)
  end

  defp validate_omissions(%{omissions: [_ | _]}), do: :ok
  defp validate_omissions(_), do: {:error, :checkpoint_omissions_required}

  @doc "从选中观察提取原始来源和版本，供规划和校验共同使用。"
  @spec evidence([map()], [String.t()]) :: {[map() | String.t()], map()}
  def evidence(messages, ids) do
    selected = MapSet.new(ids)

    observations =
      for message <- messages,
          observation <- Map.get(message, :blocks, []),
          Map.get(observation, :type) == "observation",
          MapSet.member?(selected, Map.get(observation, :call_id)),
          do: observation

    refs = Enum.flat_map(observations, &Map.get(&1, :source_refs, []))
    versions = Enum.reduce(observations, %{}, &Map.merge(&2, Map.get(&1, :versions, %{})))
    {refs, versions}
  end

  defp validate_evidence(block, ids, messages) do
    {refs, versions} = evidence(messages, ids)

    if reference_identities(refs) == reference_identities(Map.get(block, :source_refs, [])) and
         versions == Map.get(block, :versions, %{}),
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
