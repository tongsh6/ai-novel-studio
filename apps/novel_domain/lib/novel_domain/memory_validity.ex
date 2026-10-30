defmodule NovelDomain.MemoryValidity do
  @moduledoc """
  记忆有效窗与叙事位置的纯规则（B64）。

  `valid_from/valid_until` 是 NarrativePosition（当前以章节 UUID 表示），先经
  `chapter_id -> seq` 映射解析到同一章节序号空间，再与目标位置比较：
  - 窗口任一侧无法解析（无该字段/章节不存在/位置未知）→ 该侧不约束；
  - 目标位置未知（nil）→ 不约束（诚实未知，不 fail-hard、不伪装确定）；
  - 无任何窗口 → 始终有效。

  该模块只做纯判定；DB 查询与章节映射由 persistence 提供，普通 recall 与
  creative_facts 共用同一规则，避免两套边界语义漂移。
  """

  @type position :: map() | nil
  @type seq_map :: %{optional(String.t()) => integer()}

  @spec within_window?(position(), position(), integer() | nil, seq_map()) :: boolean()
  def within_window?(valid_from, valid_until, current_position, chapter_seq_map) do
    from_seq = window_seq(valid_from, chapter_seq_map)
    until_seq = window_seq(valid_until, chapter_seq_map)

    cond do
      is_nil(from_seq) and is_nil(until_seq) -> true
      is_nil(current_position) -> true
      not is_nil(from_seq) and current_position < from_seq -> false
      not is_nil(until_seq) and current_position > until_seq -> false
      true -> true
    end
  end

  @spec window_seq(position(), seq_map()) :: integer() | nil
  def window_seq(position, chapter_seq_map) when is_map(position) do
    case Map.get(position, "chapter_id") || Map.get(position, :chapter_id) do
      id when is_binary(id) -> Map.get(chapter_seq_map, id)
      _ -> nil
    end
  end

  def window_seq(_position, _chapter_seq_map), do: nil
end
