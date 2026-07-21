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
    roster_names = deps.roster.(work_id) |> Enum.map(& &1[:name]) |> Enum.filter(&is_binary/1)

    arc_entries = Enum.filter(entries, &(&1.ledger == "arc"))
    promise_entry = Enum.find(entries, &(&1.ledger == "promise" and &1.subject_ref == "genre"))
    leaked_entries = Enum.filter(entries, &(&1.ledger == "information" and &1.status == "LEAKED"))

    findings =
      LedgerReconciliation.arc_stalled_findings(arc_entries) ++
        List.wrap(LedgerReconciliation.genre_promise_finding(promise_entry, summaries, roster_names)) ++
        Enum.map(leaked_entries, &leak_finding/1)

    counts = Enum.frequencies_by(findings, & &1.rule)

    LogEmit.emit(:ledger, :reconcile, :done, %{
      work_id: work_id,
      finding_count: length(findings),
      rules: counts
    })

    {:ok, %{findings: findings, counts: counts}}
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

  # R4 的报告呈现：LEAKED 条目（维护已记账的既成事实）聚合为偏离项。
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
