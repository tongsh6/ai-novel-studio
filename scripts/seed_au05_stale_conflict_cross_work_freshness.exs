alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU05 采纳安全作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "主角追查旧设定与当前主线冲突的真相",
    "target_reader" => "喜欢长篇设定演进的读者",
    "tone_preference" => "克制、悬疑"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id
turn_id = "turn_au05_stale_candidate_seed"

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_au05_stale_candidate_seed",
  phase: "completed",
  status: "conversational",
  assistant_message: %{text: "这里有一个旧版本候选方向，当前只能重新评估后再决定是否采纳。"},
  frame_summary: %{
    frame_type: "creative_exploration",
    dialogue_goal: "旧候选方向恢复验证"
  },
  candidate_set_stability: "stale",
  candidate_directions: [
    %{
      direction_id: "dir_au05_stale_1",
      title: "旧版主线覆盖",
      pitch: "沿用旧主线直接覆盖当前作品设定。",
      tone_tags: ["旧设定", "冲突"],
      risk_hint: "low",
      adoption_status: "not_adopted"
    }
  ],
  available_actions: [
    %{
      action_id: "choose_candidate:dir_au05_stale_1",
      action_type: "choose_candidate",
      source_turn_ref: turn_id,
      target_ref: "dir_au05_stale_1",
      candidate_set_ref: "candidate_set:#{turn_id}",
      candidate_ref: "dir_au05_stale_1",
      enabled: true,
      idempotency_key: "idem:#{turn_id}:choose_candidate:dir_au05_stale_1"
    }
  ],
  truthfulness: %{
    tool_called: false,
    candidate_selected: false,
    candidate_adopted: false,
    artifact_adopted: false,
    production_write_performed: false,
    durable_behavior_opened: false
  },
  trace_summary: %{
    trace_ref: "trace_au05_stale_candidate_seed",
    decision_type: "exploration",
    reason_codes: ["restored_stale_candidate_for_re_evaluation"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "恢复一个旧候选方向，验证过期采纳不会静默成功。"},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.1,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "assistant",
    content: %{text: turn_result.assistant_message.text, turn_result: turn_result},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.1,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au05-stale-conflict-cross-work-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id}"
)
