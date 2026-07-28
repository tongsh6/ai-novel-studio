# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/arc_ledger_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.ArcLedgerStatus do
  @moduledoc """
  ArcLedgerStatus — generated from `docs/design/schemas/foundation/enums/arc_ledger_status.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.2

  弧光账（ledger=arc）领域状态机。UPPER_SNAKE 对齐全仓 *_status 约定；与采纳 7 态（adoption_status）正交分层。DRIFTED/RESUMED 只能经作者裁决进入（VS-00F §3.3）。冻结于 VS-00F §2.2 / ADR-0026。
  """

  @values ["ON_TRACK", "STALLED", "DRIFTED", "RESUMED", "COMPLETED", "RETIRED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def on_track, do: "ON_TRACK"
  def stalled, do: "STALLED"
  def drifted, do: "DRIFTED"
  def resumed, do: "RESUMED"
  def completed, do: "COMPLETED"
  def retired, do: "RETIRED"
end
