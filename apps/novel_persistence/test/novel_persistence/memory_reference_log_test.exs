defmodule NovelPersistence.MemoryReferenceLogTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.ID
  alias NovelPersistence.MemoryReferenceLog

  setup do
    Ecto.Adapters.SQL.Sandbox.checkout(NovelPersistence.Repo)
    :ok
  end

  describe "write/1" do
    test "writes a single reference log entry" do
      memory_id = ID.uuid()
      work_id = ID.uuid()

      assert {:ok, record} =
               MemoryReferenceLog.write(%{
                 memory_id: memory_id,
                 work_id: work_id,
                 reference_scene: "chapter_3_drafting",
                 reference_reason: "续写第3章时引用了世界观规则"
               })

      assert record.memory_id == memory_id
      assert record.work_id == work_id
      assert record.reference_scene == "chapter_3_drafting"
      assert record.reference_reason == "续写第3章时引用了世界观规则"
      assert %DateTime{} = record.inserted_at
    end
  end

  describe "batch_write/1" do
    test "writes multiple entries" do
      work_id = ID.uuid()
      m1 = ID.uuid()
      m2 = ID.uuid()

      assert {:ok, 2} =
               MemoryReferenceLog.batch_write([
                 %{memory_id: m1, work_id: work_id, reference_scene: "recall"},
                 %{memory_id: m2, work_id: work_id, reference_scene: "recall"}
               ])
    end
  end

  describe "by_memory/1" do
    test "returns reference logs for a memory" do
      memory_id = ID.uuid()
      work_id = ID.uuid()

      MemoryReferenceLog.write(%{
        memory_id: memory_id,
        work_id: work_id,
        reference_scene: "scene_a"
      })

      MemoryReferenceLog.write(%{
        memory_id: memory_id,
        work_id: work_id,
        reference_scene: "scene_b"
      })

      logs = MemoryReferenceLog.by_memory(memory_id)
      assert length(logs) == 2
      assert Enum.at(logs, 0).reference_scene == "scene_b"
      assert Enum.at(logs, 1).reference_scene == "scene_a"
    end
  end

  describe "by_scene/2" do
    test "filters by work and scene" do
      work_id = ID.uuid()

      MemoryReferenceLog.write(%{
        memory_id: ID.uuid(),
        work_id: work_id,
        reference_scene: "chapter_5_drafting"
      })

      MemoryReferenceLog.write(%{
        memory_id: ID.uuid(),
        work_id: work_id,
        reference_scene: "other"
      })

      logs = MemoryReferenceLog.by_scene(work_id, "chapter_5_drafting")
      assert length(logs) == 1
    end
  end
end
