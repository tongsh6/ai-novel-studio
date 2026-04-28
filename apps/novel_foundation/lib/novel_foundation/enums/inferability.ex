# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/inferability.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.Inferability do
  @moduledoc """
  Inferability — generated from `docs/design-v2/schemas/foundation/enums/inferability.json`.

  ADR-0010 §3 slot entry 最小字段

  Slot 可推断性枚举。inferable_with_high_confidence 表示 Router 可从当前上下文稳定补足但必须保留推断来源。冻结于 ADR-0010 §3。
  """

  @values ["not_inferable", "inferable_with_high_confidence"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def not_inferable, do: "not_inferable"
  def inferable_with_high_confidence, do: "inferable_with_high_confidence"
end
