defmodule NovelApplication.MemoryPolicy.CandidateSearch do
  @moduledoc """
  候选搜索 — 05-memory-retention-and-retrieval.md §12.2。

  MVP 阶段不依赖向量库，使用关键词匹配 + 类型匹配 + scope 匹配。
  每位候选返回 relevance 分数（0.0-1.0）。
  """

  @doc """
  对候选记忆列表打分，返回 `[{memory, score}]` 按分数降序排列。

  opts:
  - query: 查询文本（用于关键词匹配）
  - prefer_types: 优先的类型列表
  - scope: 作用范围匹配
  """
  @spec search([map()], keyword()) :: [{map(), float()}]
  def search(candidates, opts \\ []) do
    query = Keyword.get(opts, :query, "")
    prefer_types = Keyword.get(opts, :prefer_types, [])
    scope = Keyword.get(opts, :scope)

    keywords = extract_keywords(query)

    candidates
    |> Enum.map(fn m -> {m, score(m, keywords, prefer_types, scope)} end)
    |> Enum.filter(fn {_, s} -> s > 0 end)
    |> Enum.sort_by(fn {_, s} -> s end, :desc)
  end

  defp score(m, keywords, prefer_types, scope) do
    keyword_score = keyword_score(m, keywords)
    type_bonus = if m.type in prefer_types, do: 0.1, else: 0.0
    scope_bonus = if scope && m.scope == scope, do: 0.05, else: 0.0
    summary_bonus = summary_score(m, keywords)

    # 加权合成：关键词 0.5 + 摘要 0.3 + type bonus 0.1 + scope bonus 0.05
    min(1.0, keyword_score * 0.5 + summary_bonus * 0.3 + type_bonus + scope_bonus)
  end

  defp keyword_score(m, keywords) do
    text = String.downcase(m.content)
    summary = String.downcase(m.summary || "")
    combined = text <> " " <> summary

    if keywords == [] do
      0.1
    else
      hits = Enum.count(keywords, fn kw -> String.contains?(combined, kw) end)
      hits / max(length(keywords), 1)
    end
  end

  defp summary_score(m, keywords) do
    if is_nil(m.summary) || m.summary == "" do
      0.0
    else
      summary = String.downcase(m.summary)
      hits = Enum.count(keywords, fn kw -> String.contains?(summary, kw) end)
      hits / max(length(keywords), 1)
    end
  end

  @stop_words ["的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会"]

  # 简单中文关键词提取：按常见分隔符切分，过滤短词和停用词
  defp extract_keywords(""), do: []
  defp extract_keywords(query) do
    query
    |> String.replace(~r/[，。！？、；：""''（）\s]+/, " ")
    |> String.split(" ")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == "" or String.length(&1) < 2))
    |> Enum.reject(&(&1 in @stop_words))
  end
end
