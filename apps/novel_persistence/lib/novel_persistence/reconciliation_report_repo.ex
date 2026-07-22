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
    case Ecto.UUID.cast(work_id) do
      {:ok, _} -> do_latest(work_id)
      :error -> nil
    end
  end

  defp do_latest(work_id) do
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

  @doc "按 id 取报告（work 隔离）。"
  @spec get(String.t(), String.t()) :: map() | nil
  def get(work_id, report_id) when is_binary(work_id) and is_binary(report_id) do
    case Ecto.UUID.cast(report_id) do
      {:ok, uuid} ->
        from(r in ReconciliationReport, where: r.id == ^uuid and r.work_id == ^work_id)
        |> Repo.one()
        |> case do
          nil -> nil
          report -> to_map(report)
        end

      :error ->
        nil
    end
  end

  @doc """
  写回裁决后的 findings（CP2c）；全部条目已裁决时报告转 ACCEPTED（裁决完成），
  否则保持 TENTATIVE。
  """
  @spec update_findings(String.t(), String.t(), [map()]) :: {:ok, map()} | {:error, term()}
  def update_findings(work_id, report_id, findings) when is_list(findings) do
    with {:ok, uuid} <- Ecto.UUID.cast(report_id),
         %ReconciliationReport{} = report <-
           Repo.one(from(r in ReconciliationReport, where: r.id == ^uuid and r.work_id == ^work_id)) do
      all_dispositioned? =
        findings != [] and
          Enum.all?(findings, fn f -> (f["disposition"] || f[:disposition]) not in [nil, ""] end)

      status =
        if all_dispositioned?, do: AdoptionStatus.accepted(), else: report.adoption_status

      report
      |> ReconciliationReport.changeset(%{
        findings: %{"items" => findings},
        adoption_status: status
      })
      |> Repo.update()
      |> case do
        {:ok, updated} -> {:ok, to_map(updated)}
        {:error, changeset} -> {:error, changeset}
      end
    else
      _ -> {:error, :report_not_found}
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
