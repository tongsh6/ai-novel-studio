defmodule NovelDomain.MaintenanceArtifactStatus do
  @moduledoc """
  维护类 artifact 生命周期（`25-maintenance-hooks.md §8.1` 维护 artifact 家族 +
  `22-continuity-model.md §21.2` supersede 语义）。

  **适用边界**：只用于维护类 artifact 的**维护类替换**（当前唯一消费者 =
  `reconciliation_report_artifact` 的“新扫描报告替代旧待处理报告、旧版留史”）。

  它不是第二套 adoption 7 态矩阵：

  - 通用 adoption 转换仍只由 `NovelDomain.AdoptionStatus.transition_allowed?/2` 决定，
    本模块一字不改它；
  - 本模块只在通用矩阵之上追加**一条**维护类替换规则；
  - **不作用于** `Draft` / `ChapterSummary` 等 adoption artifact —— 它们仍走通用矩阵。

  **为什么不进通用矩阵**：ADR-0019 管的是 artifact adoption 转换（作者采纳决策）；
  “新版扫描报告替代旧待审报告”是维护类替换（maintenance replacement），不产生 canon、
  不是作者采纳动作，因此不属 INV-1 的采纳语义。22 §21.2 对 `SUPERSEDED`
  （新版替代旧版、旧版留史）的定义正适用于本场景。
  """

  alias NovelDomain.AdoptionStatus

  # 维护类替换规则（只含维护类新增边，不是完整 7 态矩阵）。
  @replacement_transitions %{"TENTATIVE" => ["SUPERSEDED"]}

  @doc "维护类替换规则（from => 允许的 to 列表）；供审计/测试。"
  @spec replacement_transitions() :: %{optional(String.t()) => [String.t()]}
  def replacement_transitions, do: @replacement_transitions

  @doc "维护类替换是否合法（当前只声明 TENTATIVE → SUPERSEDED）。"
  @spec replacement_allowed?(String.t(), String.t()) :: boolean()
  def replacement_allowed?(from, to) when is_binary(from) and is_binary(to) do
    to in Map.get(@replacement_transitions, from, [])
  end

  def replacement_allowed?(_from, _to), do: false

  @doc """
  维护类 artifact 的合法状态转换 = 通用 adoption 矩阵 ∪ 维护类替换。

  自反 no-op 与未知状态的语义完全继承 `NovelDomain.AdoptionStatus.transition_allowed?/2`。
  """
  @spec transition_allowed?(String.t(), String.t()) :: boolean()
  def transition_allowed?(from, to) do
    AdoptionStatus.transition_allowed?(from, to) or replacement_allowed?(from, to)
  end
end
