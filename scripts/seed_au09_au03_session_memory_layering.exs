alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.{MemoryScope, MemorySourceType, MemoryStatus, MemoryType}
alias NovelPersistence.{MemoryLog, Repo, WorkSessionRepo}
alias NovelPersistence.Schemas.MemoryItem

{:ok, work} =
  WorkService.create(%{
    "title" => "灵源纪元",
    "genre" => "东方奇幻",
    "core_selling_point" => "林澈为寻找妹妹林瑶追查灵源矿区真相",
    "target_reader" => "喜欢悬疑成长线的读者",
    "tone_preference" => "克制、悬疑、带希望感"
  })

{:ok, active_snapshot} = WorkSessionService.resume(work.id)
active_session_id = active_snapshot.active_session.id

{:ok, history_session} =
  WorkSessionRepo.create(%{
    work_id: work.id,
    title: "旧稿赤塔历史会话",
    summary: "旧稿赤塔只属于历史会话，不能覆盖当前作品背景。",
    status: "EXITED"
  })

{:ok, memory} =
  %MemoryItem{}
  |> MemoryItem.changeset(%{
    id: Ecto.UUID.generate(),
    work_id: work.id,
    content: "银槐誓约是林澈追查灵源矿区时必须遵守的已确认设定。",
    summary: "银槐誓约约束林澈追查灵源矿区的行动。",
    type: MemoryType.plot_fact(),
    scope: MemoryScope.work(),
    status: MemoryStatus.confirmed(),
    source_type: MemorySourceType.author_confirmed(),
    weight: Decimal.new("0.9000"),
    confidence: Decimal.new("0.8800"),
    recallable: true,
    tags: ["主线", "誓约"]
  })
  |> Repo.insert()

entries = [
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_layering_1",
    role: "user",
    content: %{text: "当前会话确认：当前蓝桥计划已经取代旧航线。"},
    source_ref: "turn_active_layering_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_layering_1",
    role: "assistant",
    content: %{text: "已记录当前蓝桥计划，并保持林澈追查灵源矿区真相的最新背景。"},
    source_ref: "turn_active_layering_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_layering_1",
    role: "user",
    content: %{text: "历史旧稿赤塔设定：主角当时叫林烬，动机还只是离开故乡。"},
    source_ref: "turn_history_layering_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_layering_1",
    role: "assistant",
    content: %{text: "这是历史会话里的旧设定，只能回看，不能伪装成已确认记忆。"},
    source_ref: "turn_history_layering_1",
    scope_ref: work.id
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au09-au03-session-memory-layering-seed] work_id=#{work.id} active_session_id=#{active_session_id} history_session_id=#{history_session.id} memory_id=#{memory.id}"
)
