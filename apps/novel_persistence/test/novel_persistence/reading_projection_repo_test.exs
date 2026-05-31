defmodule NovelPersistence.ReadingProjectionRepoTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  describe "toc/1" do
    test "empty work returns no mock volumes" do
      assert %{work_id: "not-a-uuid", volumes: []} = ReadingProjectionRepo.toc("not-a-uuid")
      assert %{volumes: []} = ReadingProjectionRepo.toc(Ecto.UUID.generate())
    end

    test "lists only chapters with accepted draft content for the current work" do
      work_id = Ecto.UUID.generate()
      other_work_id = Ecto.UUID.generate()

      %{chapter: accepted_chapter} =
        insert_reading_chain(work_id, "第一卷：起源", "第一章：苏醒", "醒来。", :accepted)

      insert_reading_chain(work_id, "第二卷：草稿", "第二章：未采纳", "不能出现", :tentative)
      insert_reading_chain(other_work_id, "串线卷", "串线章", "不能串作品", :accepted)

      assert %{
               work_id: ^work_id,
               total_word_count: 2,
               volumes: [
                 %{
                   title: "第一卷：起源",
                   chapters: [
                     %{id: chapter_id, title: "第一章：苏醒", seq: 1, word_count: 2}
                   ]
                 }
               ]
             } = ReadingProjectionRepo.toc(work_id)

      assert chapter_id == accepted_chapter.id
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
end
