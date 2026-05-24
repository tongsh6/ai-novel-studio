alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelPersistence.{MemoryLog, Repo}
alias NovelPersistence.Schemas.MemoryItem

{:ok, work} =
  WorkService.create(%{
    "title" => "灵源纪元",
    "genre" => "东方奇幻",
    "core_selling_point" => "林烬为寻找妹妹林瑶追查灵源矿区真相",
    "target_reader" => "喜欢悬疑成长线的读者",
    "tone_preference" => "克制、悬疑、带希望感"
  })

{:ok, active_snapshot} = WorkSessionService.resume(work.id)
active_session_id = active_snapshot.active_session.id

Enum.each(
  [
    %{
      workspace_id: work.id,
      session_id: active_session_id,
      turn_id: "turn_context_source_seed_1",
      role: "user",
      content: %{text: "上一轮确认：林烬进入灵源矿区，是为了追查妹妹林瑶留下的线索。"},
      source_ref: "turn_context_source_seed_1",
      scope_ref: work.id
    },
    %{
      workspace_id: work.id,
      session_id: active_session_id,
      turn_id: "turn_context_source_seed_1",
      role: "assistant",
      content: %{text: "已把矿区调查作为当前会话的主线推进依据。"},
      source_ref: "turn_context_source_seed_1",
      scope_ref: work.id
    }
  ],
  fn entry ->
    {:ok, _interaction} = MemoryLog.record(entry)
  end
)

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

IO.puts("[au03-context-source-ui-seed] work_id=#{work.id} active_session_id=#{active_session_id}")
