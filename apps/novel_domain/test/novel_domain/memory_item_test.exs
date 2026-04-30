defmodule NovelDomain.MemoryItemTest do
  use ExUnit.Case, async: true

  alias NovelDomain.MemoryItem
  alias NovelDomain.NarrativePosition
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType

  describe "new/6" do
    test "creates a memory item with defaults" do
      item =
        MemoryItem.new(
          "mem_001",
          "work_001",
          "主角叫张三",
          MemoryType.character_profile(),
          MemoryScope.work(),
          MemorySourceType.author_created()
        )

      assert item.id == "mem_001"
      assert item.work_id == "work_001"
      assert item.content == "主角叫张三"
      assert item.type == MemoryType.character_profile()
      assert item.scope == MemoryScope.work()
      assert item.source_type == MemorySourceType.author_created()

      assert item.status == MemoryStatus.draft()
      assert item.weight == 0.5
      assert item.confidence == 0.5
      assert item.source_confidence == 0.5
      assert item.locked == false
      assert item.recallable == true
      assert item.common_sense == false
      assert item.version == 1
      assert item.reference_count == 0

      assert item.summary == nil
      assert item.source_id == nil
      assert item.volume_id == nil
      assert item.arc_id == nil
      assert item.chapter_id == nil
      assert item.valid_from == nil
      assert item.valid_until == nil
      assert item.expire_condition == nil
      assert item.tags == nil
      assert item.last_referenced_at == nil

      assert %DateTime{} = item.created_at
      assert %DateTime{} = item.updated_at
    end
  end

  describe "confirm/1" do
    test "marks status as CONFIRMED" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      confirmed = MemoryItem.confirm(item)
      assert confirmed.status == MemoryStatus.confirmed()
      assert DateTime.compare(confirmed.updated_at, item.updated_at) == :gt
    end
  end

  describe "stabilize/1" do
    test "marks status as STABILIZED" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      stabilized = MemoryItem.stabilize(item)
      assert stabilized.status == MemoryStatus.stabilized()
    end
  end

  describe "lock/1 and unlock/1" do
    test "lock sets locked to true" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      locked = MemoryItem.lock(item)
      assert locked.locked == true
    end

    test "unlock sets locked to false" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )
        |> MemoryItem.lock()
        |> MemoryItem.unlock()

      assert item.locked == false
    end
  end

  describe "deprecate/1" do
    test "marks as DEPRECATED and non-recallable" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      deprecated = MemoryItem.deprecate(item)
      assert deprecated.status == MemoryStatus.deprecated()
      assert deprecated.recallable == false
    end
  end

  describe "archive/1" do
    test "marks as ARCHIVED and non-recallable" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      archived = MemoryItem.archive(item)
      assert archived.status == MemoryStatus.archived()
      assert archived.recallable == false
    end
  end

  describe "update_weight/2" do
    test "updates weight" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      updated = MemoryItem.update_weight(item, 0.9)
      assert updated.weight == 0.9
      assert DateTime.compare(updated.updated_at, item.updated_at) == :gt
    end
  end

  describe "update_confidence/2" do
    test "updates confidence" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      updated = MemoryItem.update_confidence(item, 0.8)
      assert updated.confidence == 0.8
    end
  end

  describe "update_validity/4" do
    test "updates validity range" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      vf = NarrativePosition.new("w1")
      vt = %NarrativePosition{work_id: "w1", chapter_id: "c5"}
      updated = MemoryItem.update_validity(item, vf, vt, "主角死亡后失效")
      assert updated.valid_from == vf
      assert updated.valid_until == vt
      assert updated.expire_condition == "主角死亡后失效"
    end
  end

  describe "update_recallable/2" do
    test "toggles recallable" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      updated = MemoryItem.update_recallable(item, false)
      assert updated.recallable == false
    end
  end

  describe "update_summary/2" do
    test "updates summary" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      updated = MemoryItem.update_summary(item, "主角叫张三，25岁")
      assert updated.summary == "主角叫张三，25岁"
    end
  end

  describe "iron_law?/1" do
    test "returns true for weight>=0.9 + CONFIRMED + locked + AUTHOR_CONFIRMED" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )
        |> MemoryItem.confirm()
        |> MemoryItem.lock()
        |> MemoryItem.update_weight(0.95)

      assert MemoryItem.iron_law?(item) == true
    end

    test "returns false for low weight" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )
        |> MemoryItem.confirm()
        |> MemoryItem.lock()

      assert MemoryItem.iron_law?(item) == false
    end

    test "returns false for DRAFT status" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )
        |> MemoryItem.lock()
        |> MemoryItem.update_weight(0.95)

      assert MemoryItem.iron_law?(item) == false
    end
  end

  describe "modifiable?/1" do
    test "returns false when locked" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )
        |> MemoryItem.lock()

      assert MemoryItem.modifiable?(item) == false
    end

    test "returns true when not locked" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      assert MemoryItem.modifiable?(item) == true
    end
  end

  describe "increment_reference/1" do
    test "increments reference_count and updates last_referenced_at" do
      item =
        MemoryItem.new(
          "m1",
          "w1",
          "内容",
          MemoryType.world_rule(),
          MemoryScope.global(),
          MemorySourceType.author_confirmed()
        )

      updated = MemoryItem.increment_reference(item)
      assert updated.reference_count == 1
      assert %DateTime{} = updated.last_referenced_at
      assert DateTime.compare(updated.last_referenced_at, item.created_at) == :gt
    end
  end
end
