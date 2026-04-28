# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/retention_tier.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.RetentionTier do
  @moduledoc """
  RetentionTier — generated from `docs/design-v2/schemas/foundation/enums/retention_tier.json`.

  05-memory-retention-and-retrieval.md §6 三层保留结构

  记忆保留层级枚举。Foundation 层定义三层保留结构：hot / warm / cold。冻结于 05-memory-retention-and-retrieval.md §6。
  """

  @values ["hot", "warm", "cold"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def hot, do: "hot"
  def warm, do: "warm"
  def cold, do: "cold"
end
