alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU03 Long Session Work",
    "genre" => "东方奇幻",
    "core_selling_point" => "长会话里保留最近设定，同时压缩早期讨论"
  })

{:ok, active_snapshot} = WorkSessionService.resume(work.id)
session_id = active_snapshot.active_session.id

Enum.each(1..12, fn index ->
  {:ok, _interaction} =
    MemoryLog.record(%{
      workspace_id: work.id,
      session_id: session_id,
      turn_id: "turn_long_context_#{index}",
      role: "user",
      content: %{text: "第#{index}轮设定"},
      source_ref: "turn_long_context_#{index}",
      scope_ref: work.id
    })
end)

IO.puts("[au03-long-session-compression-seed] work_id=#{work.id} session_id=#{session_id}")
