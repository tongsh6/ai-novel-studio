defmodule NovelPersistence.MemoryRecallRepo do
  @moduledoc """
  Read-side recall query for governed memory.

  This module only returns memory that is safe for ordinary dialogue context:
  current work, confirmed/stabilized status, and explicitly recallable.
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene

  @confirmed_statuses [MemoryStatus.confirmed(), MemoryStatus.stabilized()]
  @default_limit 5

  @type recalled_memory :: %{
          id: String.t(),
          content: String.t(),
          summary: String.t() | nil,
          type: String.t(),
          scope: String.t(),
          status: String.t(),
          weight: float(),
          confidence: float(),
          score: float()
        }

  @spec recall(String.t(), String.t() | nil, keyword()) :: [recalled_memory()]
  def recall(work_id, query, opts \\ []) when is_binary(work_id) do
    limit = Keyword.get(opts, :limit, @default_limit)

    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        # 当前叙事位置 = 作品已采纳正文的最大章节序号（作者写到哪了）。
        # 有效期窗口外的设定不进入普通召回（AU09-I6）。valid_from/until.chapter_id 是
        # 章节 UUID（NarrativePosition，05-memory-retention §8.2），经 chapter_seq_map
        # 解析到同一 seq 排序空间后与 current_position 比较。
        current_position = current_chapter_position(uuid)
        chapter_seq_map = chapter_seq_map(uuid)

        uuid
        |> base_query()
        |> Repo.all()
        |> Enum.filter(&within_validity_window?(&1, current_position, chapter_seq_map))
        |> Enum.map(&score_memory(&1, query))
        |> Enum.filter(&recall_match?/1)
        |> Enum.sort_by(&{-&1.score, -&1.weight, -&1.confidence, &1.summary || &1.content})
        |> Enum.take(limit)
        |> Enum.map(&Map.drop(&1, [:overlap, :valid_from, :valid_until]))

      :error ->
        []
    end
  end

  @doc "当前叙事位置：作品已采纳正文的最大章节序号；无已采纳章节时返回 nil。"
  @spec current_chapter_position(Ecto.UUID.t()) :: integer() | nil
  def current_chapter_position(work_id) do
    accepted = AdoptionStatus.accepted()

    Chapter
    |> join(:inner, [c], s in Scene, on: s.chapter_id == c.id and s.work_id == ^work_id)
    |> join(:inner, [_c, s], d in Draft,
      on: d.scene_id == s.id and d.work_id == ^work_id and d.status == ^accepted
    )
    |> where([c], c.work_id == ^work_id)
    |> select([c], max(c.seq))
    |> Repo.one()
  end

  # 作品所有章节的 id → seq 映射，用于把窗口边界的 chapter_id（UUID）解析到 seq 排序空间。
  defp chapter_seq_map(work_id) do
    Chapter
    |> where([c], c.work_id == ^work_id)
    |> select([c], {c.id, c.seq})
    |> Repo.all()
    |> Map.new()
  end

  # 有效期窗口判定：valid_from/valid_until.chapter_id 是章节 UUID，解析为该章 seq 后
  # 与 current_position（最大已采纳章节 seq）比较。无可定位窗口的设定永远可召回；
  # 当前位置未知时不限制；边界 chapter_id 无法解析（章节不存在）时该侧不约束。
  defp within_validity_window?(memory, current_position, chapter_seq_map) do
    from_seq = window_seq(Map.get(memory, :valid_from), chapter_seq_map)
    until_seq = window_seq(Map.get(memory, :valid_until), chapter_seq_map)

    cond do
      is_nil(from_seq) and is_nil(until_seq) -> true
      is_nil(current_position) -> true
      not is_nil(from_seq) and current_position < from_seq -> false
      not is_nil(until_seq) and current_position > until_seq -> false
      true -> true
    end
  end

  defp window_seq(position, chapter_seq_map) when is_map(position) do
    case Map.get(position, "chapter_id") || Map.get(position, :chapter_id) do
      id when is_binary(id) -> Map.get(chapter_seq_map, id)
      _ -> nil
    end
  end

  defp window_seq(_position, _chapter_seq_map), do: nil

  @spec summary([recalled_memory()]) :: String.t() | nil
  def summary([]), do: nil

  def summary(memories) when is_list(memories) do
    memories
    |> Enum.map_join("\n", fn memory ->
      text = memory.summary || memory.content
      "- [#{memory.type}/#{memory.scope}] #{text}"
    end)
  end

  defp base_query(work_id) do
    from(m in MemoryItem,
      where:
        m.work_id == ^work_id and m.status in ^@confirmed_statuses and
          m.recallable == true,
      select: %{
        id: m.id,
        content: m.content,
        summary: m.summary,
        type: m.type,
        scope: m.scope,
        status: m.status,
        weight: m.weight,
        confidence: m.confidence,
        valid_from: m.valid_from,
        valid_until: m.valid_until
      }
    )
  end

  defp score_memory(memory, query) do
    weight = decimal_to_float(memory.weight)
    confidence = decimal_to_float(memory.confidence)
    overlap = lexical_overlap(query, [memory.summary, memory.content])
    score = Float.round(weight * 0.45 + confidence * 0.35 + min(overlap, 1.0) * 0.2, 4)

    memory
    |> Map.put(:weight, weight)
    |> Map.put(:confidence, confidence)
    |> Map.put(:overlap, overlap)
    |> Map.put(:score, score)
  end

  defp recall_match?(%{overlap: overlap}), do: overlap > 0.0

  defp lexical_overlap(nil, _texts), do: 1.0
  defp lexical_overlap("", _texts), do: 1.0

  defp lexical_overlap(query, texts) do
    query_terms = terms(query)

    memory_terms =
      texts
      |> Enum.reject(&is_nil/1)
      |> Enum.flat_map(&terms/1)
      |> MapSet.new()

    if MapSet.size(query_terms) == 0 or MapSet.size(memory_terms) == 0 do
      0.0
    else
      query_terms
      |> MapSet.intersection(memory_terms)
      |> MapSet.size()
      |> Kernel./(MapSet.size(query_terms))
    end
  end

  defp terms(text) when is_binary(text) do
    normalized =
      text
      |> String.downcase()
      |> String.replace(~r/[[:punct:]\s，。？！、；：“”‘’（）《》【】]/u, "")

    graphemes = String.graphemes(normalized)

    cond do
      length(graphemes) >= 2 ->
        graphemes
        |> Enum.chunk_every(2, 1, :discard)
        |> Enum.map(&Enum.join/1)
        |> MapSet.new()

      normalized == "" ->
        MapSet.new()

      true ->
        MapSet.new([normalized])
    end
  end

  defp decimal_to_float(%Decimal{} = decimal), do: Decimal.to_float(decimal)
  defp decimal_to_float(value) when is_float(value), do: value
  defp decimal_to_float(value) when is_integer(value), do: value / 1
  defp decimal_to_float(_), do: 0.0
end
