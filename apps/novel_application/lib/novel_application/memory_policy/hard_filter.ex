defmodule NovelApplication.MemoryPolicy.HardFilter do
  @moduledoc """
  铁律直接注入过滤器 — 05-memory-retention-and-retrieval.md §12.1。

  满足条件的记忆跳过普通排序，直接进入 Base Context：
  - weight >= 0.90
  - status IN (CONFIRMED, STABILIZED)
  - locked = true 或 source_type = AUTHOR_CONFIRMED
  - recallable = true
  - scope 与当前 scope 匹配（可选过滤）
  """

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus

  @broad_scopes [MemoryScope.global(), MemoryScope.work()]

  @doc """
  将记忆列表分离为 `{iron_laws, candidates}`。

  铁律级记忆不参与后续排序，直接注入。
  """
  @spec filter([map()], keyword()) :: {[map()], [map()]}
  def filter(memories, opts \\ []) do
    scope_filter = Keyword.get(opts, :scope)

    # 先排除不可召回的记忆
    recallable = Enum.filter(memories, & &1.recallable)

    {iron_laws, candidates} =
      Enum.split_with(recallable, fn m ->
        iron_law?(m) && scope_match?(m, scope_filter)
      end)

    {iron_laws, candidates}
  end

  defp iron_law?(m) do
    m.weight >= 0.90 and
      m.status in [MemoryStatus.confirmed(), MemoryStatus.stabilized()] and
      (m.locked or m.source_type == MemorySourceType.author_confirmed())
  end

  defp scope_match?(_m, nil), do: true

  defp scope_match?(%{scope: scope}, _task_scope)
       when scope in @broad_scopes,
       do: true

  defp scope_match?(m, scope), do: m.scope == scope
end
