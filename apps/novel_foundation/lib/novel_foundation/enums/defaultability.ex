# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/defaultability.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.Defaultability do
  @moduledoc """
  Defaultability — generated from `docs/design-v2/schemas/foundation/enums/defaultability.json`.

  ADR-0010 §3 slot entry 最小字段

  Slot 可默认性枚举。defaultable 表示 registry 可给默认值（默认值本身不在本 ADR 冻结）。冻结于 ADR-0010 §3。
  """

  @values ["no_default", "defaultable"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def no_default, do: "no_default"
  def defaultable, do: "defaultable"
end
