# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/mutation_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MutationStatus do
  @moduledoc """
  MutationStatus — generated from `docs/design-v2/schemas/foundation/enums/mutation_status.json`.

  07-consistency-and-concurrency.md §7.2 mutation 的阶段

  Mutation 生命周期状态枚举。Foundation 层定义 6 个阶段：PROPOSED / VALIDATING / BLOCKED / APPLIED / SUPERSEDED / CANCELLED。冻结于 07-consistency-and-concurrency.md §7.2。
  """

  @values ["PROPOSED", "VALIDATING", "BLOCKED", "APPLIED", "SUPERSEDED", "CANCELLED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def proposed, do: "PROPOSED"
  def validating, do: "VALIDATING"
  def blocked, do: "BLOCKED"
  def applied, do: "APPLIED"
  def superseded, do: "SUPERSEDED"
  def cancelled, do: "CANCELLED"
end
