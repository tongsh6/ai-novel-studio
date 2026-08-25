defmodule NovelApplication.D3SummaryRepairTest do
  @moduledoc """
  D3：断供扫描查询 + 补做 runner + reader 包装门控（同步模式零调度，行为不变）。
  """
  use NovelPersistence.DataCase, async: false

  alias NovelPersistence.{ChapterSummaryRepo, Repo, WorkRepo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  defp seed_chapter_with_prose(work_id, title, prose) do
    {:ok, volume} =
      %Volume{} |> Volume.changeset(%{work_id: work_id, title: "第一卷", seq: 1}) |> Repo.insert()

    {:ok, chapter} =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work_id,
        volume_id: volume.id,
        title: title,
        seq: 1,
        status: "DRAFTING"
      })
      |> Repo.insert()

    {:ok, scene} =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert()

    {:ok, _draft} =
      %Draft{}
      |> Draft.changeset(%{
        work_id: work_id,
        scene_id: scene.id,
        content: prose,
        status: "ACCEPTED"
      })
      |> Repo.insert()

    chapter
  end

  test "chapters_missing_summary：有 ACCEPTED 正文无摘要 → 命中；补做后 → 消失" do
    {:ok, work} = WorkRepo.create(%{title: "D3 断供作品"})
    chapter = seed_chapter_with_prose(work.id, "第01章：断供", "他停在巷口，收好账单。")

    missing = ChapterSummaryRepo.chapters_missing_summary(work.id)
    assert [%{chapter_id: chapter_id, prose_text: prose}] = missing
    assert chapter_id == to_string(chapter.id)
    assert prose =~ "收好账单"

    # 补做 runner（test 环境 stub provider 确定性产四栏摘要）
    assert :ok = NovelApplication.run_chapter_summary_repair(work.id)
    assert ChapterSummaryRepo.chapters_missing_summary(work.id) == []

    assert %{summary_text: text} =
             ChapterSummaryRepo.current_accepted(work.id, to_string(chapter.id))

    assert text =~ "【情节推进】"
  end

  test "同步模式下 reader 包装不调度补做（既有行为逐字节不变）" do
    # 单测环境默认不注入真实持久化——临时开启以取得包装后的 reader，退出还原。
    prev = Application.get_env(:novel_web, :persistence)
    Application.put_env(:novel_web, :persistence, inject_real_persistence: true)
    on_exit(fn -> Application.put_env(:novel_web, :persistence, prev) end)

    {:ok, work} = WorkRepo.create(%{title: "D3 门控作品"})
    _chapter = seed_chapter_with_prose(work.id, "第01章：门控", "正文若干。")

    # test 环境 sync=true：读取不触发补做 → 缺失依旧
    reader = NovelApplication.persistence_chapter_summary_reader()
    assert is_nil(reader.by_title.(work.id, "第01章：门控"))
    Process.sleep(50)
    assert [_] = ChapterSummaryRepo.chapters_missing_summary(work.id)
  end
end
