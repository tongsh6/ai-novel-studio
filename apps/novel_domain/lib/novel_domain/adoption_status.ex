defmodule NovelDomain.AdoptionStatus do
  @moduledoc """
  Artifact adoption 7 态合法转换（ADR-0019 / `30-contract-glossary.md §3.2.1`）。

  取值集合 canonical 来源 `30 §3.2` + ADR-0001；本模块只表达**转换合法性**。
  与 `NovelDomain.MemoryItem` 的记忆状态机（DRAFT/CONFIRMED/...）是两套独立状态机，不可混用。
  """

  @initial "TENTATIVE"

  # ADR-0019 合法转换矩阵（全可逆；复活统一 → TENTATIVE 重入采纳流）。
  @transitions %{
    "TENTATIVE" => ["ACCEPTED", "EDITED_ACCEPTED", "DISCARDED", "INVALIDATED"],
    "ACCEPTED" => ["SUPERSEDED", "INVALIDATED", "DISCARDED", "ARCHIVED"],
    "EDITED_ACCEPTED" => ["SUPERSEDED", "INVALIDATED", "DISCARDED", "ARCHIVED"],
    "DISCARDED" => ["TENTATIVE", "ARCHIVED"],
    "SUPERSEDED" => ["TENTATIVE", "ARCHIVED"],
    "INVALIDATED" => ["TENTATIVE", "ARCHIVED"],
    "ARCHIVED" => ["TENTATIVE"]
  }

  # 当前有效 canon（ADR-0019 INV-2）。
  @canon ["ACCEPTED", "EDITED_ACCEPTED"]

  @doc "初始态：artifact 产出即 TENTATIVE。"
  @spec initial() :: String.t()
  def initial, do: @initial

  @doc "完整转换矩阵（from => 允许的 to 列表）。"
  @spec transitions() :: %{optional(String.t()) => [String.t()]}
  def transitions, do: @transitions

  @doc "当前有效 canon 状态集合。"
  @spec canon_statuses() :: [String.t()]
  def canon_statuses, do: @canon

  @doc """
  转换是否合法（ADR-0019）。

  - 自反转换（同态 → 同态）视为合法 no-op。
  - 进入 ACCEPTED/EDITED_ACCEPTED 只能来自 TENTATIVE（INV-1：canon 须经采纳决策）。
  - 非矩阵中的转换返回 false。
  """
  @spec transition_allowed?(String.t(), String.t()) :: boolean()
  def transition_allowed?(from, from) when is_binary(from), do: true

  def transition_allowed?(from, to) when is_binary(from) and is_binary(to) do
    to in Map.get(@transitions, from, [])
  end

  def transition_allowed?(_from, _to), do: false
end
