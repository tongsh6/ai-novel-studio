defmodule NovelPersistence.MemoryManagementRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.MemoryManagementRepo
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

  test "list filters current-work memories without leaking other works" do
    work_id = Ecto.UUID.generate()
    other_work_id = Ecto.UUID.generate()

    current =
      insert_memory(work_id, %{
        content: "林瑶失踪与灵源矿区有关",
        summary: "矿区线索",
        type: MemoryType.foreshadowing(),
        locked: true
      })

    insert_memory(work_id, %{
      content: "灵源矿区不能公开进入",
      type: MemoryType.world_rule()
    })

    insert_memory(other_work_id, %{
      content: "其他作品矿区线索",
      type: MemoryType.foreshadowing(),
      locked: true
    })

    assert [listed] =
             MemoryManagementRepo.list(work_id, %{
               type: MemoryType.foreshadowing(),
               locked: true,
               keyword: "林瑶"
             })

    assert listed.id == current.id
    assert listed.work_id == work_id

    assert [limited] =
             MemoryManagementRepo.list(work_id, %{
               keyword: "林瑶",
               limit: 1
             })

    assert limited.id == current.id
  end

  test "update consumes MemoryItem update changeset lifecycle side effects" do
    work_id = Ecto.UUID.generate()
    item = insert_memory(work_id, %{locked: true})

    assert {:error, %Ecto.Changeset{} = changeset} =
             MemoryManagementRepo.update(work_id, item.id, %{status: MemoryStatus.deprecated()})

    assert {"cannot move locked memory item to terminal status", _} =
             Keyword.fetch!(changeset.errors, :status)

    assert {:ok, unlocked} = MemoryManagementRepo.update(work_id, item.id, %{locked: false})

    assert {:ok, deprecated} =
             MemoryManagementRepo.update(work_id, unlocked.id, %{
               status: MemoryStatus.deprecated()
             })

    assert deprecated.status == MemoryStatus.deprecated()
    assert deprecated.locked == false
    assert deprecated.recallable == false
  end

  test "references returns only records for the addressed work" do
    work_id = Ecto.UUID.generate()
    other_work_id = Ecto.UUID.generate()
    item = insert_memory(work_id, %{})

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: item.id,
        work_id: work_id,
        reference_scene: "recall",
        reference_reason: "current"
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: item.id,
        work_id: other_work_id,
        reference_scene: "recall",
        reference_reason: "other"
      })

    assert [%{reference_reason: "current"}] = MemoryManagementRepo.references(work_id, item.id)
  end

  test "get update and references reject memory ids from another work" do
    work_id = Ecto.UUID.generate()
    other_work_id = Ecto.UUID.generate()

    foreign =
      insert_memory(other_work_id, %{
        content: "只属于其他作品的伏笔",
        summary: "其他作品伏笔",
        type: MemoryType.foreshadowing()
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: foreign.id,
        work_id: other_work_id,
        reference_scene: "recall",
        reference_reason: "其他作品引用"
      })

    assert MemoryManagementRepo.get(work_id, foreign.id) == nil

    assert {:error, :not_found} =
             MemoryManagementRepo.update(work_id, foreign.id, %{summary: "串线"})

    assert :not_found = MemoryManagementRepo.references(work_id, foreign.id)

    assert Repo.get!(MemoryItem, foreign.id).summary == "其他作品伏笔"
  end

  defp insert_memory(work_id, attrs) do
    defaults = %{
      id: Ecto.UUID.generate(),
      work_id: work_id,
      content: "核心设定",
      type: MemoryType.world_rule(),
      scope: "WORK",
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed()
    }

    %MemoryItem{}
    |> MemoryItem.changeset(Map.merge(defaults, attrs))
    |> Repo.insert!()
  end
end
