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
               volumes: [
                 %{
                   title: "第一卷：起源",
                   chapters: [%{id: chapter_id, title: "第一章：苏醒", seq: 1}]
                 }
               ]
             } = ReadingProjectionRepo.toc(work_id)

      assert chapter_id == accepted_chapter.id
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
