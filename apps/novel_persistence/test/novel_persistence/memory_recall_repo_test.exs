defmodule NovelPersistence.MemoryRecallRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.ID
  alias NovelPersistence.MemoryRecallRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

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
