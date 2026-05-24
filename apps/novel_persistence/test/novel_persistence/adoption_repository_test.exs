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
  alias NovelPersistence.WorkArchiveRepo

  describe "persist/1" do
    test "records accepted setting adoption as mutation and memory without reading projection" do
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
      assert persisted.reading_projection == nil

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

      assert %{volumes: []} = ReadingProjectionRepo.toc(work_id)
    end

    test "uses accepted artifact item title for reading projection instead of artifact id" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-source",
                 artifact_id: "as_15",
                 artifact_type: :prose_fragment,
                 content: "赛博公司垄断流：顶级大厂垄断了灵气带宽。",
                 summary: "赛博公司垄断流"
               })

      assert %{volumes: [%{chapters: [%{id: chapter_id, title: "赛博公司垄断流"}]}]} =
               ReadingProjectionRepo.toc(work_id)

      assert chapter_id == persisted.reading_projection.chapter_id
    end

    test "records adopted outline draft as chapter plan without reading projection" do
      work_id = Ecto.UUID.generate()

      content = """
      第01章：底层灵气账单: 主角发现灵气带宽被公司暗中抽走。
      第02章：旧服务器里的残诀: 主角找到残缺功法并第一次突破。
      """

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-outline-source",
                 artifact_id: "as-outline-1",
                 artifact_type: :outline_draft,
                 base_revision: 1,
                 content: String.trim(content),
                 summary: "P1 10 万字章节计划"
               })

      assert persisted.reading_projection == nil

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.type == MemoryType.draft_context()
      assert memory.tags == ["adopted_artifact", "outline_draft"]

      assert %{volumes: []} = ReadingProjectionRepo.toc(work_id)

      assert [
               %{
                 title: "P1 10 万字章节计划",
                 chapter_count: 2,
                 chapters: [
                   %{seq: 1, title: "第01章：底层灵气账单", summary: "主角发现灵气带宽被公司暗中抽走。"},
                   %{seq: 2, title: "第02章：旧服务器里的残诀", summary: "主角找到残缺功法并第一次突破。"}
                 ]
               }
             ] = WorkArchiveRepo.chapter_plans(work_id)
    end
  end
end
