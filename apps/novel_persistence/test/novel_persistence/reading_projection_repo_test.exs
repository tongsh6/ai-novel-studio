defmodule NovelPersistence.ReadingProjectionRepoTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.ChapterSummary
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  describe "toc/1" do
    test "empty work returns no mock volumes" do
      assert %{work_id: "not-a-uuid", volumes: []} = ReadingProjectionRepo.toc("not-a-uuid")
      assert %{volumes: []} = ReadingProjectionRepo.toc(Ecto.UUID.generate())
    end

    test "TOC 按已采纳卷/章结构展示；未采纳内容既不计字数也不进正文，跨作品不串" do
      work_id = Ecto.UUID.generate()
      other_work_id = Ecto.UUID.generate()

      %{chapter: accepted_chapter} =
        insert_reading_chain(work_id, "第一卷：起源", "第一章：苏醒", "醒来。", :accepted)

      # 结构里的章即使只有未采纳草稿，也按结构出现在目录（SC-AU08-B2 空章），
      # 但未采纳内容不计字数（AU08-I2）。
      %{chapter: tentative_chapter} =
        insert_reading_chain(work_id, "第二卷：草稿", "第二章：未采纳", "不能出现", :tentative)

      insert_reading_chain(other_work_id, "串线卷", "串线章", "不能串作品", :accepted)

      toc = ReadingProjectionRepo.toc(work_id)
      assert toc.work_id == work_id
      # 只统计已采纳正文「醒来」2 字；未采纳草稿不计。
      assert toc.total_word_count == 2

      chapters = Enum.flat_map(toc.volumes, & &1.chapters)
      titles = Enum.map(chapters, & &1.title)
      assert "第一章：苏醒" in titles
      assert "第二章：未采纳" in titles
      # 跨作品隔离。
      refute "串线章" in titles

      accepted = Enum.find(chapters, &(&1.title == "第一章：苏醒"))
      assert accepted.id == accepted_chapter.id
      assert accepted.word_count == 2

      empty = Enum.find(chapters, &(&1.title == "第二章：未采纳"))
      assert empty.word_count == 0
      assert empty.audit_status == :empty

      # 未采纳内容不进正文。
      assert {:ok, %{scenes: scenes}} =
               ReadingProjectionRepo.chapter_content(tentative_chapter.id, work_id)

      refute scenes |> Enum.map_join("", & &1.content) =~ "不能出现"
    end

    test "TOC 顶层带工作级规划使命（WR01c）；无使命时诚实为 nil" do
      {:ok, work} = NovelPersistence.WorkRepo.create(%{title: "规划使命投影作品"})
      assert ReadingProjectionRepo.toc(work.id).planning_direction == nil

      {:ok, :stored, _} =
        NovelPersistence.PlanningMissionRepo.put_tentative(work.id, %{
          "mission_id" => "cm_toc",
          "statement" => "先给超期伏笔安排回收。",
          "must_advance" => [],
          "must_avoid" => []
        })

      toc = ReadingProjectionRepo.toc(work.id)
      assert toc.planning_direction["planning_mission"]["statement"] == "先给超期伏笔安排回收。"
      assert toc.planning_direction["planning_mission"]["status"] == "TENTATIVE"
    end

    test "total_word_count 只统计已采纳正文且排除标点空白" do
      work_id = Ecto.UUID.generate()

      # 已采纳：有效字数 = 「他终于醒来」5 字（逗号、句号不计）
      %{chapter: chapter, scene: scene} =
        insert_reading_chain(work_id, "第一卷", "第一章", "他，终于醒来。", :accepted)

      # 同章第二场，再采纳一段：有效字数 = 「世界安静」4 字
      second_scene = insert_scene(work_id, chapter.id, "第二场", 2)
      insert_draft(work_id, second_scene.id, "世界  安静\n", AdoptionStatus.accepted(), 1)

      # 未采纳草稿不计入字数事实
      third_scene = insert_scene(work_id, chapter.id, "第三场", 3)
      insert_draft(work_id, third_scene.id, "这段不该被统计", AdoptionStatus.tentative(), 1)

      # 同场更高 revision 的已采纳草稿应覆盖旧版本（取最新，不重复累加）
      insert_draft(work_id, scene.id, "他终于慢慢醒来过来", AdoptionStatus.accepted(), 2)

      assert %{
               total_word_count: total,
               volumes: [%{chapters: [%{word_count: chapter_words}]}]
             } = ReadingProjectionRepo.toc(work_id)

      # 第一场最新版「他终于慢慢醒来过来」9 字 + 第二场「世界安静」4 字 = 13
      assert chapter_words == 13
      assert total == 13
    end
  end

  describe "toc/1 字数审计（P1）" do
    test "空作品 audit 为空且不达标" do
      assert %{audit: audit} = ReadingProjectionRepo.toc(Ecto.UUID.generate())
      assert audit.stage == :p1
      assert audit.min_chapter_words == 1_000
      assert audit.total_target == 100_000
      assert audit.chapter_count == 0
      assert audit.total_word_count == 0
      assert audit.meets_threshold == false
    end

    test "短章被标记 audit_status :short 并计入 work audit" do
      work_id = Ecto.UUID.generate()
      insert_reading_chain(work_id, "第一卷", "第一章", "他终于醒来", :accepted)

      assert %{
               audit: %{
                 stage: :p1,
                 chapter_count: 1,
                 short_chapter_count: 1,
                 ok_chapter_count: 0,
                 empty_chapter_count: 0,
                 meets_threshold: false
               },
               volumes: [%{chapters: [%{word_count: 5, audit_status: :short}]}]
             } = ReadingProjectionRepo.toc(work_id)
    end

    test "纯标点空白的已采纳内容为空章 audit_status :empty" do
      work_id = Ecto.UUID.generate()
      insert_reading_chain(work_id, "第一卷", "第一章", "，。！？ ……", :accepted)

      assert %{
               audit: %{empty_chapter_count: 1, short_chapter_count: 0},
               volumes: [%{chapters: [%{word_count: 0, audit_status: :empty}]}]
             } = ReadingProjectionRepo.toc(work_id)
    end
  end

  describe "chapter_content/2" do
    test "returns ordered scenes with latest accepted draft content" do
      work_id = Ecto.UUID.generate()

      %{chapter: chapter, scene: scene} =
        insert_reading_chain(work_id, "第一卷", "第一章", "旧版正文", :accepted)

      insert_draft(work_id, scene.id, "新版正文", AdoptionStatus.accepted(), 2)
      second_scene = insert_scene(work_id, chapter.id, "第二场", 2)
      insert_draft(work_id, second_scene.id, "第二场正文", AdoptionStatus.accepted(), 1)

      assert {:ok,
              %{
                id: chapter_id,
                title: "第一章",
                word_count: 9,
                scenes: [
                  %{title: "第一场", content: "新版正文"},
                  %{title: "第二场", content: "第二场正文"}
                ]
              }} = ReadingProjectionRepo.chapter_content(chapter.id, work_id)

      assert chapter_id == chapter.id
    end

    test "rejects cross-work chapter reads" do
      work_id = Ecto.UUID.generate()
      other_work_id = Ecto.UUID.generate()
      %{chapter: chapter} = insert_reading_chain(work_id, "第一卷", "第一章", "正文", :accepted)

      assert {:error, :not_found} =
               ReadingProjectionRepo.chapter_content(chapter.id, other_work_id)
    end
  end

  describe "accepted_chapter_prose/2" do
    test "concatenates accepted prose of all scenes for the matching chapter title" do
      work_id = Ecto.UUID.generate()

      %{chapter: chapter} =
        insert_reading_chain(work_id, "已采纳内容", "第01章：底层灵气账单", "第一场正文。", :accepted)

      second = insert_scene(work_id, chapter.id, "场景 2", 2)
      insert_draft(work_id, second.id, "第二场续写正文。", AdoptionStatus.accepted(), 1)

      prose = ReadingProjectionRepo.accepted_chapter_prose(work_id, "第01章：底层灵气账单")
      assert prose =~ "第一场正文。"
      assert prose =~ "第二场续写正文。"
    end

    test "returns empty string for unknown chapter title" do
      work_id = Ecto.UUID.generate()
      insert_reading_chain(work_id, "已采纳内容", "第01章", "正文", :accepted)
      assert ReadingProjectionRepo.accepted_chapter_prose(work_id, "不存在的章") == ""
    end

    test "excludes tentative drafts from prior prose" do
      work_id = Ecto.UUID.generate()
      %{chapter: chapter} = insert_reading_chain(work_id, "已采纳内容", "第01章", "已采纳正文。", :accepted)
      pending = insert_scene(work_id, chapter.id, "场景 2", 2)
      insert_draft(work_id, pending.id, "未采纳不应出现", AdoptionStatus.tentative(), 1)

      prose = ReadingProjectionRepo.accepted_chapter_prose(work_id, "第01章")
      assert prose =~ "已采纳正文。"
      refute prose =~ "未采纳不应出现"
    end

    test "returns empty string for invalid work id" do
      assert ReadingProjectionRepo.accepted_chapter_prose("not-a-uuid", "第01章") == ""
    end
  end

  describe "fact_inventory_materials/1" do
    test "优先按章节顺序读取每章最新 ACCEPTED 摘要，排除旧摘要和正文原文" do
      work_id = Ecto.UUID.generate()
      volume = insert_volume(work_id, "第一卷", 1)
      chapter1 = insert_chapter(work_id, volume.id, "第一章", 1)
      chapter2 = insert_chapter(work_id, volume.id, "第二章", 2)
      scene1 = insert_scene(work_id, chapter1.id, "第一场", 1)
      scene2 = insert_scene(work_id, chapter2.id, "第一场", 1)
      insert_draft(work_id, scene1.id, "不应优先使用的长正文一", AdoptionStatus.accepted(), 1)
      insert_draft(work_id, scene2.id, "不应优先使用的长正文二", AdoptionStatus.accepted(), 1)

      insert_summary(work_id, chapter1.id, "第一章旧摘要", AdoptionStatus.accepted())
      insert_summary(work_id, chapter1.id, "第一章最新摘要", AdoptionStatus.accepted())
      insert_summary(work_id, chapter2.id, "第二章待定摘要", AdoptionStatus.tentative())
      insert_summary(work_id, chapter2.id, "第二章确认摘要", AdoptionStatus.accepted())

      assert [
               %{seq: 1, title: "第一章", prose: "第一章最新摘要"},
               %{seq: 2, title: "第二章", prose: "第二章确认摘要"}
             ] = ReadingProjectionRepo.fact_inventory_materials(work_id)
    end

    test "无 ACCEPTED 摘要时回退有限的已采纳正文，排除 tentative" do
      work_id = Ecto.UUID.generate()
      insert_reading_chain(work_id, "第一卷", "第一章", "已采纳正文", :accepted)
      insert_reading_chain(work_id, "第二卷", "第二章", "未采纳正文", :tentative)

      assert [%{title: "第一章", prose: "已采纳正文"}] =
               ReadingProjectionRepo.fact_inventory_materials(work_id)
    end
  end

  defp insert_reading_chain(work_id, volume_title, chapter_title, content, draft_state) do
    volume = insert_volume(work_id, volume_title, 1)
    chapter = insert_chapter(work_id, volume.id, chapter_title, 1)
    scene = insert_scene(work_id, chapter.id, "第一场", 1)

    status =
      case draft_state do
        :accepted -> AdoptionStatus.accepted()
        :tentative -> AdoptionStatus.tentative()
      end

    draft = insert_draft(work_id, scene.id, content, status, 1)

    %{volume: volume, chapter: chapter, scene: scene, draft: draft}
  end

  defp insert_volume(work_id, title, seq) do
    %Volume{}
    |> Volume.changeset(%{work_id: work_id, title: title, seq: seq})
    |> Repo.insert!()
  end

  defp insert_chapter(work_id, volume_id, title, seq) do
    %Chapter{}
    |> Chapter.changeset(%{work_id: work_id, volume_id: volume_id, title: title, seq: seq})
    |> Repo.insert!()
  end

  defp insert_scene(work_id, chapter_id, title, seq) do
    %Scene{}
    |> Scene.changeset(%{work_id: work_id, chapter_id: chapter_id, title: title, seq: seq})
    |> Repo.insert!()
  end

  defp insert_draft(work_id, scene_id, content, status, revision) do
    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene_id,
      content: content,
      status: status,
      revision: revision
    })
    |> Repo.insert!()
  end

  defp insert_summary(work_id, chapter_id, summary_text, status) do
    %ChapterSummary{}
    |> ChapterSummary.changeset(%{
      work_id: work_id,
      chapter_id: chapter_id,
      summary_text: summary_text,
      status: status
    })
    |> Repo.insert!()
  end
end
