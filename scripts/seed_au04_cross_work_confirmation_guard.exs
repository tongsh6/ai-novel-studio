alias NovelApplication.{DialogueGateway, WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, source_work} =
  WorkService.create(%{
    "title" => "AU04 跨作品确认源作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "源作品持有一条待确认的高风险重写",
    "target_reader" => "关注多作品边界的作者",
    "tone_preference" => "稳健、克制"
  })

{:ok, source_snapshot} = WorkSessionService.resume(source_work.id)
source_session_id = source_snapshot.active_session.id

{:ok, target_work} =
  WorkService.create(%{
    "title" => "AU04 跨作品确认目标作品",
    "genre" => "科幻悬疑",
    "core_selling_point" => "目标作品不能继承源作品的待确认动作",
    "target_reader" => "关注并行创作安全的作者",
    "tone_preference" => "清晰、冷静"
  })

{:ok, target_snapshot} = WorkSessionService.resume(target_work.id)
target_session_id = target_snapshot.active_session.id

turn_id = "turn_au04_cross_work_confirmation_seed"
behavior_id = "bh_au04_cross_work_confirmation"
expires_at = "2999-01-01T00:00:00Z"

plan = %NovelDomain.MicroPlan{
  plan_id: "plan_au04_cross_work_confirmation",
  turn_id: turn_id,
  frame_ref: "frame_au04_cross_work_confirmation",
  plan_goal: %{summary: "重写源作品第一章正文"},
  risk_hint: :high,
  requires_confirmation_hint: true,
  proposed_actions: [
    %{
      action_id: "act_au04_cross_work_prose",
      action_type: :capability_invocation,
      summary: "重写源作品第一章正文",
      target_ref: "prose_writing",
      write_intent: :production_candidate,
      risk_hint: :high
    }
  ],
  state_changes_requested: [],
  required_capabilities: [],
  fallback_strategy: %{downgrade_message: "切换作品后需要在当前作品重新生成计划。"}
}

available_actions = [
  %{
    action_id: "act_au04_cross_work_confirm",
    action_type: "confirm_before_execute",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: true,
    idempotency_key: "idem_au04_cross_work_confirm",
    expires_at: expires_at
  },
  %{
    action_id: "act_au04_cross_work_reject",
    action_type: "reject_or_cancel_confirmation",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: true,
    idempotency_key: "idem_au04_cross_work_reject",
    expires_at: expires_at
  }
]

source_turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: source_work.id,
  session_id: source_session_id,
  frame_ref: "frame_au04_cross_work_confirmation",
  phase: "awaiting_author",
  status: "needs_confirmation",
  assistant_message: %{
    text: "AU04跨作品旧确认源文本：源作品里有一条待确认的高风险重写，切到目标作品后不能继续执行。"
  },
  frame_summary: %{
    frame_type: "execution_request",
    dialogue_goal: "跨作品确认隔离验证"
  },
  plan: DialogueGateway.jsonable(plan),
  ui_cards: [
    %{
      card_type: "confirmation_card",
      title: "源作品高风险重写确认",
      body: "这条确认只属于 AU04 跨作品确认源作品。",
      target_ref: "prose_writing",
      behavior_ref: behavior_id
    }
  ],
  available_actions: available_actions,
  behavior_state: %{
    active: %{
      behavior_id: behavior_id,
      behavior_type: "confirmation",
      status: "WAITING_USER",
      blocking_actor: "author",
      opened_at_turn_ref: turn_id,
      opened_by_decision_ref: "decision_au04_cross_work_confirmation",
      frame_ref: "frame_au04_cross_work_confirmation",
      plan_ref: plan.plan_id,
      required_next_action: "confirm_before_execute",
      target_ref: "prose_writing",
      prompt_contract: %{question: "确认重写源作品第一章正文"},
      available_actions: available_actions,
      closed_at_turn_ref: nil,
      trace_ref: "trace_au04_cross_work_confirmation",
      resolution_ref: nil
    },
    history: []
  },
  adoption_state: %{pending: [], resolved: []},
  truthfulness: %{
    tool_called: false,
    artifact_adopted: false,
    production_write_performed: false,
    durable_behavior_opened: true,
    execution_blocked: true,
    decision_type: "require_confirmation",
    first_blocking_gate: "authority",
    reason_codes: ["require_confirmation", "cross_work_confirmation_seed"]
  },
  trace_summary: %{
    trace_ref: "trace_au04_cross_work_confirmation",
    decision_type: "require_confirmation",
    reason_codes: ["require_confirmation", "cross_work_confirmation_seed"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: source_work.id,
    session_id: source_session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "请重写源作品第一章正文。"},
    source_ref: turn_id,
    scope_ref: source_work.id,
    freshness_score: 0.9,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: source_work.id,
    session_id: source_session_id,
    turn_id: turn_id,
    role: "assistant",
    content: %{text: source_turn_result.assistant_message.text, turn_result: source_turn_result},
    source_ref: turn_id,
    scope_ref: source_work.id,
    freshness_score: 0.9,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: target_work.id,
    session_id: target_session_id,
    turn_id: "turn_au04_cross_work_target_seed",
    role: "user",
    content: %{text: "目标作品当前会话继续创作，不接收源作品确认。"},
    source_ref: "turn_au04_cross_work_target_seed",
    scope_ref: target_work.id,
    freshness_score: 1.0,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  },
  %{
    workspace_id: target_work.id,
    session_id: target_session_id,
    turn_id: "turn_au04_cross_work_target_reply",
    role: "assistant",
    content: %{text: "目标作品保持独立，可继续自然对话。"},
    source_ref: "turn_au04_cross_work_target_reply",
    scope_ref: target_work.id,
    freshness_score: 1.0,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au04-cross-work-confirmation-guard-seed] source_work_id=#{source_work.id} source_session_id=#{source_session_id} target_work_id=#{target_work.id} target_session_id=#{target_session_id} turn_id=#{turn_id}"
)
