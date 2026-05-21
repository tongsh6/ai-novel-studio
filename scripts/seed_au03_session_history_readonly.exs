alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{MemoryLog, WorkSessionRepo}

{:ok, work} =
  WorkService.create(%{
    "title" => "AU03 History Session Work"
  })

{:ok, active_snapshot} = WorkSessionService.resume(work.id)
active_session_id = active_snapshot.active_session.id

{:ok, history_session} =
  WorkSessionRepo.create(%{
    work_id: work.id,
    title: "第三章节奏",
    summary: "妹妹林瑶的伏笔回收讨论",
    status: "EXITED"
  })

entries = [
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_seed",
    role: "assistant",
    content: %{text: "当前会话已就绪，可以继续创作。"},
    source_ref: "turn_active_seed",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_1",
    role: "user",
    content: %{text: "我想回看妹妹林瑶的伏笔怎么安排。"},
    source_ref: "turn_history_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_1",
    role: "assistant",
    content: %{
      text: "林瑶的失踪可以作为第三章的动机线索，但这只是历史会话里的讨论。",
      turn_result: %{
        turn_id: "turn_history_1",
        assistant_message: %{text: "林瑶的失踪可以作为第三章的动机线索。"},
        adoption_state: %{
          pending: [
            %{
              artifact_id: "artifact_history_pending",
              artifact_type: "plot_direction",
              adoption_status: "PENDING",
              requires_adoption: true,
              payload: %{title: "林瑶伏笔"}
            }
          ],
          resolved: []
        }
      }
    },
    source_ref: "turn_history_1",
    scope_ref: work.id
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au03-session-history-readonly-seed] work_id=#{work.id} active_session_id=#{active_session_id} history_session_id=#{history_session.id}"
)
