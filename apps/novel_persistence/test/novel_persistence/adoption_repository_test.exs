defmodule NovelPersistence.AdoptionRepositoryTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.MutationLog
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

  describe "persist/1" do
    test "records accepted adoption as applied mutation plus confirmed memory item" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-source",
                 artifact_id: "as-adopt-1",
                 artifact_type: :character_seed,
                 base_revision: 1,
                 content: "主角更果断",
                 summary: "角色设定"
               })

      assert persisted.mutation_status == "APPLIED"
      assert persisted.memory_status == MemoryStatus.confirmed()
      assert persisted.source_revision_ref == "mutation:#{persisted.mutation_id}"
      assert persisted.reading_projection.chapter_id
      assert persisted.reading_projection.draft_id

      assert [mutation] = MutationLog.list_by_turn("turn-adopt-source")
      assert mutation.id == persisted.mutation_id
      assert mutation.mutation_type == "adopt_artifact"
      assert mutation.target_object_ref == "as-adopt-1"
      assert mutation.target_scope == "work:#{work_id}"
      assert mutation.requires_adoption == false

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.work_id == work_id
      assert memory.content == "主角更果断"
      assert memory.summary == "角色设定"
      assert memory.type == MemoryType.character_profile()
      assert memory.status == MemoryStatus.confirmed()
      assert memory.source_type == MemorySourceType.author_confirmed()
      assert memory.source_id == persisted.mutation_id
      assert memory.locked == true
      assert memory.recallable == true

      assert %{volumes: [%{chapters: [%{id: chapter_id, title: "角色设定"}]}]} =
               ReadingProjectionRepo.toc(work_id)

      assert chapter_id == persisted.reading_projection.chapter_id

      assert {:ok, %{title: "角色设定", scenes: [%{content: "主角更果断"}]}} =
               ReadingProjectionRepo.chapter_content(chapter_id, work_id)
    end
  end
end
