alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, foreign_work} =
  WorkService.create(%{
    "title" => "AU05 外部来源作品",
    "genre" => "赛博悬疑",
    "core_selling_point" => "这是另一部作品的旧候选来源",
    "target_reader" => "喜欢高概念悬疑的读者",
    "tone_preference" => "冷峻"
  })

{:ok, current_work} =
  WorkService.create(%{
    "title" => "AU05 当前作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "当前作品必须拒绝来自其它作品的候选采纳",
    "target_reader" => "喜欢多作品并行创作的读者",
    "tone_preference" => "克制、清晰"
  })

{:ok, snapshot} = WorkSessionService.resume(current_work.id)
session_id = snapshot.active_session.id
turn_id = "turn_au05_cross_work_candidate_seed"

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: foreign_work.id,
  session_id: session_id,
  frame_ref: "frame_au05_cross_work_candidate_seed",
  phase: "completed",
  status: "conversational",
  assistant_message: %{text: "这里有一个来自其它作品的候选方向，当前作品只能拒绝或重新生成。"},
  frame_summary: %{
    frame_type: "creative_exploration",
    dialogue_goal: "跨作品候选采纳隔离验证"
  },
  candidate_directions: [
    %{
      direction_id: "dir_au05_cross_work_1",
      title: "外部作品主线移植",
      pitch: "把另一部作品的赛博悬疑主线直接移植到当前东方奇幻作品。",
      tone_tags: ["跨作品", "不应采纳"],
      risk_hint: "low",
      work_id: foreign_work.id,
      adoption_status: "not_adopted"
    }
  ],
  available_actions: [
    %{
      action_id: "choose_candidate:dir_au05_cross_work_1",
      action_type: "choose_candidate",
      candidate_set_ref: "candidate_set:#{turn_id}",
      candidate_ref: "dir_au05_cross_work_1",
      enabled: true,
      idempotency_key: "idem:#{turn_id}:choose_candidate:dir_au05_cross_work_1"
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
    trace_ref: "trace_au05_cross_work_candidate_seed",
    decision_type: "exploration",
    reason_codes: ["cross_work_candidate_for_boundary_validation"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: current_work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "恢复一个其它作品里的候选方向，验证跨作品采纳不会静默成功。"},
    source_ref: turn_id,
    scope_ref: current_work.id,
    freshness_score: 0.4,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: current_work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "assistant",
    content: %{text: turn_result.assistant_message.text, turn_result: turn_result},
    source_ref: turn_id,
    scope_ref: current_work.id,
    freshness_score: 0.4,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au05-conflict-cross-work-seed] current_work_id=#{current_work.id} foreign_work_id=#{foreign_work.id} session_id=#{session_id} turn_id=#{turn_id}"
)
