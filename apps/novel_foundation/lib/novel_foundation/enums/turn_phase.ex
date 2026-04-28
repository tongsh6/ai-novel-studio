# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/turn_phase.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.TurnPhase do
  @moduledoc """
  TurnPhase — generated from `docs/design-v2/schemas/foundation/enums/turn_phase.json`.

  ADR-0002 §3 Turn phase 与 status 映射

  Turn 流程阶段，9 个值固定。冻结于 ADR-0002 §3。
  """

  @values ["RECEIVED", "ROUTED", "NEEDS_CLARIFICATION", "NEEDS_CONFIRMATION", "READY_TO_EXECUTE", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def received, do: "RECEIVED"
  def routed, do: "ROUTED"
  def needs_clarification, do: "NEEDS_CLARIFICATION"
  def needs_confirmation, do: "NEEDS_CONFIRMATION"
  def ready_to_execute, do: "READY_TO_EXECUTE"
  def executing, do: "EXECUTING"
  def completed, do: "COMPLETED"
  def failed, do: "FAILED"
  def cancelled, do: "CANCELLED"
end
