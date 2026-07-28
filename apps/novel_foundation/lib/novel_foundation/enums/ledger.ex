# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/ledger.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.Ledger do
  @moduledoc """
  Ledger — generated from `docs/design/schemas/foundation/enums/ledger.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.1

  五本账分类枚举（08 §4.5 E33-E37 贯穿账本）。分类枚举 lower_snake，对齐 memory_class 风格。冻结于 VS-00F §2.1 / ADR-0026。
  """

  @values ["arc", "conflict", "information", "emotion_curve", "promise"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def arc, do: "arc"
  def conflict, do: "conflict"
  def information, do: "information"
  def emotion_curve, do: "emotion_curve"
  def promise, do: "promise"
end
