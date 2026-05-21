alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{MemoryLog, WorkSessionRepo}

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
    title: "旧主角命名讨论",
    summary: "林烬旧设定讨论",
    status: "EXITED"
  })

entries = [
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_context_1",
    role: "user",
    content: %{text: "当前会话确认：主角现在叫林澈。"},
    source_ref: "turn_active_context_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_context_1",
    role: "assistant",
    content: %{text: "已按最新作品背景记录：林澈正在追查灵源矿区真相。"},
    source_ref: "turn_active_context_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_context_1",
    role: "user",
    content: %{text: "旧讨论：主角当时叫林烬，动机还只是离开故乡。"},
    source_ref: "turn_history_context_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_context_1",
    role: "assistant",
    content: %{text: "这是历史会话里的旧设定，不能覆盖当前作品背景。"},
    source_ref: "turn_history_context_1",
    scope_ref: work.id
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au03-current-work-context-ssot-seed] work_id=#{work.id} active_session_id=#{active_session_id} history_session_id=#{history_session.id}"
)
