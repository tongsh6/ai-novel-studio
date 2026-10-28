defmodule NovelPersistence.ChapterSummaryRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.ID
  alias NovelPersistence.ChapterSummaryRepo

  setup do
    %{work_id: ID.uuid(), chapter_id: ID.uuid()}
  end

  defp insert_tentative(work_id, chapter_id, text \\ "摘要") do
    ChapterSummaryRepo.insert(%{
      work_id: work_id,
      chapter_id: chapter_id,
      status: AdoptionStatus.tentative(),
      summary_text: text
    })
  end

  test "insert tentative 后 current_accepted 为 nil", %{work_id: w, chapter_id: c} do
    assert {:ok, row} = insert_tentative(w, c)
    assert row.status == "TENTATIVE"
    assert ChapterSummaryRepo.current_accepted(w, c) == nil
  end

  test "update_status 到 ACCEPTED 后 current_accepted 命中", %{work_id: w, chapter_id: c} do
    {:ok, row} = insert_tentative(w, c)
    assert {:ok, accepted} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())
    assert accepted.status == "ACCEPTED"

    current = ChapterSummaryRepo.current_accepted(w, c)
    assert current.id == accepted.id
    assert current.status == "ACCEPTED"
  end

  test "supersede_prior_accepted 把旧 ACCEPTED 置 SUPERSEDED", %{work_id: w, chapter_id: c} do
    {:ok, row} = insert_tentative(w, c)
    {:ok, _} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())

    assert {:ok, 1} = ChapterSummaryRepo.supersede_prior_accepted(w, c)
    assert ChapterSummaryRepo.current_accepted(w, c) == nil
    assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, row.id).status == "SUPERSEDED"
  end

  test "supersede 对无 ACCEPTED 的章是 0 行 no-op", %{work_id: w, chapter_id: c} do
    {:ok, _} = insert_tentative(w, c)
    assert {:ok, 0} = ChapterSummaryRepo.supersede_prior_accepted(w, c)
  end

  describe "ADR-0019 转换矩阵（B44 持久化边界）" do
    test "update_status 非法 ACCEPTED→TENTATIVE 被拒且原记录不变", %{
      work_id: w,
      chapter_id: c
    } do
      {:ok, row} = insert_tentative(w, c)
      {:ok, accepted} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())

      assert {:error, %Ecto.Changeset{} = changeset} =
               ChapterSummaryRepo.update_status(accepted, AdoptionStatus.tentative())

      assert {"illegal adoption transition ACCEPTED -> TENTATIVE", _} =
               changeset.errors[:status]

      # 事务/写入未落地：库内仍是 ACCEPTED
      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, row.id).status == "ACCEPTED"
      assert ChapterSummaryRepo.current_accepted(w, c).id == row.id
    end

    test "update_status 非法 TENTATIVE→SUPERSEDED 被拒（不可跳过采纳直达退场）", %{
      work_id: w,
      chapter_id: c
    } do
      {:ok, row} = insert_tentative(w, c)

      assert {:error, %Ecto.Changeset{} = changeset} =
               ChapterSummaryRepo.update_status(row, AdoptionStatus.superseded())

      assert {"illegal adoption transition TENTATIVE -> SUPERSEDED", _} =
               changeset.errors[:status]

      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, row.id).status == "TENTATIVE"
    end

    test "insert 以非法非初始态 SUPERSEDED 落库被拒", %{work_id: w, chapter_id: c} do
      assert {:error, %Ecto.Changeset{} = changeset} =
               ChapterSummaryRepo.insert(%{
                 work_id: w,
                 chapter_id: c,
                 status: AdoptionStatus.superseded(),
                 summary_text: "直接以退场态落库"
               })

      assert {"illegal adoption transition TENTATIVE -> SUPERSEDED", _} =
               changeset.errors[:status]

      assert Repo.all(NovelPersistence.Schemas.ChapterSummary) == []
    end

    test "合法 TENTATIVE→ACCEPTED→SUPERSEDED 经 repo 仍通过", %{work_id: w, chapter_id: c} do
      {:ok, row} = insert_tentative(w, c)
      assert {:ok, accepted} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())

      assert {:ok, superseded} =
               ChapterSummaryRepo.update_status(accepted, AdoptionStatus.superseded())

      assert superseded.status == "SUPERSEDED"
    end

    test "supersede_prior_accepted 批量逐行 supersede 全部 ACCEPTED 并计数", %{
      work_id: w,
      chapter_id: c
    } do
      {:ok, a} = insert_tentative(w, c, "摘要 A")
      {:ok, b} = insert_tentative(w, c, "摘要 B")
      {:ok, _} = ChapterSummaryRepo.update_status(a, AdoptionStatus.accepted())
      {:ok, _} = ChapterSummaryRepo.update_status(b, AdoptionStatus.accepted())
      {:ok, pending} = insert_tentative(w, c, "未采纳摘要")

      assert {:ok, 2} = ChapterSummaryRepo.supersede_prior_accepted(w, c)

      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, a.id).status == "SUPERSEDED"
      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, b.id).status == "SUPERSEDED"
      # 非 ACCEPTED 的 TENTATIVE 不被触碰
      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, pending.id).status == "TENTATIVE"
      assert ChapterSummaryRepo.current_accepted(w, c) == nil
    end

    test "合法维护序列：旧 ACCEPTED 退场 → 新摘要自动采纳 → current 指向新摘要", %{
      work_id: w,
      chapter_id: c
    } do
      # 与 ChapterSummaryMaintenance.do_run/4 的生产顺序一致：
      # supersede 旧 ACCEPTED → insert 新 TENTATIVE → update_status ACCEPTED。
      {:ok, old} = insert_tentative(w, c, "旧摘要")
      {:ok, _} = ChapterSummaryRepo.update_status(old, AdoptionStatus.accepted())

      assert {:ok, 1} = ChapterSummaryRepo.supersede_prior_accepted(w, c)

      {:ok, new} = insert_tentative(w, c, "新摘要")
      assert {:ok, accepted} = ChapterSummaryRepo.update_status(new, AdoptionStatus.accepted())

      assert accepted.id == new.id
      assert Repo.get!(NovelPersistence.Schemas.ChapterSummary, old.id).status == "SUPERSEDED"
      assert ChapterSummaryRepo.current_accepted(w, c).id == new.id
      assert [current] = ChapterSummaryRepo.list_recent_accepted(w, 10)
      assert current.id == new.id
    end
  end

  test "list_recent_accepted 只取本作品 ACCEPTED", %{work_id: w} do
    c1 = ID.uuid()
    c2 = ID.uuid()
    {:ok, r1} = insert_tentative(w, c1, "第一章")
    {:ok, _} = ChapterSummaryRepo.update_status(r1, AdoptionStatus.accepted())
    {:ok, r2} = insert_tentative(w, c2, "第二章")
    {:ok, _} = ChapterSummaryRepo.update_status(r2, AdoptionStatus.accepted())
    # 另一章仍 tentative，不应出现
    {:ok, _} = insert_tentative(w, ID.uuid(), "未采纳")

    rows = ChapterSummaryRepo.list_recent_accepted(w, 10)
    assert length(rows) == 2
    assert Enum.all?(rows, &(&1.status == "ACCEPTED"))
    assert Enum.all?(rows, &(&1.work_id == w))
  end
end
