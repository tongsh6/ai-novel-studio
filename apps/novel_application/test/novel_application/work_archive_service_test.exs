defmodule NovelApplication.WorkArchiveServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{WorkArchiveService, WorkService}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "archive reads are scoped to accepted and confirmed facts for one work" do
    {:ok, work} = WorkService.create(%{"title" => "真实档案"})
    {:ok, other_work} = WorkService.create(%{"title" => "其他作品"})

    insert_character(work.id, "林澈", AdoptionStatus.accepted())
    insert_character(work.id, "草稿角色", AdoptionStatus.tentative())
    insert_character(other_work.id, "串线角色", AdoptionStatus.accepted())

    insert_memory(work.id, MemoryType.foreshadowing(), "林澈背后的旧伤", ["主线"])
    insert_memory(work.id, MemoryType.world_rule(), "灵能不能治愈记忆损伤", ["硬规则"])
    insert_memory(work.id, MemoryType.idea(), "未确认灵感", ["草稿"])
    insert_memory(work.id, MemoryType.world_rule(), "已经废弃的规则", ["废弃"], false)
    insert_memory(other_work.id, MemoryType.world_rule(), "其他作品规则", ["串线"])

    %{volume: _volume, chapter: _chapter, scene: scene} = insert_structure(work.id)
    insert_draft(work.id, scene.id, "已采纳正文", AdoptionStatus.accepted())
    insert_draft(work.id, scene.id, "待采纳正文", AdoptionStatus.tentative())

    assert [
             %{
               name: "林澈",
               aliases: [],
               status: "ACCEPTED",
               updated_at: character_updated_at
             }
           ] = WorkArchiveService.characters(work.id)

    assert is_binary(character_updated_at)

    assert [
             %{
               content: "林澈背后的旧伤",
               tags: ["主线"],
               status: "CONFIRMED",
               scope: "WORK",
               source_type: "AUTHOR_CONFIRMED",
               locked: false,
               recallable: true,
               reference_count: 0,
               version: 1,
               weight: weight,
               confidence: confidence,
               updated_at: memory_updated_at
             }
           ] = WorkArchiveService.foreshadowing(work.id)

    assert is_float(weight)
    assert is_float(confidence)
    assert is_binary(memory_updated_at)

    assert [%{content: "灵能不能治愈记忆损伤", tags: ["硬规则"], status: "CONFIRMED"}] =
             WorkArchiveService.rules(work.id)

    assert %{
             volumes: 1,
             chapters: 1,
             characters: 1,
             memory_items: 3,
             drafts_total: 2,
             drafts_accepted: 1,
             words_total: word_count
           } = WorkArchiveService.stats(work.id)

    assert word_count > 0
  end

  test "profile exposes work seed fields without internal ids" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "灵源纪元",
        "genre" => "东方玄幻",
        "core_selling_point" => "灵源矿区真相",
        "target_reader" => "喜欢升级悬疑的读者",
        "tone_preference" => "紧张热血"
      })

    assert %{
             title: "灵源纪元",
             genre: "东方玄幻",
             core_selling_point: "灵源矿区真相",
             target_reader: "喜欢升级悬疑的读者",
             tone_preference: "紧张热血",
             status: "TENTATIVE",
             revision: revision,
             updated_at: updated_at
           } = WorkArchiveService.profile(work.id)

    assert is_integer(revision)
    assert is_binary(updated_at)
    refute Map.has_key?(WorkArchiveService.profile(work.id), :id)
    refute inspect(WorkArchiveService.profile(work.id)) =~ work.id
  end

  test "placeholder work ids return empty archive data instead of examples" do
    assert [] = WorkArchiveService.characters("lobby")
    assert [] = WorkArchiveService.foreshadowing("lobby")
    assert [] = WorkArchiveService.rules("lobby")
    assert WorkArchiveService.profile("lobby") == %{}

    assert %{
             volumes: 0,
             chapters: 0,
             characters: 0,
             memory_items: 0,
             drafts_total: 0,
             drafts_accepted: 0
           } = WorkArchiveService.stats("lobby")
  end

  defp insert_character(work_id, name, status) do
    %Character{}
    |> Character.changeset(%{work_id: work_id, name: name, status: status})
    |> Repo.insert!()
  end

  defp insert_memory(work_id, type, content, tags, recallable \\ true) do
    %MemoryItem{}
    |> MemoryItem.changeset(%{
      id: Ecto.UUID.generate(),
      work_id: work_id,
      content: content,
      type: type,
      scope: "WORK",
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      tags: tags,
      recallable: recallable
    })
    |> Repo.insert!()
  end

  defp insert_structure(work_id) do
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

    %{volume: volume, chapter: chapter, scene: scene}
  end

  defp insert_draft(work_id, scene_id, content, status) do
    %Draft{}
    |> Draft.changeset(%{work_id: work_id, scene_id: scene_id, content: content, status: status})
    |> Repo.insert!()
  end
end
