defmodule NovelApplication.LedgerReconciliationService do
  @moduledoc """
  三态对账扫描编排（VS-00F §3 / ADR-0026，CP2a 首版）。

  **只读**权威层（I-L2：对账运行前后权威层无 diff）：装配账面与摘要输入，
  跑 `NovelDomain.LedgerReconciliation` 确定性规则（I-L4），返回偏离项清单。
  CP2b 把清单物化为 `reconciliation_report_artifact`（tentative，作者裁决）并
  落 `ledger_reconciliation_v1` AgentRun profile；本模块保持可被重放驱动与
  后续 profile 共用的纯编排。
  """

  require NovelCommon.LogEmit

  alias NovelCommon.LogEmit
  alias NovelDomain.LedgerReconciliation

  @typedoc "端口：账面全量 / 按章序摘要 / 角色阵容（锚点排除人名用）。"
  @type deps :: %{
          required(:entries) => (String.t() -> [map()]),
          required(:summaries) => (String.t() -> [{non_neg_integer(), String.t()}]),
          required(:roster) => (String.t() -> [map()])
        }

  @spec scan(String.t(), deps()) :: {:ok, %{findings: [map()], counts: map()}}
  def scan(work_id, deps) do
    entries = deps.entries.(work_id)
    summaries = deps.summaries.(work_id)
    roster = deps.roster.(work_id)
    roster_names = roster |> Enum.map(& &1[:name]) |> Enum.filter(&is_binary/1)

    arc_entries = Enum.filter(entries, &(&1.ledger == "arc"))
    promise_entry = Enum.find(entries, &(&1.ledger == "promise" and &1.subject_ref == "genre"))
    leaked_entries = Enum.filter(entries, &(&1.ledger == "information" and &1.status == "LEAKED"))

    findings =
      LedgerReconciliation.arc_stalled_findings(arc_entries) ++
        List.wrap(LedgerReconciliation.genre_promise_finding(promise_entry, summaries, roster_names)) ++
        Enum.map(leaked_entries, &leak_finding/1) ++
        design_debt_findings(roster, summaries)

    counts = Enum.frequencies_by(findings, & &1.rule)

    LogEmit.emit(:ledger, :reconcile, :done, %{
      work_id: work_id,
      finding_count: length(findings),
      rules: counts
    })

    {:ok, %{findings: findings, counts: counts}}
  end

  @doc """
  CP2b：扫描并把偏离清单物化为对账报告（`reconciliation_report_artifact`，
  25 §8.1 维护家族）。报告永远 TENTATIVE 落盘、SUPERSEDE 前一份、作者逐项
  裁决（契约 §3.2——报告不走自动通过通道）。findings 为空时不落盘（无偏离
  不制造空报告噪声），返回 `{:ok, :no_findings}`。
  """
  @spec materialize(String.t(), deps(), map(), integer() | nil) ::
          {:ok, map() | :no_findings} | {:error, term()}
  def materialize(work_id, deps, report_repo, scanned_at_seq \\ nil) do
    {:ok, %{findings: findings, counts: counts}} = scan(work_id, deps)

    if findings == [] do
      {:ok, :no_findings}
    else
      case report_repo.insert_superseding.(%{
             work_id: work_id,
             findings: %{"items" => findings},
             finding_count: length(findings),
             scanned_at_seq: scanned_at_seq
           }) do
        {:ok, report} ->
          LogEmit.emit(:ledger, :report, :done, %{
            work_id: work_id,
            report_id: report.id,
            finding_count: length(findings),
            rules: counts,
            scanned_at_seq: scanned_at_seq
          })

          {:ok, report}

        {:error, reason} ->
          LogEmit.emit(:ledger, :report, :error, %{
            work_id: work_id,
            reason_code: :report_persist_failed,
            outcome_detail: inspect(reason)
          })

          {:error, reason}
      end
    end
  end

  @doc "生产端口装配（探索/重放/后续 profile 共用）。"
  @spec persistence_deps() :: deps()
  def persistence_deps do
    %{
      entries: &NovelPersistence.LedgerRepository.list_all/1,
      summaries: &NovelPersistence.LedgerRepository.accepted_summaries_by_seq/1,
      roster: &NovelPersistence.WorkArchiveRepo.characters/1
    }
  end

  @doc "报告仓储生产端口。"
  @spec persistence_report_repo() :: map()
  def persistence_report_repo do
    %{insert_superseding: &NovelPersistence.ReconciliationReportRepo.insert_superseding/1}
  end

  # R4 的报告呈现：LEAKED 条目（维护已记账的既成事实）聚合为偏离项。
  # VS-00G CP2 设计负债规则族："应有设计态 vs 设计态缺位"。R5 主角未物化先落
  # （最可靠、数据现成）；R2 无设计接管需人物栏结构化提取（延后，见 slice 登记）；
  # R6/R7 依赖 CP3 全书骨架字段。阈值 R5=10（VS-00G OQ3，策略化默认）。
  @protagonist_debt_threshold 10

  defp design_debt_findings(roster, summaries) do
    chapter_count = length(summaries)

    [
      LedgerReconciliation.protagonist_undermaterialized_finding(
        roster,
        chapter_count,
        @protagonist_debt_threshold
      )
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp leak_finding(entry) do
    %{
      rule: "planned_info_leak",
      ledger: "information",
      severity: "warn",
      entry_ref: entry.id,
      signal: Map.get(entry.payload || %{}, "fact") || entry.subject_label,
      source_refs: entry.source_refs || [],
      proposed_disposition: "revise_prose"
    }
  end
end
