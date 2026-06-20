alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{MemoryLog, WorkSessionRepo}

{:ok, work} =
  WorkService.create(%{
    "title" => "AU04 History Confirmation Work"
  })

{:ok, active_snapshot} = WorkSessionService.resume(work.id)
active_session_id = active_snapshot.active_session.id

{:ok, history_session} =
  WorkSessionRepo.create(%{
    work_id: work.id,
    title: "AU04 历史确认只读",
    summary: "含有旧确认动作的历史会话，只能回看，不能执行。",
    status: "EXITED"
  })

available_actions = [
  %{
    action_id: "act_au04_history_confirm",
    action_type: "confirm_before_execute",
    label: "确认执行",
    target_ref: "prose_writing",
    behavior_ref: "bh_au04_history_confirmation",
    idempotency_key: "idem_au04_history_confirm",
    expires_at: "2999-01-01T00:00:00Z",
    enabled: true
  },
  %{
    action_id: "act_au04_history_reject",
    action_type: "reject_or_cancel_confirmation",
    label: "拒绝",
    target_ref: "prose_writing",
    behavior_ref: "bh_au04_history_confirmation",
    idempotency_key: "idem_au04_history_reject",
    expires_at: "2999-01-01T00:00:00Z",
    enabled: true
  }
]

turn_result = %{
  schema_version: "2.0.0",
  turn_id: "turn_au04_history_confirmation_seed",
  phase: "awaiting_author",
  status: "needs_confirmation",
  next_action: "confirm_before_execute",
  assistant_message: %{
    text: "这是历史会话里的待确认执行，当前只能回看，不能从历史里确认。"
  },
  ui_cards: [
    %{
      card_type: "confirmation_card",
      title: "历史确认对象",
      body: "历史会话里的确认卡不应恢复为当前可点击动作。",
      target_ref: "prose_writing",
      behavior_ref: "bh_au04_history_confirmation"
    }
  ],
  available_actions: available_actions,
  behavior_state: %{
    active: %{
      behavior_type: "confirmation",
      behavior_id: "bh_au04_history_confirmation",
      status: "WAITING_USER",
      prompt_contract: %{
        required_next_action: "confirm_before_execute",
        target_ref: "prose_writing"
      },
      available_actions: available_actions
    },
    history: []
  },
  adoption_state: %{pending: [], resolved: []},
  projection_refs: [],
  validation: %{ok: true},
  usage: %{prompt_tokens: 0, completion_tokens: 0},
  trace_ref: %{trace_id: "trace_au04_history_confirmation"},
  produced_at: "2026-06-20T12:00:00Z"
}

entries = [
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_au04_history_active_seed",
    role: "user",
    content: %{text: "当前会话继续创作，不执行历史确认。"},
    source_ref: "turn_au04_history_active_seed",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: active_session_id,
    turn_id: "turn_au04_history_active_reply",
    role: "assistant",
    content: %{text: "当前会话保持活跃，可继续自然对话。"},
    source_ref: "turn_au04_history_active_reply",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_au04_history_confirmation_seed",
    role: "user",
    content: %{text: "请直接替换旧章节正文。"},
    source_ref: "turn_au04_history_confirmation_seed",
    scope_ref: work.id
  },
  %{
    workspace_id: work.id,
    session_id: history_session.id,
    turn_id: "turn_au04_history_confirmation_seed",
    role: "assistant",
    content: %{
      text: "这是历史会话里的待确认执行，当前只能回看，不能从历史里确认。",
      turn_result: turn_result
    },
    source_ref: "turn_au04_history_confirmation_seed",
    scope_ref: work.id
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au04-history-confirmation-readonly-seed] work_id=#{work.id} active_session_id=#{active_session_id} history_session_id=#{history_session.id}"
)
