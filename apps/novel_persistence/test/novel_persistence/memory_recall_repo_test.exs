defmodule NovelPersistence.MemoryRecallRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.ID
  alias NovelPersistence.MemoryRecallRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  describe "recall/3" do
    test "returns only current-work confirmed recallable memories that match the author input" do
      work_id = ID.uuid()
      other_work_id = ID.uuid()

      mineral =
        insert_memory!(%{
          work_id: work_id,
          content: "林瑶失踪与灵源矿区有关",
          summary: "林瑶失踪指向灵源矿区",
          status: MemoryStatus.confirmed(),
          recallable: true,
          weight: Decimal.new("0.9000"),
          confidence: Decimal.new("0.8000")
        })

      _draft =
        insert_memory!(%{
          work_id: work_id,
          content: "未确认草稿不能召回：矿区里有龙",
          status: MemoryStatus.draft(),
          recallable: true
        })

      _archived =
        insert_memory!(%{
          work_id: work_id,
          content: "已归档设定不能召回：矿区旧版本",
          status: MemoryStatus.archived(),
          recallable: false
        })

      _other_work =
        insert_memory!(%{
          work_id: other_work_id,
          content: "另一个作品的矿区设定不能串入当前作品",
          status: MemoryStatus.confirmed(),
          recallable: true
        })

      memories = MemoryRecallRepo.recall(work_id, "林烬为什么要去灵源矿区？")

      assert Enum.map(memories, & &1.id) == [mineral.id]
      assert hd(memories).score > 0
      assert MemoryRecallRepo.summary(memories) =~ "林瑶失踪指向灵源矿区"
    end

    test "returns no memory when the current input has no lexical match" do
      work_id = ID.uuid()

      insert_memory!(%{
        work_id: work_id,
        content: "林瑶失踪指向灵源矿区",
        status: MemoryStatus.confirmed(),
        recallable: true
      })

      assert MemoryRecallRepo.recall(work_id, "今天聊一下叙事节奏") == []
      assert MemoryRecallRepo.summary([]) == nil
    end

    test "validity window excludes out-of-window memory, keeps in-window and unwindowed (AU09-I6)" do
      # 窗口边界 chapter_id 是章节 UUID（NarrativePosition）。当前位置=已采纳最大 seq=5。
      work_id = ID.uuid()
      ch1 = insert_accepted_chapter!(work_id, 1)
      ch2 = insert_accepted_chapter!(work_id, 2)
      ch4 = insert_accepted_chapter!(work_id, 4)
      _ch5 = insert_accepted_chapter!(work_id, 5)
      ch6 = insert_chapter!(work_id, 6)

      out_of_window =
        insert_memory!(%{
          work_id: work_id,
          content: "盘古碑只在序章短暂出现",
          status: MemoryStatus.confirmed(),
          recallable: true,
          valid_from: %{"chapter_id" => ch1.id},
          valid_until: %{"chapter_id" => ch2.id}
        })

      covering =
        insert_memory!(%{
          work_id: work_id,
          content: "盘古碑的真正力量在中段揭示",
          status: MemoryStatus.confirmed(),
          recallable: true,
          valid_from: %{"chapter_id" => ch4.id},
          valid_until: %{"chapter_id" => ch6.id}
        })

      unwindowed =
        insert_memory!(%{
          work_id: work_id,
          content: "盘古碑是贯穿全书的核心法器",
          status: MemoryStatus.confirmed(),
          recallable: true
        })

      assert MemoryRecallRepo.current_chapter_position(work_id) == 5

      ids =
        work_id
        |> MemoryRecallRepo.recall("讲讲盘古碑")
        |> Enum.map(& &1.id)

      refute out_of_window.id in ids
      assert covering.id in ids
      assert unwindowed.id in ids
    end

    test "without an accepted chapter, current position is unknown and windows do not restrict" do
      work_id = ID.uuid()

      # 章节存在但无已采纳草稿 → 窗口边界可定位，但 current_position 仍未知。
      chapter = insert_chapter!(work_id, 2)

      windowed =
        insert_memory!(%{
          work_id: work_id,
          content: "盘古碑只在序章出现",
          status: MemoryStatus.confirmed(),
          recallable: true,
          valid_until: %{"chapter_id" => chapter.id}
        })

      assert MemoryRecallRepo.current_chapter_position(work_id) == nil

      ids =
        work_id
        |> MemoryRecallRepo.recall("讲讲盘古碑")
        |> Enum.map(& &1.id)

      assert windowed.id in ids
    end

    test "window referencing a non-existent chapter does not restrict that bound" do
      work_id = ID.uuid()
      insert_accepted_chapter!(work_id, 5)

      # valid_until 指向不存在的章节 UUID → 该侧无法定位 → 不约束；无下界 → 召回。
      windowed =
        insert_memory!(%{
          work_id: work_id,
          content: "盘古碑的传说仍在流传",
          status: MemoryStatus.confirmed(),
          recallable: true,
          valid_until: %{"chapter_id" => ID.uuid()}
        })

      ids =
        work_id
        |> MemoryRecallRepo.recall("讲讲盘古碑")
        |> Enum.map(& &1.id)

      assert windowed.id in ids
    end
  end

  describe "current_chapter_position/1" do
    test "returns the max accepted chapter seq" do
      work_id = ID.uuid()
      insert_accepted_chapter!(work_id, 2)
      insert_accepted_chapter!(work_id, 5)
      insert_accepted_chapter!(work_id, 3)

      assert MemoryRecallRepo.current_chapter_position(work_id) == 5
    end
  end

  defp insert_accepted_chapter!(work_id, seq) do
    volume =
      %Volume{} |> Volume.changeset(%{work_id: work_id, title: "卷", seq: 1}) |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: "第#{seq}章", seq: seq})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "场景", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: "已采纳正文",
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    chapter
  end

  # 只建章节行（无已采纳草稿）：进 chapter_seq_map 供窗口边界定位，但不抬高 current_position。
  defp insert_chapter!(work_id, seq) do
    volume =
      %Volume{} |> Volume.changeset(%{work_id: work_id, title: "卷", seq: 1}) |> Repo.insert!()

    %Chapter{}
    |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: "第#{seq}章", seq: seq})
    |> Repo.insert!()
  end

  defp insert_memory!(attrs) do
    attrs =
      Map.merge(
        %{
          id: ID.uuid(),
          type: MemoryType.plot_fact(),
          scope: MemoryScope.work(),
          source_type: MemorySourceType.author_confirmed(),
          status: MemoryStatus.confirmed(),
          recallable: true,
          content: "测试记忆"
        },
        attrs
      )

    %MemoryItem{}
    |> MemoryItem.changeset(attrs)
    |> Repo.insert!()
  end
end
