alias NovelApplication.{DialogueGateway, WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU04 TTL 确认作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "主角在过期确认边界前重新审查行动",
    "target_reader" => "喜欢稳健长篇推进的读者",
    "tone_preference" => "克制、悬疑"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id
turn_id = "turn_au04_expired_confirmation_seed"
behavior_id = "bh_au04_expired_confirmation"
expires_at = "2000-01-01T00:00:00Z"

plan = %NovelDomain.MicroPlan{
  plan_id: "plan_au04_expired_confirmation",
  turn_id: turn_id,
  frame_ref: "frame_au04_expired_confirmation",
  plan_goal: %{summary: "重写第一章正文"},
  risk_hint: :high,
  requires_confirmation_hint: true,
  proposed_actions: [
    %{
      action_id: "act_au04_expired_prose",
      action_type: :capability_invocation,
      summary: "重写第一章正文",
      target_ref: "prose_writing",
      write_intent: :production_candidate,
      risk_hint: :high
    }
  ],
  state_changes_requested: [],
  required_capabilities: [],
  fallback_strategy: %{downgrade_message: "确认已过期，请重新生成计划。"}
}

available_actions = [
  %{
    action_id: "act_au04_expired_confirm",
    action_type: "confirm_before_execute",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: true,
    idempotency_key: "idem_au04_expired_confirm",
    expires_at: expires_at
  },
  %{
    action_id: "act_au04_expired_reject",
    action_type: "reject_or_cancel_confirmation",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: true,
    idempotency_key: "idem_au04_expired_reject",
    expires_at: expires_at
  }
]

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_au04_expired_confirmation",
  phase: "awaiting_author",
  status: "needs_confirmation",
  assistant_message: %{
    text: "这次重写第一章会影响作品正文，需要你确认。但这是一条已经过期的确认。"
  },
  frame_summary: %{
    frame_type: "execution_request",
    dialogue_goal: "过期确认拒绝验证"
  },
  plan: DialogueGateway.jsonable(plan),
  available_actions: available_actions,
  behavior_state: %{
    active: %{
      behavior_id: behavior_id,
      behavior_type: "confirmation",
      status: "WAITING_USER",
      blocking_actor: "author",
      opened_at_turn_ref: turn_id,
      opened_by_decision_ref: "decision_au04_expired_confirmation",
      frame_ref: "frame_au04_expired_confirmation",
      plan_ref: plan.plan_id,
      required_next_action: "confirm_before_execute",
      target_ref: "prose_writing",
      prompt_contract: %{question: "确认重写第一章正文"},
      available_actions: available_actions,
      closed_at_turn_ref: nil,
      trace_ref: "trace_au04_expired_confirmation",
      resolution_ref: nil
    },
    history: []
  },
  truthfulness: %{
    tool_called: false,
    artifact_adopted: false,
    production_write_performed: false,
    durable_behavior_opened: true,
    execution_blocked: true,
    decision_type: "require_confirmation",
    first_blocking_gate: "authority",
    reason_codes: ["require_confirmation", "expired_confirmation_seed"]
  },
  trace_summary: %{
    trace_ref: "trace_au04_expired_confirmation",
    decision_type: "require_confirmation",
    reason_codes: ["require_confirmation", "expired_confirmation_seed"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "请重写第一章正文。"},
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
  "[au04-confirmation-ttl-ui-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id} expires_at=#{expires_at}"
)
