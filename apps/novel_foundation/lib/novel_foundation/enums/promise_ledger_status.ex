# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/promise_ledger_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.PromiseLedgerStatus do
  @moduledoc """
  PromiseLedgerStatus — generated from `docs/design/schemas/foundation/enums/promise_ledger_status.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.6

  承诺账状态机（VS-00F §2.6 / ADR-0026）：OPEN/PROGRESSING/FULFILLED/BROKEN/RELEASED。
  """

  @values ["OPEN", "PROGRESSING", "FULFILLED", "BROKEN", "RELEASED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def open, do: "OPEN"
  def progressing, do: "PROGRESSING"
  def fulfilled, do: "FULFILLED"
  def broken, do: "BROKEN"
  def released, do: "RELEASED"
end
