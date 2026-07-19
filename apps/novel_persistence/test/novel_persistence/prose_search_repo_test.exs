defmodule NovelPersistence.ProseSearchRepoTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.ProseSearchRepo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  @prose_01 "陈九斤蹲在矿区的出气口边上，把今天的灵气账单摊开在膝盖上。宗门的抽成又涨到了七成。"
  @prose_02 "夜里的矿区没有灯。他想起账单背面记下的那条旧巷——巷子尽头有一处废弃的出气口。"

  describe "search/3 查询整形" do
    test "≥3 字走 MATCH：命中带章出处与引用片段" do
      work_id = Ecto.UUID.generate()
      %{chapter: chapter} = seed_chapter(work_id, "第01章：底层灵气账单", @prose_01, 1)

      assert {:ok, [hit]} = ProseSearchRepo.search(work_id, "灵气账单")
      assert hit.chapter_id == chapter.id
      assert hit.chapter_title == "第01章：底层灵气账单"
      assert hit.snippet =~ "「灵气账单」"
    end

    test "2 字回退 LIKE：仍按作品命中并给出片段" do
      work_id = Ecto.UUID.generate()
      seed_chapter(work_id, "第01章", @prose_01, 1)
      seed_chapter(work_id, "第02章", @prose_02, 2)

      assert {:ok, hits} = ProseSearchRepo.search(work_id, "矿区")
      assert length(hits) == 2
      assert Enum.all?(hits, &(&1.snippet =~ "矿区"))
    end

    test "无命中与空查询诚实返回" do
      work_id = Ecto.UUID.generate()
      seed_chapter(work_id, "第01章", @prose_01, 1)

      assert {:ok, []} = ProseSearchRepo.search(work_id, "剑冢秘藏")
      assert {:error, :empty_query} = ProseSearchRepo.search(work_id, "  ")
      assert {:error, :invalid_work_id} = ProseSearchRepo.search("not-a-uuid", "灵气账单")
    end

    test "tentative 草稿绝不进索引；跨作品隔离" do
      work_id = Ecto.UUID.generate()
      other_work = Ecto.UUID.generate()
      seed_chapter(work_id, "第01章", @prose_01, 1, AdoptionStatus.tentative())
      seed_chapter(other_work, "串线章", @prose_01, 1)

      assert {:ok, []} = ProseSearchRepo.search(work_id, "灵气账单")
    end
  end

  describe "水位惰性重建" do
    test "新采纳的正文在下次检索时可见（无需采纳路径耦合）" do
      work_id = Ecto.UUID.generate()
      seed_chapter(work_id, "第01章", @prose_01, 1)

      assert {:ok, [_]} = ProseSearchRepo.search(work_id, "灵气账单")
      assert {:ok, []} = ProseSearchRepo.search(work_id, "旧巷尽头")

      seed_chapter(work_id, "第02章", @prose_02, 2)

      assert {:ok, [hit]} = ProseSearchRepo.search(work_id, "废弃的出气口")
      assert hit.chapter_title == "第02章"
    end

    test "同 scene 多 revision 只索引最高 accepted revision" do
      work_id = Ecto.UUID.generate()
      %{scene: scene} = seed_chapter(work_id, "第01章", @prose_01, 1)
      insert_draft(work_id, scene.id, "重写后的正文：他把账单折成了纸船。", AdoptionStatus.accepted(), 2)

      assert {:ok, []} = ProseSearchRepo.search(work_id, "灵气账单")
      assert {:ok, [hit]} = ProseSearchRepo.search(work_id, "折成了纸船")
      assert hit.snippet =~ "纸船"
    end
  end

  defp seed_chapter(work_id, chapter_title, content, seq, status \\ nil) do
    status = status || AdoptionStatus.accepted()

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work_id, title: "卷#{seq}", seq: seq})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: chapter_title, seq: seq})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    draft = insert_draft(work_id, scene.id, content, status, 1)

    %{volume: volume, chapter: chapter, scene: scene, draft: draft}
  end

  defp insert_draft(work_id, scene_id, content, status, revision) do
    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene_id,
      content: content,
      status: status,
      revision: revision
    })
    |> Repo.insert!()
  end
end
