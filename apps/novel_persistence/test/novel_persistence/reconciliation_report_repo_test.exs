defmodule NovelPersistence.ReconciliationReportRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.ID
  alias NovelPersistence.ReconciliationReportRepo
  alias NovelPersistence.Schemas.ReconciliationReport

  defp attrs(work_id, n) do
    %{
      work_id: work_id,
      findings: %{
        "items" => [%{"rule" => "arc_stalled", "signal" => "样例#{n}", "severity" => "warn"}]
      },
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

  describe "B44 维护类替换边界（A-narrow，ADR-0019 通用矩阵不变）" do
    test "第二次物化：旧报告 SUPERSEDED 留史、新报告 TENTATIVE、latest 单活跃" do
      work_id = ID.uuid()

      assert {:ok, first} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 10))
      assert {:ok, second} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 20))

      assert ReconciliationReportRepo.get(work_id, first.id).adoption_status == "SUPERSEDED"
      assert ReconciliationReportRepo.get(work_id, second.id).adoption_status == "TENTATIVE"
      assert ReconciliationReportRepo.latest(work_id).id == second.id
    end

    test "多条历史 TENTATIVE 报告逐行 SUPERSEDED（不再有 update_all 绕过）" do
      work_id = ID.uuid()

      for n <- [1, 2] do
        %ReconciliationReport{}
        |> ReconciliationReport.changeset(%{
          work_id: work_id,
          findings: %{"items" => []},
          finding_count: 0,
          scanned_at_seq: n,
          adoption_status: "TENTATIVE"
        })
        |> Repo.insert!()
      end

      assert {:ok, third} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 30))

      history_statuses =
        Repo.all(
          from(r in ReconciliationReport,
            where: r.work_id == ^work_id and r.id != ^third.id,
            select: r.adoption_status
          )
        )

      assert Enum.sort(history_statuses) == ["SUPERSEDED", "SUPERSEDED"]
      assert ReconciliationReportRepo.latest(work_id).id == third.id
    end

    test "非法状态直写被 changeset 拒绝且原记录不变" do
      work_id = ID.uuid()
      {:ok, report} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 10))
      row = Repo.get!(ReconciliationReport, report.id)

      changeset = ReconciliationReport.changeset(row, %{adoption_status: "ARCHIVED"})
      refute changeset.valid?

      assert {"illegal maintenance transition TENTATIVE -> ARCHIVED", _} =
               changeset.errors[:adoption_status]

      assert Repo.get!(ReconciliationReport, report.id).adoption_status == "TENTATIVE"
    end

    test "stale（SUPERSEDED）报告不能再被裁决翻成 ACCEPTED" do
      work_id = ID.uuid()
      {:ok, first} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 10))
      {:ok, _second} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 20))

      findings = [%{"rule" => "arc_stalled", "disposition" => "dismiss"}]

      assert {:error, %Ecto.Changeset{} = changeset} =
               ReconciliationReportRepo.update_findings(work_id, first.id, findings)

      assert {"illegal maintenance transition SUPERSEDED -> ACCEPTED", _} =
               changeset.errors[:adoption_status]

      assert ReconciliationReportRepo.get(work_id, first.id).adoption_status == "SUPERSEDED"
    end

    test "事务回滚：新报告 insert 失败时旧报告不得被半 supersede" do
      work_id = ID.uuid()
      {:ok, first} = ReconciliationReportRepo.insert_superseding(attrs(work_id, 10))

      invalid_attrs = attrs(work_id, 20) |> Map.put(:findings, nil)

      assert {:error, %Ecto.Changeset{}} =
               ReconciliationReportRepo.insert_superseding(invalid_attrs)

      # 旧报告仍在活跃态，latest 不变，失败的新报告零落库
      assert ReconciliationReportRepo.get(work_id, first.id).adoption_status == "TENTATIVE"
      assert ReconciliationReportRepo.latest(work_id).id == first.id

      assert Repo.aggregate(
               from(r in ReconciliationReport, where: r.work_id == ^work_id),
               :count
             ) == 1
    end
  end
end
