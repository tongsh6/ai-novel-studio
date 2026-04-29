defmodule NovelApplication.MemoryServiceTest do
  use ExUnit.Case, async: false

  alias NovelApplication.MemoryService
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.ID

  setup do
    Ecto.Adapters.SQL.Sandbox.checkout(NovelPersistence.Repo)
    work_id = ID.uuid()
    {:ok, work_id: work_id}
  end

  describe "create/1" do
    test "creates a memory and returns domain struct", %{work_id: wid} do
      {:ok, item} = MemoryService.create(base_attrs(wid))

      assert item.id != nil
      assert item.work_id == wid
      assert item.content == "主角叫张三，今年25岁"
      assert item.status == MemoryStatus.draft()
      assert item.weight == 0.5
      assert item.locked == false
      assert item.recallable == true
      assert item.version == 1
      assert %DateTime{} = item.created_at
    end

    test "accepts optional fields", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(Map.merge(base_attrs(wid), %{
          summary: "张三基本信息",
          weight: 0.8,
          locked: true,
          tags: ["主角", "设定"]
        }))

      assert item.summary == "张三基本信息"
      assert item.weight == 0.8
      assert item.locked == true
      assert item.tags == ["主角", "设定"]
    end
  end

  describe "get/1" do
    test "returns domain struct when found", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, item} = MemoryService.get(created.id)
      assert item.id == created.id
      assert item.content == created.content
    end

    test "returns not_found for non-existent id" do
      assert {:error, :not_found} = MemoryService.get(ID.uuid())
    end
  end

  describe "search/1" do
    setup %{work_id: wid} do
      {:ok, m1} =
        MemoryService.create(Map.merge(base_attrs(wid), %{
          type: MemoryType.world_rule(),
          scope: MemoryScope.global(),
          content: "魔法需要消耗生命力",
          weight: 0.9,
          locked: true
        }))

      {:ok, m2} =
        MemoryService.create(Map.merge(base_attrs(wid), %{
          content: "李四是反派",
          type: MemoryType.character_profile(),
          scope: MemoryScope.work()
        }))

      {:ok, m3} =
        MemoryService.create(Map.merge(base_attrs(wid), %{
          content: "第3章发生在雪山",
          type: MemoryType.plot_fact(),
          scope: MemoryScope.chapter(),
          status: MemoryStatus.confirmed()
        }))

      %{m1: m1, m2: m2, m3: m3, work_id: wid}
    end

    test "filters by work_id", %{m1: m1, m2: m2, work_id: wid} do
      results = MemoryService.search(work_id: wid)
      ids = Enum.map(results, & &1.id)
      assert length(results) == 3
      assert m1.id in ids
      assert m2.id in ids
    end

    test "filters by type", %{m1: m1, work_id: wid} do
      results = MemoryService.search(work_id: wid, type: MemoryType.world_rule())
      assert length(results) == 1
      assert hd(results).id == m1.id
    end

    test "filters by locked", %{m1: m1, work_id: wid} do
      results = MemoryService.search(work_id: wid, locked: true)
      assert length(results) == 1
      assert hd(results).id == m1.id
    end

    test "filters by status", %{m3: m3, work_id: wid} do
      results = MemoryService.search(work_id: wid, status: MemoryStatus.confirmed())
      assert length(results) == 1
      assert hd(results).id == m3.id
    end

    test "keyword search matches content", %{work_id: wid} do
      results = MemoryService.search(work_id: wid, keyword: "雪山")
      assert length(results) == 1
    end

    test "keyword search matches summary", %{work_id: wid} do
      {:ok, _} =
        MemoryService.create(Map.merge(base_attrs(wid), %{
          summary: "关于龙骑士的传说",
          content: "一些内容"
        }))

      results = MemoryService.search(work_id: wid, keyword: "龙骑士")
      assert length(results) >= 1
    end
  end

  describe "confirm/1" do
    test "transitions from DRAFT to CONFIRMED", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, updated} = MemoryService.confirm(created.id)
      assert updated.status == MemoryStatus.confirmed()
    end

    test "returns error for locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(Map.merge(base_attrs(wid), %{locked: true, status: MemoryStatus.confirmed()}))
      assert {:error, :locked} = MemoryService.confirm(created.id)
    end
  end

  describe "lock/1 and unlock/1" do
    test "lock sets locked to true", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, locked} = MemoryService.lock(created.id)
      assert locked.locked == true
    end

    test "unlock sets locked to false", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      {:ok, _} = MemoryService.lock(created.id)
      assert {:ok, unlocked} = MemoryService.unlock(created.id)
      assert unlocked.locked == false
    end
  end

  describe "deprecate/1" do
    test "marks as DEPRECATED and non-recallable", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, deprecated} = MemoryService.deprecate(created.id)
      assert deprecated.status == MemoryStatus.deprecated()
      assert deprecated.recallable == false
    end

    test "returns error for locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(Map.merge(base_attrs(wid), %{locked: true}))
      assert {:error, :locked} = MemoryService.deprecate(created.id)
    end
  end

  describe "archive/1" do
    test "marks as ARCHIVED and non-recallable", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, archived} = MemoryService.archive(created.id)
      assert archived.status == MemoryStatus.archived()
      assert archived.recallable == false
    end
  end

  describe "update_weight/2" do
    test "updates weight", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, updated} = MemoryService.update_weight(created.id, 0.95)
      assert updated.weight == 0.95
    end

    test "returns error for locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(Map.merge(base_attrs(wid), %{locked: true}))
      assert {:error, :locked} = MemoryService.update_weight(created.id, 0.5)
    end
  end

  describe "update_validity/4" do
    test "updates validity range", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      vf = %{"work_id" => wid, "scene_index" => 1}
      vt = %{"work_id" => wid, "scene_index" => 5}

      assert {:ok, updated} =
               MemoryService.update_validity(created.id, vf, vt, "主角离开雪山后失效")

      assert updated.valid_from != nil
      assert updated.expire_condition == "主角离开雪山后失效"
    end
  end

  describe "update_recallable/2" do
    test "toggles recallable", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, updated} = MemoryService.update_recallable(created.id, false)
      assert updated.recallable == false
    end
  end

  describe "full lifecycle" do
    test "create → confirm → lock → deprecate", %{work_id: wid} do
      {:ok, item} = MemoryService.create(base_attrs(wid))
      assert item.status == MemoryStatus.draft()
      assert item.locked == false

      {:ok, confirmed} = MemoryService.confirm(item.id)
      assert confirmed.status == MemoryStatus.confirmed()

      {:ok, locked} = MemoryService.lock(item.id)
      assert locked.locked == true

      assert {:error, :locked} = MemoryService.deprecate(item.id)

      {:ok, _} = MemoryService.unlock(item.id)
      {:ok, deprecated} = MemoryService.deprecate(item.id)
      assert deprecated.status == MemoryStatus.deprecated()
    end
  end

  defp base_attrs(work_id) do
    %{
      work_id: work_id,
      content: "主角叫张三，今年25岁",
      type: MemoryType.character_profile(),
      scope: MemoryScope.work(),
      source_type: MemorySourceType.author_created()
    }
  end
end
