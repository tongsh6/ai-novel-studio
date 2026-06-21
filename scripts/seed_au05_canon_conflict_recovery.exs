alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU05 Canon 冲突作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "当前作品必须拒绝和已确认 canon 冲突的候选采纳",
    "target_reader" => "喜欢长篇设定一致性的读者",
    "tone_preference" => "克制、清晰"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id
turn_id = "turn_au05_canon_conflict_candidate_seed"

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_au05_canon_conflict_candidate_seed",
  phase: "completed",
  status: "conversational",
  assistant_message: %{text: "这里有一个和当前 canon 冲突的候选方向，只能进入恢复处理，不能直接覆盖。"},
  frame_summary: %{
    frame_type: "creative_exploration",
    dialogue_goal: "Canon 冲突候选采纳恢复验证"
  },
  candidate_directions: [
    %{
      direction_id: "dir_au05_canon_conflict_1",
      title: "年龄设定覆盖",
      pitch: "把已确认十七岁的林烬直接改成三十二岁，覆盖当前 canon。",
      tone_tags: ["canon 冲突", "不应采纳"],
      risk_hint: "low",
      adoption_target_ref: "canon:role:lin-jin:age",
      canon_conflicts: [
        %{
          target_ref: "canon:role:lin-jin:age",
          current_value: "林烬十七岁",
          proposed_value: "林烬三十二岁",
          canon_revision: 7,
          conflict_basis_ref: "memory:lin-jin-age"
        }
      ],
      adoption_status: "not_adopted"
    }
  ],
  available_actions: [
    %{
      action_id: "choose_candidate:dir_au05_canon_conflict_1",
      action_type: "choose_candidate",
      source_turn_ref: turn_id,
      target_ref: "dir_au05_canon_conflict_1",
      candidate_set_ref: "candidate_set:#{turn_id}",
      candidate_ref: "dir_au05_canon_conflict_1",
      enabled: true,
      idempotency_key: "idem:#{turn_id}:choose_candidate:dir_au05_canon_conflict_1"
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
    trace_ref: "trace_au05_canon_conflict_candidate_seed",
    decision_type: "exploration",
    reason_codes: ["canon_conflict_candidate_for_boundary_validation"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: "turn_au05_canon_memory_seed",
    role: "assistant",
    content: %{text: "已确认设定：林烬十七岁。", canon_ref: "canon:role:lin-jin:age"},
    source_ref: "memory:lin-jin-age",
    scope_ref: work.id,
    freshness_score: 0.9,
    importance_score: 0.9,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "恢复一个和当前 canon 冲突的候选方向，验证采纳不会静默覆盖。"},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.5,
    importance_score: 0.7,
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
    freshness_score: 0.5,
    importance_score: 0.7,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au05-canon-conflict-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id}"
)
