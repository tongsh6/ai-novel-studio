defmodule NovelPersistence.Schemas.ReconciliationReport do
  @moduledoc """
  对账报告持久化 schema（VS-00F §3.3 / ADR-0026，`reconciliation_report_artifact`
  的承载行，25 §8.1 维护 artifact 家族）。

  报告永远 TENTATIVE 落盘、作者逐项裁决（CP2c）——不走自动通过通道（与
  ledger_update 的 LOW 自动分道，契约 §3.2）。findings 形状见
  `NovelDomain.LedgerReconciliation.finding/0`，存于 `findings.items`。
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "reconciliation_reports" do
    field(:work_id, :string)
    field(:findings, :map, default: %{})
    field(:finding_count, :integer, default: 0)
    field(:scanned_at_seq, :integer)
    field(:adoption_status, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(report, attrs) do
    report
    |> cast(attrs, [:work_id, :findings, :finding_count, :scanned_at_seq, :adoption_status])
    |> validate_required([:work_id, :findings, :adoption_status])
    |> validate_inclusion(:adoption_status, AdoptionStatus.values())
  end
end
