# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/behavior_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.BehaviorStatus do
  @moduledoc """
  BehaviorStatus — generated from `docs/design/schemas/foundation/enums/behavior_status.json`.

  ADR-0002 §8 behavior status 最小集合

  Durable behavior 状态最小集合。冻结于 ADR-0002 §8。behavior_state.active 只允许 OPEN / WAITING_USER；终态值只能出现在 history。
  """

  @values ["OPEN", "WAITING_USER", "RESOLVED", "CANCELLED", "EXPIRED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def open, do: "OPEN"
  def waiting_user, do: "WAITING_USER"
  def resolved, do: "RESOLVED"
  def cancelled, do: "CANCELLED"
  def expired, do: "EXPIRED"
end
