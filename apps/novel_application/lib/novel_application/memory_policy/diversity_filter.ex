defmodule NovelApplication.MemoryPolicy.DiversityFilter do
  @moduledoc """
  去重降噪 — 05-memory-retention-and-retrieval.md §12.4。

  执行：
  1. 去除内容高度相似的重复记忆（Jaccard 相似度检查）
  2. 去除高频低权重的噪声记忆（referenceCount > 50 且 weight < 0.60）
  """

  @similarity_threshold 0.7

  @doc """
  对 `[{memory, score}]` 去重降噪，返回过滤后的列表。
  """
  @spec filter([{map(), float()}]) :: [{map(), float()}]
  def filter(scored_candidates) do
    scored_candidates
    |> remove_noise()
    |> deduplicate()
  end

  # 去除高频低权重噪声
  defp remove_noise(candidates) do
    Enum.reject(candidates, fn {m, _score} ->
      m.reference_count > 50 and m.weight < 0.60
    end)
  end

  # 基于内容关键词重叠去重，保留分数更高者
  defp deduplicate([]), do: []

  defp deduplicate([first | rest]) do
    {kept, _similar} =
      Enum.split_with(rest, fn entry ->
        not similar?(first, entry)
      end)

    [first | deduplicate(kept)]
  end

  defp similar?({m1, _}, {m2, _}) do
    words1 = tokenize(m1.content)
    words2 = tokenize(m2.content)

    if words1 == [] or words2 == [] do
      false
    else
      intersection = Enum.count(words1, &(&1 in words2))
      union = length(Enum.uniq(words1 ++ words2))
      intersection / union >= @similarity_threshold
    end
  end

  # 简单中文分词：按字符 bigram
  defp tokenize(text) do
    chars = String.codepoints(text)
    singles = chars |> Enum.reject(&(&1 in ~w(， 。 ！ ？ 、 ； ： " " ' ' （ ） 的 了 在 是)))
    bigrams = Stream.chunk_every(chars, 2, 1, :discard) |> Enum.map(&Enum.join/1)
    singles ++ bigrams
  end
end
