defmodule NovelPersistence.MemoryRecallRepo do
  @moduledoc """
  Read-side recall query for governed memory.

  This module only returns memory that is safe for ordinary dialogue context:
  current work, confirmed/stabilized status, and explicitly recallable.
  """

  import Ecto.Query

  alias NovelFoundation.Enums.MemoryStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

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
        uuid
        |> base_query()
        |> Repo.all()
        |> Enum.map(&score_memory(&1, query))
        |> Enum.filter(&recall_match?/1)
        |> Enum.sort_by(&{-&1.score, -&1.weight, -&1.confidence, &1.summary || &1.content})
        |> Enum.take(limit)
        |> Enum.map(&Map.drop(&1, [:overlap]))

      :error ->
        []
    end
  end

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
        confidence: m.confidence
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
