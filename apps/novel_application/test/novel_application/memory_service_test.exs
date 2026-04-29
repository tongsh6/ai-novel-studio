defmodule NovelApplication.MemoryServiceTest do
  use ExUnit.Case, async: false

  alias NovelApplication.MemoryService
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.ID
  alias NovelPersistence.MutationLog

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

    test "records an applied mutation for traceability", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            actor_ref: "author-1",
            source_turn_ref: "turn-memory-create"
          })
        )

      assert [mutation] = MutationLog.list_by_object(item.id)
      assert mutation.actor_ref == "author-1"
      assert mutation.source_turn_ref == "turn-memory-create"
      assert mutation.target_scope == "memory_item"
      assert mutation.target_object_ref == item.id
      assert mutation.base_revision == 1
      assert mutation.mutation_type == "memory.create"
      assert mutation.status == "APPLIED"
      assert mutation.authority_scope == "production_write"
    end

    test "accepts optional fields", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            summary: "张三基本信息",
            status: MemoryStatus.confirmed(),
            weight: 0.8,
            locked: true,
            tags: ["主角", "设定"]
          })
        )

      assert item.summary == "张三基本信息"
      assert item.weight == 0.8
      assert item.locked == true
      assert item.tags == ["主角", "设定"]
    end

    test "uses source defaults when weight and confidence are omitted", %{work_id: wid} do
      attrs =
        base_attrs(wid)
        |> Map.delete(:weight)
        |> Map.delete(:confidence)
        |> Map.delete(:source_confidence)
        |> Map.put(:source_type, MemorySourceType.author_confirmed())

      {:ok, item} = MemoryService.create(attrs)

      assert item.weight == 0.95
      assert item.confidence == 0.95
      assert item.source_confidence == 0.95
    end

    test "rejects locked draft memory", %{work_id: wid} do
      assert {:error, %Ecto.Changeset{} = changeset} =
               MemoryService.create(Map.merge(base_attrs(wid), %{locked: true}))

      assert %{locked: [_ | _]} = errors_on(changeset)
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

  describe "get/2" do
    test "returns not_found when memory belongs to another work", %{work_id: wid} do
      other_work_id = ID.uuid()
      {:ok, created} = MemoryService.create(base_attrs(other_work_id))

      assert {:error, :not_found} = MemoryService.get(wid, created.id)
    end
  end

  describe "search/1" do
    setup %{work_id: wid} do
      {:ok, m1} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            type: MemoryType.world_rule(),
            scope: MemoryScope.global(),
            content: "魔法需要消耗生命力",
            weight: 0.9,
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      {:ok, m2} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            content: "李四是反派",
            type: MemoryType.character_profile(),
            scope: MemoryScope.work()
          })
        )

      {:ok, m3} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            content: "第3章发生在雪山",
            type: MemoryType.plot_fact(),
            scope: MemoryScope.chapter(),
            status: MemoryStatus.confirmed()
          })
        )

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
      ids = Enum.map(results, & &1.id)
      assert m3.id in ids
      assert Enum.all?(results, &(&1.status == MemoryStatus.confirmed()))
    end

    test "keyword search matches content", %{work_id: wid} do
      results = MemoryService.search(work_id: wid, keyword: "雪山")
      assert length(results) == 1
    end

    test "keyword search matches summary", %{work_id: wid} do
      {:ok, _} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            summary: "关于龙骑士的传说",
            content: "一些内容"
          })
        )

      results = MemoryService.search(work_id: wid, keyword: "龙骑士")
      assert length(results) >= 1
    end
  end

  describe "confirm/1" do
    test "transitions from DRAFT to CONFIRMED", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, updated} = MemoryService.confirm(created.id)
      assert updated.status == MemoryStatus.confirmed()
      assert updated.version == created.version + 1

      assert [confirm_mutation, create_mutation] = MutationLog.list_by_object(created.id)
      assert confirm_mutation.mutation_type == "memory.confirm"
      assert confirm_mutation.base_revision == created.version
      assert create_mutation.mutation_type == "memory.create"
    end

    test "returns error for locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{locked: true, status: MemoryStatus.confirmed()})
        )

      assert {:error, :locked} = MemoryService.confirm(created.id)
    end
  end

  describe "locked terminal transitions" do
    test "deprecate refuses locked memory", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      assert {:error, :locked} = MemoryService.deprecate(item.id)
      assert {:ok, unchanged} = MemoryService.get(item.id)
      assert unchanged.status == MemoryStatus.confirmed()
      assert unchanged.locked == true
    end

    test "archive refuses locked memory", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      assert {:error, :locked} = MemoryService.archive(item.id)
      assert {:ok, unchanged} = MemoryService.get(item.id)
      assert unchanged.status == MemoryStatus.confirmed()
      assert unchanged.locked == true
    end
  end

  describe "lock/1 and unlock/1" do
    test "lock sets locked to true", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      {:ok, confirmed} = MemoryService.confirm(created.id)
      assert {:ok, locked} = MemoryService.lock(confirmed.id)
      assert locked.locked == true
    end

    test "unlock sets locked to false", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      {:ok, confirmed} = MemoryService.confirm(created.id)
      {:ok, _} = MemoryService.lock(confirmed.id)
      assert {:ok, unlocked} = MemoryService.unlock(created.id)
      assert unlocked.locked == false
    end

    test "lock rejects draft memory", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:error, :invalid_status} = MemoryService.lock(created.id)
    end
  end

  describe "deprecate/1" do
    test "marks as DEPRECATED and non-recallable", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, deprecated} = MemoryService.deprecate(created.id)
      assert deprecated.status == MemoryStatus.deprecated()
      assert deprecated.recallable == false
    end

    test "refuses locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{status: MemoryStatus.confirmed(), locked: true})
        )

      assert {:error, :locked} = MemoryService.deprecate(created.id)
      assert {:ok, unchanged} = MemoryService.get(created.id)
      assert unchanged.status == MemoryStatus.confirmed()
      assert unchanged.locked == true
      assert unchanged.recallable == true
    end
  end

  describe "archive/1" do
    test "marks as ARCHIVED and non-recallable", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))
      assert {:ok, archived} = MemoryService.archive(created.id)
      assert archived.status == MemoryStatus.archived()
      assert archived.recallable == false
    end

    test "refuses locked memory", %{work_id: wid} do
      {:ok, created} =
        MemoryService.create(
          Map.merge(base_attrs(wid), %{status: MemoryStatus.confirmed(), locked: true})
        )

      assert {:error, :locked} = MemoryService.archive(created.id)
      assert {:ok, unchanged} = MemoryService.get(created.id)
      assert unchanged.status == MemoryStatus.confirmed()
      assert unchanged.locked == true
      assert unchanged.recallable == true
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
        MemoryService.create(
          Map.merge(base_attrs(wid), %{status: MemoryStatus.confirmed(), locked: true})
        )

      assert {:error, :locked} = MemoryService.update_weight(created.id, 0.5)
    end

    test "returns changeset error for invalid weight", %{work_id: wid} do
      {:ok, created} = MemoryService.create(base_attrs(wid))

      assert {:error, %Ecto.Changeset{}} = MemoryService.update_weight(created.id, 1.5)
    end
  end

  describe "work-scoped status updates" do
    test "does not mutate memory through another work id", %{work_id: wid} do
      other_work_id = ID.uuid()
      {:ok, created} = MemoryService.create(base_attrs(other_work_id))

      assert {:error, :not_found} = MemoryService.confirm(wid, created.id)
      assert {:ok, item} = MemoryService.get(other_work_id, created.id)
      assert item.status == MemoryStatus.draft()
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

  describe "reference logs" do
    test "lists references only after work-scoped memory check", %{work_id: wid} do
      {:ok, item} = MemoryService.create(base_attrs(wid))

      {:ok, _} =
        MemoryService.write_reference(%{
          memory_id: item.id,
          work_id: wid,
          reference_scene: "testing"
        })

      assert {:ok, [log]} = MemoryService.list_references(wid, item.id)
      assert log.reference_scene == "testing"
      assert {:error, :not_found} = MemoryService.list_references(ID.uuid(), item.id)
    end

    test "record_references writes logs and updates counters", %{work_id: wid} do
      {:ok, item} = MemoryService.create(base_attrs(wid))

      assert {:ok, 1} =
               MemoryService.record_references([
                 %{
                   memory_id: item.id,
                   work_id: wid,
                   reference_scene: "testing"
                 }
               ])

      assert {:ok, updated} = MemoryService.get(item.id)
      assert updated.reference_count == item.reference_count + 1
      assert %DateTime{} = updated.last_referenced_at
    end
  end

  describe "full lifecycle" do
    test "create → confirm → lock blocks deprecate until unlock", %{work_id: wid} do
      {:ok, item} = MemoryService.create(base_attrs(wid))
      assert item.status == MemoryStatus.draft()
      assert item.locked == false

      {:ok, confirmed} = MemoryService.confirm(item.id)
      assert confirmed.status == MemoryStatus.confirmed()

      {:ok, locked} = MemoryService.lock(item.id)
      assert locked.locked == true

      assert {:error, :locked} = MemoryService.deprecate(item.id)

      {:ok, unlocked} = MemoryService.unlock(item.id)
      assert unlocked.locked == false

      {:ok, deprecated} = MemoryService.deprecate(item.id)
      assert deprecated.status == MemoryStatus.deprecated()
      assert deprecated.locked == false
    end
  end

  defp base_attrs(work_id) do
    %{
      work_id: work_id,
      content: "主角叫张三，今年25岁",
      type: MemoryType.character_profile(),
      scope: MemoryScope.work(),
      source_type: MemorySourceType.author_created(),
      weight: 0.5,
      confidence: 0.5,
      source_confidence: 0.5
    }
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Enum.reduce(opts, message, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
