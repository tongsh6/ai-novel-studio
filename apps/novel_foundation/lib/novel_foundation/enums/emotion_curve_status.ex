# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/emotion_curve_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.EmotionCurveStatus do
  @moduledoc """
  EmotionCurveStatus — generated from `docs/design/schemas/foundation/enums/emotion_curve_status.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.5

  情绪曲线账每采纳章一条，机械判定 MATCHED/DEVIATED/UNPLANNED（VS-00F §2.5）。
  """

  @values ["MATCHED", "DEVIATED", "UNPLANNED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def matched, do: "MATCHED"
  def deviated, do: "DEVIATED"
  def unplanned, do: "UNPLANNED"
end
