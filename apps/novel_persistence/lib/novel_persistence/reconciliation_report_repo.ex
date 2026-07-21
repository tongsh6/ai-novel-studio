defmodule NovelPersistence.ReconciliationReportRepo do
  @moduledoc """
  对账报告仓储（VS-00F §3.3 / ADR-0026）。

  单活跃报告语义：新报告落盘时把此前 TENTATIVE 报告 SUPERSEDED（作者只面对
  最新一份账面 vs 设计态对账），历史报告留档可审计。报告永远 TENTATIVE 进入，
  裁决转移在 CP2c 接入。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.ReconciliationReport

  @doc "落盘新报告（TENTATIVE），并 SUPERSEDE 此前的 TENTATIVE 报告。"
  @spec insert_superseding(map()) :: {:ok, map()} | {:error, term()}
  def insert_superseding(%{work_id: work_id} = attrs) do
    {_count, _} =
      from(r in ReconciliationReport,
        where: r.work_id == ^work_id and r.adoption_status == ^AdoptionStatus.tentative()
      )
      |> Repo.update_all(set: [adoption_status: AdoptionStatus.superseded()])

    attrs = Map.put(attrs, :adoption_status, AdoptionStatus.tentative())

    case %ReconciliationReport{} |> ReconciliationReport.changeset(attrs) |> Repo.insert() do
      {:ok, report} -> {:ok, to_map(report)}
      {:error, changeset} -> {:error, changeset}
    end
  end

  @doc "当前活跃（TENTATIVE）报告；无则 nil。"
  @spec latest(String.t()) :: map() | nil
  def latest(work_id) when is_binary(work_id) do
    from(r in ReconciliationReport,
      where: r.work_id == ^work_id and r.adoption_status == ^AdoptionStatus.tentative(),
      order_by: [desc: r.inserted_at],
      limit: 1
    )
    |> Repo.one()
    |> case do
      nil -> nil
      report -> to_map(report)
    end
  end

  defp to_map(%ReconciliationReport{} = report) do
    %{
      id: to_string(report.id),
      work_id: report.work_id,
      findings: Map.get(report.findings || %{}, "items") || Map.get(report.findings || %{}, :items) || [],
      finding_count: report.finding_count,
      scanned_at_seq: report.scanned_at_seq,
      adoption_status: report.adoption_status,
      inserted_at: report.inserted_at
    }
  end
end
