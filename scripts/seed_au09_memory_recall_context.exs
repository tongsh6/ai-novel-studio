alias NovelApplication.WorkService
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.MemoryItem

{:ok, work} = WorkService.create(%{"title" => "AU09 Memory Recall Work"})

{:ok, _memory} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "林瑶失踪与灵源矿区有关，林烬去矿区是为了追查她留下的线索。",
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

{:ok, _draft} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "未确认草稿：矿区里有一条尚未采纳的龙线。",
    type: MemoryType.plot_fact(),
    scope: MemoryScope.work(),
    status: MemoryStatus.draft(),
    source_type: MemorySourceType.ai_extracted(),
    recallable: true
  })
  |> Repo.insert()

IO.puts("[au09-memory-recall-seed] work_id=#{work.id}")
