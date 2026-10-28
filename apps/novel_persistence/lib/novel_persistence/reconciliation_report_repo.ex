defmodule NovelPersistence.ReconciliationReportRepo do
  @moduledoc """
  对账报告仓储（VS-00F §3.3 / ADR-0026）。

  单活跃报告语义：新报告落盘时把此前 TENTATIVE 报告 SUPERSEDED（作者只面对
  最新一份账面 vs 设计态对账），历史报告留档可审计。报告永远 TENTATIVE 进入，
  裁决转移在 CP2c 接入。

  B44（A-narrow）：状态转换在持久化边界强制——报告是 25 §8.1 维护 artifact，
  “新扫描报告替换旧报告”是维护类替换（`NovelDomain.MaintenanceArtifactStatus`，
  通用 adoption 矩阵 ∪ TENTATIVE→SUPERSEDED），不是作者采纳决策。`update_all`
  已移除：批量 supersede 在事务内逐行 changeset 校验，失败整批回滚（旧报告不留
  半更新）；作者裁决 TENTATIVE→ACCEPTED 仍走通用矩阵。
  """

  import Ecto.Query

  alias Ecto.Multi
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.ReconciliationReport

  @doc "落盘新报告（TENTATIVE），并 SUPERSEDE 此前的 TENTATIVE 报告（逐行校验、事务回滚）。"
  @spec insert_superseding(map()) :: {:ok, map()} | {:error, term()}
  # dialyzer 误报（OTP 28 对不透明类型的 call_without_opaque）：Ecto.Multi 是不透明
  # 类型，Multi.new/0 的返回值直接管道喂给 Multi.run/3 会被判类型不匹配。
  # Ecto 自身也用 `@dialyzer :no_opaque` 关闭同类告警（deps/ecto/lib/ecto/repo/transaction.ex）。
  @dialyzer {:no_opaque, insert_superseding: 1}
  def insert_superseding(%{work_id: work_id} = attrs) do
    changeset =
      %ReconciliationReport{}
      |> ReconciliationReport.changeset(
        Map.put(attrs, :adoption_status, AdoptionStatus.tentative())
      )

    Multi.new()
    |> Multi.run(:supersede_prior_tentative, fn repo, _changes ->
      supersede_prior_tentative(repo, work_id)
    end)
    |> Multi.insert(:report, changeset)
    |> Repo.transaction()
    |> case do
      {:ok, %{report: report}} ->
        {:ok, to_map(report)}

      {:error, :supersede_prior_tentative, reason, _changes} ->
        {:error, reason}

      {:error, :report, changeset, _changes} ->
        {:error, changeset}
    end
  end

  # 逐行 changeset 更新（矩阵校验在 schema）；任一行非法/失败 → 事务回滚。
  defp supersede_prior_tentative(repo, work_id) do
    ReconciliationReport
    |> where([r], r.work_id == ^work_id)
    |> where([r], r.adoption_status == ^AdoptionStatus.tentative())
    |> repo.all()
    |> Enum.reduce_while({:ok, 0}, fn report, {:ok, count} ->
      case report
           |> ReconciliationReport.changeset(%{adoption_status: AdoptionStatus.superseded()})
           |> repo.update() do
        {:ok, _updated} -> {:cont, {:ok, count + 1}}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
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
  否则保持 TENTATIVE。经 schema 矩阵守卫：SUPERSEDED 等 stale 报告不能翻成
  ACCEPTED（返回 changeset error，调用方按既有 `{:error, term()}` 处理）。
  """
  @spec update_findings(String.t(), String.t(), [map()]) :: {:ok, map()} | {:error, term()}
  def update_findings(work_id, report_id, findings) when is_list(findings) do
    with {:ok, uuid} <- Ecto.UUID.cast(report_id),
         %ReconciliationReport{} = report <-
           Repo.one(
             from(r in ReconciliationReport, where: r.id == ^uuid and r.work_id == ^work_id)
           ) do
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
      findings:
        Map.get(report.findings || %{}, "items") || Map.get(report.findings || %{}, :items) || [],
      finding_count: report.finding_count,
      scanned_at_seq: report.scanned_at_seq,
      adoption_status: report.adoption_status,
      inserted_at: report.inserted_at
    }
  end
end
