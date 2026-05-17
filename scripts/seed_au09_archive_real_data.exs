alias NovelApplication.WorkService
alias NovelFoundation.Enums.AdoptionStatus
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.Character
alias NovelPersistence.Schemas.Chapter
alias NovelPersistence.Schemas.Draft
alias NovelPersistence.Schemas.MemoryItem
alias NovelPersistence.Schemas.Scene
alias NovelPersistence.Schemas.Volume

{:ok, work} = WorkService.create(%{"title" => "AU09 Archive Work"})

{:ok, _character} =
  %Character{}
  |> Character.changeset(%{
    work_id: work.id,
    name: "林澈",
    role: "主角",
    summary: "为了保护同伴而重新审视旧秩序。",
    status: AdoptionStatus.accepted()
  })
  |> Repo.insert()

{:ok, _foreshadowing} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "林澈旧伤会在第二卷揭示真正来源。",
    type: MemoryType.foreshadowing(),
    scope: MemoryScope.work(),
    status: MemoryStatus.confirmed(),
    source_type: MemorySourceType.author_confirmed(),
    tags: ["主线"]
  })
  |> Repo.insert()

{:ok, _rule} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "灵能不能直接修复被篡改的记忆。",
    type: MemoryType.world_rule(),
    scope: MemoryScope.work(),
    status: MemoryStatus.confirmed(),
    source_type: MemorySourceType.author_confirmed(),
    tags: ["硬规则"]
  })
  |> Repo.insert()

volume =
  %Volume{}
  |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1})
  |> Repo.insert!()

chapter =
  %Chapter{}
  |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: "第一章", seq: 1})
  |> Repo.insert!()

scene =
  %Scene{}
  |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "第一场", seq: 1})
  |> Repo.insert!()

%Draft{}
|> Draft.changeset(%{
  work_id: work.id,
  scene_id: scene.id,
  content: "林澈在雨夜醒来，发现旧城的钟声只在记忆里回响。",
  status: AdoptionStatus.accepted()
})
|> Repo.insert!()

IO.puts("[au09-archive-seed] work_id=#{work.id}")
