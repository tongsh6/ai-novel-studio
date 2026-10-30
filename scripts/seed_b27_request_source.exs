alias NovelApplication.WorkService
alias NovelFoundation.Enums.AdoptionStatus
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, MemoryItem, Scene, Volume}

# B27 §9 CP3：原生真实模型 M1/M2 的合成作品（不得使用作者真实作品）。
# M1 依赖“已确认 memory”但初始请求不得声明已供给；M2 为无关进度问题。
{:ok, work} =
  WorkService.create(%{
    "title" => "B27 Request Source Work",
    "genre" => "雨港悬疑",
    "core_selling_point" => "B27 request source native fixture",
    "target_reader" => "作者",
    "tone_preference" => "克制",
    "target_length" => 30_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

{:ok, _memory} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "B27MEMORY-林瑶失踪与灵源矿区有关；林烬去矿区是为了追查她留下的线索。",
    summary: "林瑶失踪指向灵源矿区，林烬去矿区追查线索。",
    type: MemoryType.plot_fact(),
    scope: MemoryScope.work(),
    status: MemoryStatus.confirmed(),
    source_type: MemorySourceType.author_confirmed(),
    weight: Decimal.new("0.9000"),
    confidence: Decimal.new("0.8500"),
    recallable: true,
    tags: ["主线", "矿区"]
  })
  |> Repo.insert()

volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

chapter =
  Repo.insert!(%Chapter{
    work_id: work.id,
    volume_id: volume.id,
    title: "第01章：灯楼夜话",
    seq: 1,
    status: "DRAFTING",
    summary: "B27 request source fixture chapter"
  })

scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

Repo.insert!(%Draft{
  work_id: work.id,
  scene_id: scene.id,
  content: "第01章正文：雨港的灯楼立在旧码头尽头，陈九斤守着旧账。",
  status: AdoptionStatus.accepted(),
  revision: 1
})

IO.puts("[b27-request-source-seed] work_id=#{work.id} work_title=B27 Request Source Work")
