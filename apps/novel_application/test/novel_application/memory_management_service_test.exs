defmodule NovelApplication.MemoryManagementServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{MemoryManagementService, WorkService}
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{"title" => "记忆管理作品"})
    {:ok, other_work} = WorkService.create(%{"title" => "隔离作品"})
    %{work: work, other_work: other_work}
  end

  test "create and list are scoped to the current work", %{work: work, other_work: other_work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "林瑶失踪与灵源矿区有关",
        "summary" => "林瑶矿区线索",
        "type" => MemoryType.foreshadowing(),
        "scope" => "WORK",
        "status" => MemoryStatus.confirmed(),
        "source_type" => MemorySourceType.author_created(),
        "tags" => ["主线"]
      })

    {:ok, _other} =
      MemoryManagementService.create(other_work.id, %{
        "content" => "其他作品设定",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    assert memory.work_id == work.id
    assert memory.status == MemoryStatus.draft()

    assert {:ok, %{items: [listed], count: 1}} =
             MemoryManagementService.list(work.id, %{"keyword" => "灵源"})

    assert listed.id == memory.id
  end

  test "lifecycle actions consume schema/domain guard side effects", %{work: work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "灵源矿区不能公开进入",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    {:ok, confirmed} = MemoryManagementService.confirm(work.id, memory.id)
    assert confirmed.status == MemoryStatus.confirmed()
    assert confirmed.source_type == MemorySourceType.author_confirmed()

    {:ok, locked} = MemoryManagementService.lock(work.id, memory.id)
    assert locked.locked == true

    {:ok, deprecated} = MemoryManagementService.deprecate(work.id, memory.id)
    assert deprecated.status == MemoryStatus.deprecated()
    assert deprecated.locked == false
    assert deprecated.recallable == false
  end

  test "invalid governance metadata is rejected by the schema boundary", %{work: work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "尚未确认的设定",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    assert {:error, %Ecto.Changeset{} = changeset} =
             MemoryManagementService.update_weight(work.id, memory.id, 1.5)

    assert Keyword.has_key?(changeset.errors, :weight)
  end

  test "references are scoped by work", %{work: work, other_work: other_work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "林烬记得矿区路线",
        "type" => MemoryType.plot_fact(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: memory.id,
        work_id: work.id,
        reference_scene: "recall",
        reference_reason: "作者询问矿区"
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: memory.id,
        work_id: other_work.id,
        reference_scene: "recall",
        reference_reason: "串线记录"
      })

    assert {:ok, [reference]} = MemoryManagementService.references(work.id, memory.id)
    assert reference.work_id == work.id
    assert reference.reference_reason == "作者询问矿区"
  end
end
