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

    cond do
      days_ago <= 0 -> 1.0
      days_ago <= 1 -> 0.9
      days_ago <= 3 -> 0.7
      days_ago <= 7 -> 0.5
      days_ago <= 14 -> 0.3
      days_ago <= 30 -> 0.1
      true -> 0.05
    end
  end

  defp calc_usage_boost(ref_count) do
    boost = :math.log(1 + ref_count) * 0.03
    min(boost, 0.10)
  end
end
