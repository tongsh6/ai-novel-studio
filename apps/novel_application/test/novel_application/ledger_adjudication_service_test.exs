defmodule NovelApplication.LedgerAdjudicationServiceTest do
  @moduledoc """
  对账裁决用例单测（VS-00F §3.3 / ADR-0026 CP2c-1）。
  四处置各一例 + 双裁决拒绝 + 全裁决报告转 ACCEPTED + 裁决态域层双保险。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.LedgerAdjudicationService

  defp finding(rule, entry_ref) do
    %{"rule" => rule, "ledger" => "arc", "severity" => "warn", "entry_ref" => entry_ref,
      "signal" => "样例", "source_refs" => ["s"], "proposed_disposition" => "revise_design"}
  end

  defp setup_state(findings) do
    {:ok, reports} = Agent.start_link(fn ->
      %{"r1" => %{id: "r1", work_id: "w", adoption_status: "TENTATIVE", findings: findings, finding_count: length(findings)}}
    end)

    {:ok, entries} = Agent.start_link(fn ->
      %{"le_1" => %{id: "le_1", work_id: "w", ledger: "arc", subject_kind: "character",
        subject_ref: "char-1", subject_label: "凌渊", design_ref: nil, status: "STALLED",
        payload: %{"last_seen_seq" => 25}, source_refs: ["s"], last_event_chapter: nil,
        adoption_status: "ACCEPTED", revision: 3}}
    end)

    deps = %{
      report_repo: %{
        get: fn _w, id -> Agent.get(reports, &Map.get(&1, id)) end,
        update_findings: fn _w, id, findings ->
          Agent.get_and_update(reports, fn state ->
            report = Map.fetch!(state, id)
            all = findings != [] and Enum.all?(findings, &((&1["disposition"] || "") != ""))
            updated = %{report | findings: findings,
              adoption_status: if(all, do: "ACCEPTED", else: report.adoption_status)}
            {{:ok, updated}, Map.put(state, id, updated)}
          end)
        end
      },
      ledger_repo: %{
        list: fn _w -> Agent.get(entries, &Map.values(&1)) end,
        upsert: fn attrs ->
          Agent.update(entries, &Map.put(&1, "le_1", Map.merge(Map.fetch!(&1, "le_1"), attrs)))
          {:ok, attrs}
        end
      }
    }

    {deps, reports, entries}
  end

  defp input(index, disposition) do
    %{work_id: "w", report_id: "r1", finding_index: index, disposition: disposition, actor_ref: "author"}
  end

  test "accept_drift：arc STALLED 条目裁决转 DRIFTED，处置记账" do
    {deps, _reports, entries} = setup_state([finding("arc_stalled", "le_1"), finding("planned_info_leak", nil)])

    assert {:ok, %{report: report}} = LedgerAdjudicationService.adjudicate(input(0, "accept_drift"), deps)
    assert Agent.get(entries, & &1)["le_1"].status == "DRIFTED"
    assert Enum.at(report.findings, 0)["disposition"] == "accept_drift"
    assert report.adoption_status == "TENTATIVE"
  end

  test "dismiss 不动账面；revise_* 返回 follow_up；全裁决后报告 ACCEPTED；双裁决拒绝" do
    {deps, _reports, entries} = setup_state([finding("arc_stalled", "le_1"), finding("genre_promise_shift", nil)])

    assert {:ok, _} = LedgerAdjudicationService.adjudicate(input(0, "dismiss"), deps)
    assert Agent.get(entries, & &1)["le_1"].status == "STALLED"

    assert {:error, {:already_dispositioned, "dismiss"}} =
             LedgerAdjudicationService.adjudicate(input(0, "accept_drift"), deps)

    assert {:follow_up, :revise_design, %{report: report}} =
             LedgerAdjudicationService.adjudicate(input(1, "revise_design"), deps)

    assert report.adoption_status == "ACCEPTED"

    # 报告已完成裁决 → 不再可裁决
    assert {:error, {:report_not_active, "ACCEPTED"}} =
             LedgerAdjudicationService.adjudicate(input(1, "dismiss"), deps)
  end

  test "输入校验：目录外处置/缺 actor 拒绝" do
    {deps, _, _} = setup_state([finding("arc_stalled", "le_1")])

    assert {:error, {:unknown_disposition, "shrug"}} =
             LedgerAdjudicationService.adjudicate(input(0, "shrug"), deps)

    assert {:error, :missing_adjudication_input} =
             LedgerAdjudicationService.adjudicate(Map.put(input(0, "dismiss"), :actor_ref, ""), deps)
  end
end
