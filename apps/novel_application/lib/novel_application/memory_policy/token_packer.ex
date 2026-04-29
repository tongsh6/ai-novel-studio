defmodule NovelApplication.MemoryPolicy.TokenPacker do
  @moduledoc """
  Token Budget Pack — 05-memory-retention-and-retrieval.md §12.5。

  将排好序的记忆按类型组织成上下文区块，控制总 token 数。
  铁律记忆直接注入，不计入 token budget。
  """

  alias NovelFoundation.Enums.MemoryType

  @block_order [
    {MemoryType.world_rule(), "【不可违背规则】"},
    {MemoryType.constraint(), "【创作约束】"},
    {MemoryType.current_state(), "【当前状态】"},
    {MemoryType.character_profile(), "【人物设定】"},
    {MemoryType.relationship(), "【人物关系】"},
    {MemoryType.plot_fact(), "【剧情事实】"},
    {MemoryType.foreshadowing(), "【伏笔】"},
    {MemoryType.style_rule(), "【写作风格约束】"},
    {MemoryType.author_preference(), "【作者偏好】"},
    {MemoryType.idea(), "【灵感备注】"},
    {MemoryType.draft_context(), "【草稿上下文】"}
  ]

  # 粗略 token 估算：中文 ~1.5 字符/token，英文 ~4 字符/token
  @chars_per_token 2

  @doc """
  打包记忆列表为上下文文本。

  输入：
  - iron_laws: [MemoryItem] — 铁律记忆
  - ranked: [{MemoryItem, score}] — 排名后的普通记忆
  - opts: [token_budget: 3000, include_scores: false]

  返回：
  - %{text: String, iron_law_count: integer, candidate_count: integer, estimated_tokens: integer}
  """
  @spec pack([map()], [{map(), float()}], keyword()) :: map()
  def pack(iron_laws, ranked, opts \\ []) do
    token_budget = Keyword.get(opts, :token_budget, 3000)

    iron_law_text = format_iron_laws(iron_laws)
    iron_law_tokens = estimate_tokens(iron_law_text)

    remaining_budget = max(token_budget - iron_law_tokens, 100)

    {context_text, used_count} =
      format_ranked(ranked, remaining_budget)

    full_text = (iron_law_text <> context_text) |> String.trim()

    %{
      text: full_text,
      iron_law_count: length(iron_laws),
      candidate_count: used_count,
      estimated_tokens: estimate_tokens(full_text)
    }
  end

  defp format_iron_laws([]), do: ""

  defp format_iron_laws(iron_laws) do
    items = Enum.map_join(iron_laws, "\n", fn m -> "- #{m.content}" end)
    "【铁律 · 强制注入】\n#{items}\n\n"
  end

  defp format_ranked(ranked, budget) do
    grouped = group_by_type(ranked)

    {text, count, _} =
      Enum.reduce(@block_order, {"", 0, budget}, fn {type, label}, {acc, cnt, remaining} ->
        case Map.get(grouped, type, []) do
          [] ->
            {acc, cnt, remaining}

          items ->
            {block, item_count, tokens_used} = pack_block(label, items, remaining)
            {acc <> block, cnt + item_count, remaining - tokens_used}
        end
      end)

    {text, count}
  end

  defp group_by_type(ranked) do
    Enum.group_by(ranked, fn {m, _} -> m.type end)
  end

  defp pack_block(_label, _items, remaining) when remaining <= 0, do: {"", 0, 0}

  defp pack_block(label, items, budget) do
    {packed, count, tokens} =
      Enum.reduce(items, {"", 0, 0}, fn {m, _score}, {acc, cnt, used} ->
        line = "- #{m.content}\n"
        line_tokens = estimate_tokens(line)

        if used + line_tokens > budget do
          {acc, cnt, used}
        else
          {acc <> line, cnt + 1, used + line_tokens}
        end
      end)

    if count > 0 do
      {label <> "\n" <> packed <> "\n", count, tokens}
    else
      {"", 0, 0}
    end
  end

  defp estimate_tokens(text) do
    ceil(String.length(text) / @chars_per_token)
  end
end
