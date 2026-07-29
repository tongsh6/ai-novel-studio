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
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  describe "persist/1" do
    test "records accepted setting adoption as mutation and memory without reading projection" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-source",
                 artifact_id: "as-adopt-1",
                 artifact_type: :plot_direction,
                 base_revision: 1,
                 content: "主线转向复仇",
                 summary: "剧情方向"
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
      assert memory.content == "主线转向复仇"
      assert memory.summary == "剧情方向"
      assert memory.type == MemoryType.plot_fact()
      assert memory.status == MemoryStatus.confirmed()
      assert memory.source_type == MemorySourceType.author_confirmed()
      assert memory.source_id == persisted.mutation_id
      assert memory.locked == true
      assert memory.recallable == true

      assert %{volumes: []} = ReadingProjectionRepo.toc(work_id)
    end

    test "adopts character_seed into Character dossier (主档案层)，不写记忆" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-char",
                 artifact_id: "as-char-1",
                 artifact_type: :character_seed,
                 base_revision: 1,
                 content: "冷峻的灵气交易所稽查官，外貌瘦削，语言简短克制",
                 summary: "沈砚"
               })

      assert persisted.mutation_status == "APPLIED"
      # I-b 创建不写记忆：无 memory_item，只落 Character 主档案。
      refute Map.has_key?(persisted, :memory_item_id)
      assert Repo.aggregate(MemoryItem, :count, :id) == 0
      assert persisted.reading_projection == nil

      character = Repo.get!(Character, persisted.character_id)
      assert character.work_id == work_id
      assert character.name == "沈砚"
      assert character.summary == "冷峻的灵气交易所稽查官，外貌瘦削，语言简短克制"
      assert character.status == AdoptionStatus.accepted()

      # 角色 tab 读路径（accepted Character）能查到该角色。
      assert [%{name: "沈砚"}] = NovelPersistence.WorkArchiveRepo.characters(work_id)
      # 未带叙事角色时 narrative_role 为 nil（不臆造主角）。
      assert [%{narrative_role: nil}] = NovelPersistence.WorkArchiveRepo.characters(work_id)
    end

    test "character_seed 携带 narrative_role 时落到 Character 主档案并经 roster 读出（AU-09 主角语义）" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-protagonist",
                 artifact_id: "as-char-protagonist",
                 artifact_type: :character_seed,
                 base_revision: 1,
                 content: "稽查官，追查灵源矿区真相",
                 summary: "林烬",
                 narrative_role: "PROTAGONIST"
               })

      character = Repo.get!(Character, persisted.character_id)
      assert character.narrative_role == "PROTAGONIST"

      assert [%{name: "林烬", narrative_role: "PROTAGONIST"}] =
               NovelPersistence.WorkArchiveRepo.characters(work_id)
    end

    test "非法 narrative_role 不写入（保持主角为可校验事实）" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-bad-role",
                 artifact_id: "as-char-bad-role",
                 artifact_type: :character_seed,
                 base_revision: 1,
                 content: "身份不明",
                 summary: "无名",
                 narrative_role: "NOT_A_ROLE"
               })

      character = Repo.get!(Character, persisted.character_id)
      assert character.narrative_role == nil
    end

    test "character_evolution_seed 采纳写角色记忆（非主档案），按 memory_subtype 分类（AU-09 §4.5）" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-evolution",
                 artifact_id: "as-evolution-1",
                 artifact_type: :character_evolution_seed,
                 base_revision: 1,
                 content: "林烬与苏晚从结盟转为敌对。",
                 summary: "林烬与苏晚：关系变化",
                 memory_subtype: "RELATIONSHIP"
               })

      # 写角色记忆，不写 Character 主档案。
      refute Map.has_key?(persisted, :character_id)
      assert NovelPersistence.WorkArchiveRepo.characters(work_id) == []

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.type == MemoryType.relationship()
      assert memory.status == MemoryStatus.confirmed()
      assert memory.recallable == true
    end

    test "character_evolution_seed 无 memory_subtype 时按内容兜底分类（默认 CHARACTER_PROFILE）" do
      work_id = Ecto.UUID.generate()

      assert {:ok, current} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-evo-state",
                 artifact_id: "as-evo-state",
                 artifact_type: :character_evolution_seed,
                 base_revision: 1,
                 content: "林烬当前状态：右臂重伤，暂时无法动用灵气。",
                 summary: "林烬：当前状态"
               })

      assert Repo.get!(MemoryItem, current.memory_item_id).type == MemoryType.current_state()

      assert {:ok, profile} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-evo-profile",
                 artifact_id: "as-evo-profile",
                 artifact_type: :character_evolution_seed,
                 base_revision: 1,
                 content: "林烬完成一次性格蜕变，从被动忍耐转为主动追查。",
                 summary: "林烬：成长转变"
               })

      assert Repo.get!(MemoryItem, profile.memory_item_id).type == MemoryType.character_profile()
    end

    # VS-00G CP5b 同名收束：同名 AI 假定行存在时，character_seed 采纳就地转正同一行
    # （契约 §3.4「就地 accepted」），不插重复行；provisional_active 收束。
    test "character_seed adoption converts the same-name AI assumption row in place" do
      {:ok, work} = NovelPersistence.WorkRepo.create(%{title: "假定收束作品"})

      assert {:ok, assumption} =
               NovelPersistence.AssumptionRepo.materialize_character(%{
                 work_id: work.id,
                 name: "沈砚",
                 summary: "盘点暂定主角。",
                 narrative_role: "PROTAGONIST"
               })

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work.id,
                 source_turn_ref: "turn-assumption-adopt",
                 artifact_id: "as-assume-1::char",
                 artifact_type: :character_seed,
                 base_revision: 1,
                 content: "追查灵气账单的核心视角人物。",
                 summary: "沈砚",
                 narrative_role: "PROTAGONIST"
               })

      assert persisted.character_id == assumption.id

      rows = Repo.all(from(c in Character, where: c.work_id == ^work.id))
      assert [converted] = rows
      assert converted.id == assumption.id
      assert converted.status == AdoptionStatus.accepted()
      assert converted.provisional_active == false
      assert converted.summary == "追查灵气账单的核心视角人物。"
    end

    # VS-00G CP4d：全书规划建议采纳 = works 立项字段回写——不写记忆、不建档案对象，
    # mutation 留痕，revision 与作者手工立项编辑同一冲突语义。
    test "adopts work_skeleton_suggestion by writing back the works planning field" do
      {:ok, work} = NovelPersistence.WorkRepo.create(%{title: "规划回写作品"})
      assert work.target_length == nil
      revision_before = work.revision

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work.id,
                 source_turn_ref: "turn-skeleton-adopt",
                 artifact_id: "as-skeleton-1::skeleton_target_length",
                 artifact_type: :work_skeleton_suggestion,
                 base_revision: 1,
                 content: "按已写节奏推断全书约 30 万字。",
                 summary: "目标体量",
                 skeleton_field: "target_length",
                 skeleton_value: 300_000
               })

      assert persisted.mutation_status == "APPLIED"
      assert persisted.work_planning_updated == true
      assert persisted.work_revision > revision_before
      refute Map.has_key?(persisted, :memory_item_id)
      refute Map.has_key?(persisted, :character_id)

      updated = Repo.get!(NovelPersistence.Schemas.Work, work.id)
      assert updated.target_length == 300_000
      assert updated.planned_volumes == nil
      assert updated.serial_form == nil

      assert [mutation] = MutationLog.list_by_turn("turn-skeleton-adopt")
      assert mutation.mutation_type == "adopt_artifact"
    end

    test "rejects work_skeleton_suggestion with illegal field or missing value" do
      {:ok, work} = NovelPersistence.WorkRepo.create(%{title: "规划回写拒绝"})

      base = %{
        actor_ref: "author",
        work_id: work.id,
        source_turn_ref: "turn-skeleton-reject",
        artifact_id: "as-skeleton-bad",
        artifact_type: :work_skeleton_suggestion,
        base_revision: 1,
        content: "非法建议",
        summary: "非法"
      }

      assert {:error, {:invalid_skeleton_field, "premise"}} =
               AdoptionRepository.persist(
                 Map.merge(base, %{skeleton_field: "premise", skeleton_value: "文本"})
               )

      assert {:error, :skeleton_value_missing} =
               AdoptionRepository.persist(Map.put(base, :skeleton_field, "target_length"))

      untouched = Repo.get!(NovelPersistence.Schemas.Work, work.id)
      assert untouched.target_length == nil
      assert MutationLog.list_by_turn("turn-skeleton-reject") == []
    end

    test "adopts foreshadowing_seed into governed memory visible in archive tab" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-foreshadowing",
                 artifact_id: "as-foreshadowing-1",
                 artifact_type: :foreshadowing_seed,
                 base_revision: 1,
                 content: "伏笔线索：矿区旧账编号会在第三卷回收。",
                 summary: "伏笔：矿区旧账"
               })

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.type == MemoryType.foreshadowing()
      assert memory.status == MemoryStatus.confirmed()
      assert memory.recallable == true

      assert [%{content: "伏笔线索：矿区旧账编号会在第三卷回收。"}] =
               NovelPersistence.WorkArchiveRepo.foreshadowing(work_id)

      assert [] = NovelPersistence.WorkArchiveRepo.rules(work_id)
    end

    test "adopts style_rule_seed into governed memory visible in archive tab" do
      work_id = Ecto.UUID.generate()

      assert {:ok, persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-adopt-rule",
                 artifact_id: "as-rule-1",
                 artifact_type: "style_rule_seed",
                 base_revision: 1,
                 content: "风格规则：战斗段落必须用动作和代价推进，不得空喊热血。",
                 summary: "风格规则：战斗代价"
               })

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.type == MemoryType.style_rule()
      assert memory.status == MemoryStatus.confirmed()

      assert [%{content: "风格规则：战斗段落必须用动作和代价推进，不得空喊热血。"}] =
               NovelPersistence.WorkArchiveRepo.rules(work_id)

      assert [] = NovelPersistence.WorkArchiveRepo.foreshadowing(work_id)
    end

    test "adopts explicit rule artifact types into corresponding governed memory types" do
      cases = [
        {:world_rule_seed, MemoryType.world_rule(), "世界规则：灵气账单不能赊欠。"},
        {"constraint_seed", MemoryType.constraint(), "约束内容：谜底回收前不得提前揭示。"}
      ]

      for {artifact_type, memory_type, content} <- cases do
        work_id = Ecto.UUID.generate()

        assert {:ok, persisted} =
                 AdoptionRepository.persist(%{
                   actor_ref: "author",
                   work_id: work_id,
                   source_turn_ref: "turn-adopt-explicit-rule",
                   artifact_id: "as-explicit-rule-#{System.unique_integer([:positive])}",
                   artifact_type: artifact_type,
                   base_revision: 1,
                   content: content,
                   summary: content
                 })

        memory = Repo.get!(MemoryItem, persisted.memory_item_id)
        assert memory.type == memory_type
        assert [%{content: ^content}] = NovelPersistence.WorkArchiveRepo.rules(work_id)
      end
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

    test "adopted outline materializes accepted volume/chapter structure (no prose yet)" do
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

      # 大纲采纳不直接产出阅读投影 draft（正文才是 prose 路径）。
      assert persisted.reading_projection == nil

      memory = Repo.get!(MemoryItem, persisted.memory_item_id)
      assert memory.type == MemoryType.draft_context()
      assert memory.tags == ["adopted_artifact", "outline_draft"]

      # 采纳计划即物化 accepted 卷/章结构：章 status=PLANNED，大纲摘要落到 chapter 结构上。
      chapters =
        Chapter
        |> where([c], c.work_id == ^work_id)
        |> order_by([c], asc: c.seq)
        |> Repo.all()

      assert [c1, c2] = chapters

      assert {c1.title, c1.status, c1.summary} ==
               {"第01章：底层灵气账单", StructureStatus.planned(), "主角发现灵气带宽被公司暗中抽走。"}

      assert c1.plan_direction == nil

      assert {c2.title, c2.status, c2.summary} ==
               {"第02章：旧服务器里的残诀", StructureStatus.planned(), "主角找到残缺功法并第一次突破。"}

      assert c2.plan_direction == nil

      assert c1.volume_id == c2.volume_id

      # 目录展示计划全章（结构即大纲，单一数据源带摘要），即使还没有已采纳正文（SC-AU08-B2）。
      assert %{volumes: [%{chapters: toc_chapters}], total_word_count: 0} =
               ReadingProjectionRepo.toc(work_id)

      assert [
               %{
                 title: "第01章：底层灵气账单",
                 summary: "主角发现灵气带宽被公司暗中抽走。",
                 word_count: 0,
                 audit_status: :empty
               },
               %{
                 title: "第02章：旧服务器里的残诀",
                 summary: "主角找到残缺功法并第一次突破。",
                 word_count: 0,
                 audit_status: :empty
               }
             ] = toc_chapters
    end

    test "adopted structured outline materializes chapter plan_direction" do
      work_id = Ecto.UUID.generate()

      content = """
      第01章：底层灵气账单: 章功能定位：推进章
      情节推进：主角发现灵气账单异常
      人物变化：主角从被动忍耐转为主动追查
      信息释放：公司正在抽取底层修士灵气
      伏笔动作：埋下旧服务器残诀线索
      情绪定位：压迫、悬疑
      章首拉力：账单红字倒计时
      章尾断章：旧服务器突然响应妹妹声音
      字数与场次：约 3000 字，2 场
      """

      assert {:ok, _persisted} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-outline-structured",
                 artifact_id: "as-outline-structured",
                 artifact_type: :outline_draft,
                 base_revision: 1,
                 content: String.trim(content),
                 summary: "结构化章节计划"
               })

      chapter = Repo.one!(from(c in Chapter, where: c.work_id == ^work_id))

      assert chapter.summary ==
               "主角发现灵气账单异常；主角从被动忍耐转为主动追查；公司正在抽取底层修士灵气；埋下旧服务器残诀线索"

      assert chapter.plan_direction == %{
               "chapter_role" => "推进章",
               "plot_progress" => "主角发现灵气账单异常",
               "character_change" => "主角从被动忍耐转为主动追查",
               "information_release" => "公司正在抽取底层修士灵气",
               "foreshadowing_action" => "埋下旧服务器残诀线索",
               "emotion" => "压迫、悬疑",
               "opening_hook" => "账单红字倒计时",
               "ending_hook" => "旧服务器突然响应妹妹声音",
               "word_count_and_scenes" => "约 3000 字，2 场"
             }

      assert %{volumes: [%{chapters: [%{plan_direction: direction}]}]} =
               ReadingProjectionRepo.toc(work_id)

      assert direction["plot_progress"] == "主角发现灵气账单异常"
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

  # AU08 CP1：章号在 work 内全局单调。此前按 volume_id 取 max，只有一卷时与全局等价而
  # 从未暴露；一旦建出第二卷，卷二首章 seq=1 会与卷一首章撞号，而账本
  # accepted_summaries_by_seq/1、阅读章列表、正文检索三处都跨全书按 c.seq 排序 —— 症状
  # 是静默乱序（账本错位、R7 末 N 章窗取错），必须在引入多卷前钉住。
  describe "章号全局单调 (AU08 CP1 不变量)" do
    test "单卷下与旧口径逐字节等价：物化计划章得到 1..N 连续章号" do
      work_id = Ecto.UUID.generate()

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-seq-1",
                 artifact_id: "as-seq-1",
                 artifact_type: :outline_draft,
                 content: "第01章：起: 甲。\n第02章：承: 乙。\n第03章：转: 丙。",
                 summary: "三章计划"
               })

      assert [1, 2, 3] == chapter_seqs(work_id)
    end

    test "多卷下新章不与他卷撞号：全局取 max 而非卷内取 max" do
      work_id = Ecto.UUID.generate()

      # 卷一：两章（seq 1、2）
      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-seq-2",
                 artifact_id: "as-seq-2",
                 artifact_type: :outline_draft,
                 content: "第01章：起: 甲。\n第02章：承: 乙。",
                 summary: "卷一计划"
               })

      # 第二卷（多卷落地前用遗留数据模拟：卷内本身尚无章）
      second_volume =
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "第二卷",
          seq: 2,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      # 直接在第二卷下建章，走的是与生产同一条 next_chapter_seq 口径：
      # 旧口径会给出 seq=1（卷内 max+1）→ 与卷一首章撞号；新口径必须给出 3。
      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-seq-3",
                 artifact_id: "as-seq-3",
                 artifact_type: :prose_fragment,
                 content: "第三章正文。",
                 summary: "第03章：合"
               })

      seqs = chapter_seqs(work_id)

      assert seqs == [1, 2, 3], "章号必须全局单调，实得 #{inspect(seqs)}"
      assert length(Enum.uniq(seqs)) == length(seqs), "work 内章号必须全局唯一"

      # 第二卷存在但新章仍进规范卷（多卷归属是 CP2 的事）；本用例只钉章号口径。
      assert Repo.aggregate(where(Volume, [v], v.work_id == ^work_id), :count) == 2
      refute is_nil(second_volume.id)
    end

    test "跨卷遗留数据下追加新章：取全局 max+1，不复用任一卷内空档" do
      work_id = Ecto.UUID.generate()

      volume_one =
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "第一卷",
          seq: 1,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      volume_two =
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "第二卷",
          seq: 2,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()

      # 卷一 seq=1，卷二 seq=7（全局 max=7）：新章必须是 8，不是卷内 max+1（2 或 8）
      for {volume, seq, title} <- [{volume_one, 1, "旧章甲"}, {volume_two, 7, "旧章乙"}] do
        %Chapter{}
        |> Chapter.changeset(%{
          work_id: work_id,
          volume_id: volume.id,
          title: title,
          seq: seq,
          status: StructureStatus.completed()
        })
        |> Repo.insert!()
      end

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-seq-4",
                 artifact_id: "as-seq-4",
                 artifact_type: :prose_fragment,
                 content: "新章正文。",
                 summary: "全新章"
               })

      seqs = chapter_seqs(work_id)
      assert seqs == [1, 7, 8], "新章应取全局 max+1，实得 #{inspect(seqs)}"
    end
  end

  # AU08 CP2：计划章按各自标注的所属卷物化。B11「章全挂第一卷」的正面修复。
  describe "计划分卷物化 (AU08 CP2)" do
    test "标注所属卷的计划物化为多卷，各章挂到对应卷，章号仍全局单调" do
      work_id = Ecto.UUID.generate()

      content = """
      第01章：起: 甲。
      所属卷：第一卷·觉醒
      第02章：承: 乙。
      所属卷：第一卷·觉醒
      第03章：转: 丙。
      所属卷：第二卷·裂变
      """

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-vol-1",
                 artifact_id: "as-vol-1",
                 artifact_type: :outline_draft,
                 content: String.trim(content),
                 summary: "分卷计划"
               })

      assert %{volumes: [vol1, vol2]} = ReadingProjectionRepo.toc(work_id)

      assert vol1.title == "第一卷·觉醒"
      assert Enum.map(vol1.chapters, & &1.title) == ["第01章：起", "第02章：承"]

      assert vol2.title == "第二卷·裂变"
      assert Enum.map(vol2.chapters, & &1.title) == ["第03章：转"]

      # 卷分了，但章号不随卷重启（CP1 不变量在多卷下继续成立）。
      assert chapter_seqs(work_id) == [1, 2, 3]
    end

    test "同一卷名幂等：二次采纳追加章不重复建卷" do
      work_id = Ecto.UUID.generate()

      for {artifact_id, content} <- [
            {"as-vol-2a", "第01章：起: 甲。\n所属卷：第一卷·觉醒"},
            {"as-vol-2b", "第02章：承: 乙。\n所属卷：第一卷·觉醒"}
          ] do
        assert {:ok, _} =
                 AdoptionRepository.persist(%{
                   actor_ref: "author",
                   work_id: work_id,
                   source_turn_ref: "turn-#{artifact_id}",
                   artifact_id: artifact_id,
                   artifact_type: :outline_draft,
                   content: content,
                   summary: "分卷计划"
                 })
      end

      assert Repo.aggregate(where(Volume, [v], v.work_id == ^work_id), :count) == 1
      assert %{volumes: [%{chapters: chapters}]} = ReadingProjectionRepo.toc(work_id)
      assert length(chapters) == 2
    end

    test "无卷标注时全部落规范单卷（与 CP2 之前逐字节等价）" do
      work_id = Ecto.UUID.generate()

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-vol-3",
                 artifact_id: "as-vol-3",
                 artifact_type: :outline_draft,
                 content: "第01章：起: 甲。\n第02章：承: 乙。",
                 summary: "无分卷计划"
               })

      assert %{volumes: [%{title: "第一卷", chapters: chapters}]} =
               ReadingProjectionRepo.toc(work_id)

      assert length(chapters) == 2
    end

    test "部分章有标注、部分没有：有标注的进对应卷，没标注的进规范卷" do
      work_id = Ecto.UUID.generate()

      assert {:ok, _} =
               AdoptionRepository.persist(%{
                 actor_ref: "author",
                 work_id: work_id,
                 source_turn_ref: "turn-vol-4",
                 artifact_id: "as-vol-4",
                 artifact_type: :outline_draft,
                 content: "第01章：起: 甲。\n第02章：承: 乙。\n所属卷：第二卷",
                 summary: "半标注计划"
               })

      assert %{volumes: volumes} = ReadingProjectionRepo.toc(work_id)

      titles = Enum.map(volumes, &{&1.title, Enum.map(&1.chapters, fn c -> c.title end)})
      assert {"第一卷", ["第01章：起"]} in titles
      assert {"第二卷", ["第02章：承"]} in titles
    end
  end

  defp chapter_seqs(work_id) do
    Chapter
    |> where([c], c.work_id == ^work_id)
    |> order_by([c], asc: c.seq)
    |> select([c], c.seq)
    |> Repo.all()
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
