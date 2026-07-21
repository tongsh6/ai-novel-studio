defmodule NovelPersistence.ReconciliationReportRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.ID
  alias NovelPersistence.ReconciliationReportRepo

  defp attrs(work_id, n) do
    %{
      work_id: work_id,
      findings: %{"items" => [%{"rule" => "arc_stalled", "signal" => "样例#{n}", "severity" => "warn"}]},
      finding_count: 1,
      scanned_at_seq: n
    }
  end

  test "报告 TENTATIVE 落盘；新报告 SUPERSEDE 旧 TENTATIVE；latest 只回活跃一份" do
    work_id = ID.uuid()

    assert {:ok, first} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 10))
    assert first.adoption_status == "TENTATIVE"
    assert ReconciliationReportRepo.latest(work_id).id == first.id

    assert {:ok, second} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 20))
    latest = ReconciliationReportRepo.latest(work_id)
    assert latest.id == second.id
    assert latest.scanned_at_seq == 20
    assert [%{"signal" => "样例20"}] = latest.findings

    # 其它作品互不可见
    assert ReconciliationReportRepo.latest(ID.uuid()) == nil
  end
end
