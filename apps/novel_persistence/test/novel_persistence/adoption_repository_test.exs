defmodule NovelPersistence.AdoptionRepositoryTest do
  use NovelPersistence.DataCase, async: true

  import Ecto.Query

  alias NovelDomain.ProseWordCount
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.MutationLog
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume
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

  describe "章节身份与覆盖检测 (A3/A4)" do
    test "A3: 同 title 正文落到遗留卷里的同名章，就地覆盖不堆重复章" do
      work_id = Ecto.UUID.generate()

      # 模拟旧代码：在第二个「已采纳内容」卷里留下一个同名已采纳章（散落遗留数据）。
      legacy_volume =
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "已采纳内容",
          seq: 2,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      legacy_chapter =
        %Chapter{}
        |> Chapter.changeset(%{
          work_id: work_id,
          volume_id: legacy_volume.id,
          title: "遗留章",
          seq: 1,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      legacy_scene =
        %Scene{}
        |> Scene.changeset(%{
          work_id: work_id,
          chapter_id: legacy_chapter.id,
          title: "遗留章",
          seq: 1,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      %Draft{}
      |> Draft.changeset(%{
        work_id: work_id,
        scene_id: legacy_scene.id,
        content: "旧版正文。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })
      |> Repo.insert!()

      # 采纳同名章新正文：应复用遗留章并就地覆盖，而不是在规范卷新建重复章。
      assert {:ok, _persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-source",
                 artifact_id: "as-legacy-1",
                 artifact_type: :prose_fragment,
                 content: "新版正文。",
                 summary: "遗留章"
               })

      chapter_ids =
        Chapter
        |> where([c], c.work_id == ^work_id and c.title == "遗留章")
        |> select([c], c.id)
        |> Repo.all()

      assert chapter_ids == [legacy_chapter.id]

      assert {:ok, %{title: "遗留章", scenes: [%{content: "新版正文。"}]}} =
               ReadingProjectionRepo.chapter_content(legacy_chapter.id, work_id)
    end

    test "A4: 空 summary 采纳存为「已采纳内容」，覆盖检测仍命中" do
      work_id = Ecto.UUID.generate()

      assert {:ok, _persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-source",
                 artifact_id: "as-empty-1",
                 artifact_type: :prose_fragment,
                 content: "无标题正文。",
                 summary: "   "
               })

      # 存储回退「已采纳内容」，读端口用同一归一 → 空/空白 summary 也能检出覆盖。
      assert AdoptionRepository.has_accepted_chapter?(work_id, "   ")
      assert AdoptionRepository.has_accepted_chapter?(work_id, "")
      assert AdoptionRepository.has_accepted_chapter?(work_id, "已采纳内容")
      refute AdoptionRepository.has_accepted_chapter?(work_id, "不存在的章")
    end
  end

  describe "续写累积多场景 (append)" do
    test "续写同章落为新场景累积字数，不 supersede 已采纳场景" do
      work_id = Ecto.UUID.generate()

      first = "林澈摸黑钻进矿道。"
      second = "矿道深处，灵脉在岩壁上搏动。"

      # 首段：默认（overwrite）采纳第 1 章第一段
      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-1",
                 artifact_id: "as-ch1-s1",
                 artifact_type: :prose_fragment,
                 content: first,
                 summary: "第01章：底层灵气账单"
               })

      # 续写：append 模式落为同章新场景，不覆盖第一段
      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-2",
                 artifact_id: "as-ch1-s2",
                 artifact_type: :prose_fragment,
                 content: second,
                 summary: "第01章：底层灵气账单",
                 mode: :append
               })

      # 同一章两个场景，两段正文都在（旧场景未被 supersede）
      assert {:ok, %{title: "第01章：底层灵气账单", scenes: scenes}} =
               chapter_content_for(work_id, "第01章：底层灵气账单")

      contents = Enum.map(scenes, & &1.content)
      assert length(scenes) == 2
      assert first in contents
      assert second in contents

      # 字数 = 两段有效字数之和；仍只有一章
      assert %{volumes: [%{chapters: [%{word_count: word_count}]}], audit: audit} =
               ReadingProjectionRepo.toc(work_id)

      assert word_count == ProseWordCount.count(first) + ProseWordCount.count(second)
      assert audit.chapter_count == 1
    end

    test "重写（默认 overwrite）仍 supersede 旧场景，不累积" do
      work_id = Ecto.UUID.generate()

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "t1",
                 artifact_id: "a1",
                 artifact_type: :prose_fragment,
                 content: "初版正文。",
                 summary: "第01章"
               })

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "t2",
                 artifact_id: "a2",
                 artifact_type: :prose_fragment,
                 content: "重写版正文。",
                 summary: "第01章"
               })

      assert {:ok, %{scenes: [%{content: "重写版正文。"}]}} =
               chapter_content_for(work_id, "第01章")
    end
  end

  defp chapter_content_for(work_id, title) do
    %{volumes: volumes} = ReadingProjectionRepo.toc(work_id)

    chapter =
      volumes
      |> Enum.flat_map(& &1.chapters)
      |> Enum.find(&(&1.title == title))

    ReadingProjectionRepo.chapter_content(chapter.id, work_id)
  end
end
