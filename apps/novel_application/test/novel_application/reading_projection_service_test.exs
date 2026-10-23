defmodule NovelApplication.ReadingProjectionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.ReadingProjectionService
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "toc/1 exposes accepted reading content as DTOs" do
    work_id = Ecto.UUID.generate()
    %{chapter: chapter} = insert_reading_chain(work_id)

    assert %{
             work_id: ^work_id,
             volumes: [
               %{
                 title: "第一卷",
                 chapters: [%{id: chapter_id, title: "第一章"}]
               }
             ]
           } = ReadingProjectionService.toc(work_id)

    assert chapter_id == chapter.id
  end

  test "chapter_content/2 returns not_found for invalid scope" do
    assert {:error, :not_found} =
             ReadingProjectionService.chapter_content(Ecto.UUID.generate(), Ecto.UUID.generate())
  end

  describe "current_writing_coordinate/2 (B13b §4.1 #11)" do
    test "prefers the latest turn writing_coordinate volume_ref and resolves its TOC title" do
      work_id = Ecto.UUID.generate()
      %{volume: volume} = insert_reading_chain(work_id)

      turn_results = [
        %{
          turn_id: "turn-new",
          produced_at: "2026-10-23T10:00:02Z",
          writing_coordinate: %{volume_ref: volume.id, matched_chapter: "第一章"}
        },
        %{
          turn_id: "turn-old",
          produced_at: "2026-10-23T10:00:01Z",
          writing_coordinate: %{volume_ref: "volume-other", matched_chapter: "第三章"}
        }
      ]

      assert %{
               volume_ref: volume_ref,
               volume_title: "第一卷",
               chapter_title: "第一章",
               source: "writing_coordinate"
             } = ReadingProjectionService.current_writing_coordinate(work_id, turn_results)

      assert volume_ref == volume.id
    end

    test "falls back to the last TOC volume when the turn has no writing coordinate" do
      work_id = Ecto.UUID.generate()
      %{volume: volume} = insert_reading_chain(work_id)

      assert %{
               volume_ref: volume_ref,
               volume_title: "第一卷",
               source: "toc_fallback"
             } = ReadingProjectionService.current_writing_coordinate(work_id, [])

      assert volume_ref == volume.id
    end

    test "returns nil when the work has no volumes" do
      assert ReadingProjectionService.current_writing_coordinate(Ecto.UUID.generate(), []) ==
               nil
    end
  end

  defp insert_reading_chain(work_id) do
    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work_id, title: "第一卷", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: "第一章", seq: 1})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "第一场", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: "正文",
      status: AdoptionStatus.accepted()
    })
    |> Repo.insert!()

    %{volume: volume, chapter: chapter, scene: scene}
  end
end
