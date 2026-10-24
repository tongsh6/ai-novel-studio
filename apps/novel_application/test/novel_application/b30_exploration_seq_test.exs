defmodule NovelApplication.B30ExplorationSeqTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ExplorationService, WorkService}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "重编号后 chapter_read 按当前 seq 解析；旧 seq 不再静默命中；TOC 按新 seq 排序" do
    {:ok, work} = WorkService.create(%{"title" => "B30 探索"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})

    chapters =
      for {title, seq, prose} <- [{"旧第十一章", 11, "井底传来的灯油味。"}, {"旧第十二章", 12, "账册上记着旧名。"}] do
        c = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: title, seq: seq})
        s = Repo.insert!(%Scene{work_id: work.id, chapter_id: c.id, title: "场景 1", seq: 1})

        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: s.id,
          content: prose,
          status: AdoptionStatus.accepted(),
          revision: 1
        })

        c
      end

    [c1, c2] = chapters

    assert {:ok, _} =
             AdoptionRepository.renumber_chapters(
               work.id,
               [%{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 3}],
               [%{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11}]
             )

    # TOC 按当前 seq 排序
    toc = ReadingProjectionRepo.toc(work.id)
    chapter_seqs = toc.volumes |> Enum.flat_map(& &1.chapters) |> Enum.map(& &1.seq)
    assert chapter_seqs == [3, 12]

    # 新 seq 命中同一章；旧 seq 11 不再命中（不静默错位）
    assert {:ok, new_obs} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{"chapter_seq" => 3, "offset" => 0}),
               "session-b30"
             )

    assert new_obs.refs == ["chapter:#{c1.id}"]
    assert new_obs.summary =~ "灯油"

    assert {:ok, old_obs} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{"chapter_seq" => 11, "offset" => 0}),
               "session-b30"
             )

    assert old_obs.summary =~ "没有找到"
    assert old_obs.refs == []

    # prose_search 展示当前 seq（ref 保持同一章身份）
    assert {:ok, search_obs} =
             ExplorationService.run(work.id, "prose_search", "灯油", "session-b30")

    # prose_search 展示当前章节标题（ref 同源；不嵌 seq，无旧编号展示路径）
    assert search_obs.summary =~ "旧第十一章"
    assert Enum.any?(search_obs.refs, &(&1 == "chapter:#{c1.id}"))
    assert is_binary(c2.id)
  end
end
