defmodule NovelApplication.MemoryPolicy.Reranker do
  @moduledoc """
  重排序 — 05-memory-retention-and-retrieval.md §12.3。

  Score = Relevance * 0.60 + Weight * 0.30 + Recency * 0.10 + usageBoost

  usageBoost = min(log(1 + referenceCount) * 0.03, 0.10)，限制马太效应。
  """

  @doc """
  对 `[{memory, relevance_score}]` 重新排序，返回 `[{memory, final_score}]`。
  """
  @spec rerank([{map(), float()}]) :: [{map(), float()}]
  def rerank(scored_candidates) do
    now = DateTime.utc_now()

    scored_candidates
    |> Enum.map(fn {m, relevance} ->
      {m, rerank_score(m, relevance, now)}
    end)
    |> Enum.sort_by(fn {_, s} -> s end, :desc)
  end

  defp rerank_score(m, relevance, now) do
    weight = m.weight
    recency = calc_recency(m, now)
    usage_boost = calc_usage_boost(m.reference_count)

    relevance * 0.60 + weight * 0.30 + recency * 0.10 + usage_boost
  end

  # 基于 last_referenced_at 或 updated_at 计算新鲜度（0.0-1.0）
  # 越近越高
  defp calc_recency(m, now) do
    ref_time = m.last_referenced_at || m.updated_at || now
    days_ago = DateTime.diff(now, ref_time, :day)

    recency_score(days_ago)
  end

  defp recency_score(days_ago) when days_ago <= 0, do: 1.0
  defp recency_score(days_ago) when days_ago <= 1, do: 0.9
  defp recency_score(days_ago) when days_ago <= 3, do: 0.7
  defp recency_score(days_ago) when days_ago <= 7, do: 0.5
  defp recency_score(days_ago) when days_ago <= 14, do: 0.3
  defp recency_score(days_ago) when days_ago <= 30, do: 0.1
  defp recency_score(_days_ago), do: 0.05

  defp calc_usage_boost(ref_count) do
    boost = :math.log(1 + ref_count) * 0.03
    min(boost, 0.10)
  end
end
