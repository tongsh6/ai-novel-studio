defmodule NovelFoundation.Enums.ProjectionRefreshStatus do
  @moduledoc """
  ProjectionRefreshStatus — projection 刷新状态。

  ADR-0011 §1 冻结 4 态：
  - FRESH：projection 与 accepted source 一致
  - STALE：accepted source 已变化，projection 仍可读但过时
  - REBUILDING：projection 正在重建
  - FAILED：projection 重建失败
  """

  @values ["FRESH", "STALE", "REBUILDING", "FAILED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def fresh, do: "FRESH"
  def stale, do: "STALE"
  def rebuilding, do: "REBUILDING"
  def failed, do: "FAILED"
end
