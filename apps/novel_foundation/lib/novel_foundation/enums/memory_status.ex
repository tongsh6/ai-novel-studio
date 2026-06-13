# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/memory_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MemoryStatus do
  @moduledoc """
  MemoryStatus — generated from `docs/design/schemas/foundation/enums/memory_status.json`.

  05-memory-retention-and-retrieval.md §6 记忆状态设计

  记忆状态枚举。定义记忆的生命周期状态——从草稿到确认、稳定、冲突、废弃、归档。注意：LOCKED 不是 status，使用独立 locked 字段表示。冻结于 05-memory-retention-and-retrieval.md §6。
  """

  @values ["DRAFT", "CONFIRMED", "STABILIZED", "CONFLICTED", "DEPRECATED", "ARCHIVED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def draft, do: "DRAFT"
  def confirmed, do: "CONFIRMED"
  def stabilized, do: "STABILIZED"
  def conflicted, do: "CONFLICTED"
  def deprecated, do: "DEPRECATED"
  def archived, do: "ARCHIVED"
end
