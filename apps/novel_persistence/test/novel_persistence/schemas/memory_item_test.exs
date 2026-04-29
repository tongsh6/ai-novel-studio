defmodule NovelPersistence.Schemas.MemoryItemTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.ID
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

  describe "changeset/2" do
    test "valid attributes produce a valid changeset" do
      attrs = %{
        id: ID.uuid(),
        work_id: ID.uuid(),
        content: "主角叫张三",
        type: MemoryType.character_profile(),
        scope: MemoryScope.work(),
        source_type: MemorySourceType.author_created()
      }

      cs = MemoryItem.changeset(%MemoryItem{}, attrs)
      assert cs.valid?
    end

    test "requires mandatory fields" do
      cs = MemoryItem.changeset(%MemoryItem{}, %{})
      refute cs.valid?
      assert Keyword.has_key?(cs.errors, :id)
      assert Keyword.has_key?(cs.errors, :work_id)
      assert Keyword.has_key?(cs.errors, :content)
      assert Keyword.has_key?(cs.errors, :source_type)
    end

    test "validates enum inclusion" do
      cs = MemoryItem.changeset(%MemoryItem{}, %{type: "INVALID"})
      refute cs.valid?
      assert Keyword.has_key?(cs.errors, :type)
    end

    test "validates type against MemoryType values" do
      attrs = %{
        id: ID.uuid(),
        work_id: ID.uuid(),
        content: "...",
        type: MemoryType.world_rule(),
        scope: MemoryScope.global(),
        source_type: MemorySourceType.author_confirmed()
      }

      cs = MemoryItem.changeset(%MemoryItem{}, attrs)
      assert cs.valid?
    end

    test "applies defaults for status, weight, confidence, locked, recallable" do
      attrs = %{
        id: ID.uuid(),
        work_id: ID.uuid(),
        content: "...",
        type: MemoryType.world_rule(),
        scope: MemoryScope.global(),
        source_type: MemorySourceType.author_confirmed()
      }

      {:ok, item} =
        %MemoryItem{}
        |> MemoryItem.changeset(attrs)
        |> Repo.insert()

      assert item.status == MemoryStatus.draft()
      assert Decimal.to_float(item.weight) == 0.5
      assert item.locked == false
      assert item.recallable == true
      assert item.common_sense == false
      assert item.version == 1
      assert item.reference_count == 0
    end

    test "weight outside 0..1 range is invalid" do
      cs =
        MemoryItem.changeset(%MemoryItem{}, %{
          id: ID.uuid(),
          work_id: ID.uuid(),
          content: "...",
          type: MemoryType.world_rule(),
          scope: MemoryScope.global(),
          source_type: MemorySourceType.author_confirmed(),
          weight: 1.5
        })

      refute cs.valid?
      assert Keyword.has_key?(cs.errors, :weight)
    end
  end

  describe "insert and read" do
    test "can insert and read back a memory item" do
      id = ID.uuid()
      work_id = ID.uuid()

      attrs = %{
        id: id,
        work_id: work_id,
        content: "主角叫张三，今年25岁",
        summary: "主角基本信息",
        type: MemoryType.character_profile(),
        scope: MemoryScope.work(),
        source_type: MemorySourceType.author_confirmed(),
        weight: Decimal.new("0.9000"),
        locked: true,
        tags: ["主角", "设定"]
      }

      %MemoryItem{}
      |> MemoryItem.changeset(attrs)
      |> Repo.insert!()

      item = Repo.get!(MemoryItem, id)
      assert item.content == "主角叫张三，今年25岁"
      assert item.type == MemoryType.character_profile()
      assert item.source_type == MemorySourceType.author_confirmed()
      assert item.tags == ["主角", "设定"]
      assert Decimal.to_float(item.weight) == 0.9
      assert item.locked == true
    end
  end

  describe "update_changeset/2" do
    test "allows updating non-identity fields" do
      id = ID.uuid()
      work_id = ID.uuid()

      {:ok, item} =
        %MemoryItem{}
        |> MemoryItem.changeset(%{
          id: id,
          work_id: work_id,
          content: "v1",
          type: MemoryType.world_rule(),
          scope: MemoryScope.global(),
          source_type: MemorySourceType.author_confirmed()
        })
        |> Repo.insert()

      cs = MemoryItem.update_changeset(item, %{content: "v2", summary: "更新摘要"})
      assert cs.valid?

      {:ok, updated} = Repo.update(cs)
      assert updated.content == "v2"
      assert updated.summary == "更新摘要"
    end
  end
end
