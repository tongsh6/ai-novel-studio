# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/conflict_ledger_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.ConflictLedgerStatus do
  @moduledoc """
  ConflictLedgerStatus — generated from `docs/design/schemas/foundation/enums/conflict_ledger_status.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.3

  冲突账状态机（VS-00F §2.3 / ADR-0026）：ACTIVE⇄DORMANT 机械，其余为裁决/终态。
  """

  @values ["ACTIVE", "DORMANT", "REVIVED", "ABSORBED", "ABANDONED", "RESOLVED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def active, do: "ACTIVE"
  def dormant, do: "DORMANT"
  def revived, do: "REVIVED"
  def absorbed, do: "ABSORBED"
  def abandoned, do: "ABANDONED"
  def resolved, do: "RESOLVED"
end
