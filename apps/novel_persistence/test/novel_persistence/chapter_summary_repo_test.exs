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
