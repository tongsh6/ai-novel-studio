defmodule NovelPersistence.Repo.Migrations.AddGateLineageToDecisionTraces do
  @moduledoc """
  GATE-ORDER-CLOSURE CP1（ADR-0005）：DecisionTrace 记录 gate order version 与逐门
  GateResult lineage。

  - `gate_order_version`：本轮按哪个 gate 顺序审查（ADR-0005「Replay 至少能回答
    这一轮按哪个 gate order 审查」）；
  - `gate_result_refs`：逐门 `{gate, order, outcome, reason_code, input_refs,
    author_visible}`（JSON map，author-safe 投影）。

  存量行两列为 NULL：replay/why 面板按缺席处理，不伪造 gate 事实。
  回滚：`MIX_ENV=<env> mix ecto.rollback`（只回滚本迁移，不触碰数据）。
  """

  use Ecto.Migration

  def change do
    alter table(:decision_traces) do
      add(:gate_order_version, :string)
      add(:gate_result_refs, {:array, :map})
    end
  end
end
