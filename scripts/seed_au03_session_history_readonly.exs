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
    title: "林瑶旧线索讨论",
    summary: "上周围绕林瑶失踪和旧线索展开的历史会话。",
    status: "EXITED"
  })

entries = [
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_seed",
    role: "user",
    content: %{text: "当前会话继续讨论灵源矿区。"},
    source_ref: "turn_active_seed",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_active_seed_reply",
    role: "assistant",
    content: %{text: "当前会话保持活跃，可继续创作。"},
    source_ref: "turn_active_seed_reply",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_1",
    role: "user",
    content: %{text: "林瑶留下的旧线索应该藏在矿区档案室。"},
    source_ref: "turn_history_1",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_history_1",
    role: "assistant",
    content: %{
      text: "这段历史会话只用于回看，不应恢复为当前可写会话。",
      turn_result: %{
        turn_id: "turn_history_1",
        assistant_message: %{text: "这段历史会话只用于回看。"},
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
