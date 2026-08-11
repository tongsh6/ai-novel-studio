# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/information_ledger_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.InformationLedgerStatus do
  @moduledoc """
  InformationLedgerStatus — generated from `docs/design/schemas/foundation/enums/information_ledger_status.json`.

  ADR-0026-five-ledgers-three-state-reconciliation-v3.md VS-00F §2.4

  信息账（ledger=information）领域状态机。HIDDEN→PARTIALLY_REVEALED→REVEALED 正向生命周期；LEAKED 为异常态（实现态早于设计揭示点，R4 机械记账）。REVEALED 只能经机械口径（本章正文采纳释放本章计划信息）或作者裁决/采纳回收提议进入——回收是语义判断，模型只提议、作者收账（VS00F 刀④拍板）。冻结于 VS-00F §2.4 / ADR-0026。
  """

  @values ["HIDDEN", "PARTIALLY_REVEALED", "REVEALED", "LEAKED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def hidden, do: "HIDDEN"
  def partially_revealed, do: "PARTIALLY_REVEALED"
  def revealed, do: "REVEALED"
  def leaked, do: "LEAKED"
end
