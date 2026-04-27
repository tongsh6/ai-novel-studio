defmodule NovelFoundation.Revision do
  @moduledoc """
  Revision 工具函数。

  Phase 1：base revision 提取 + 比较。乐观锁由 Ecto optimistic_lock 负责。
  """

  @doc "从 struct 或 map 中提取 base revision。"
  @spec base_revision(map()) :: pos_integer() | nil
  def base_revision(%{revision: rev}) when is_integer(rev) and rev > 0, do: rev
  def base_revision(_), do: nil

  @doc "检查对象是否为 stale（base 与 authoritative 不同）。"
  @spec stale?(map(), map()) :: boolean()
  def stale?(base, authoritative) do
    base_revision(base) != base_revision(authoritative)
  end
end
