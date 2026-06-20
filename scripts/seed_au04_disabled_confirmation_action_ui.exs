alias NovelApplication.{DialogueGateway, WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU04 禁用确认动作作品",
    "genre" => "东方奇幻",
    "core_selling_point" => "确认按钮禁用时作者不能绕过 UI 触发执行",
    "target_reader" => "关注执行安全边界的作者",
    "tone_preference" => "克制、清晰"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

turn_id = "turn_au04_disabled_confirmation_seed"
behavior_id = "bh_au04_disabled_confirmation"
expires_at = "2999-01-01T00:00:00Z"
disabled_reason = "当前作品状态已变化，请重新生成计划后再确认。"

plan = %NovelDomain.MicroPlan{
  plan_id: "plan_au04_disabled_confirmation",
  turn_id: turn_id,
  frame_ref: "frame_au04_disabled_confirmation",
  plan_goal: %{summary: "重写第一章正文"},
  risk_hint: :high,
  requires_confirmation_hint: true,
  proposed_actions: [
    %{
      action_id: "act_au04_disabled_prose",
      action_type: :capability_invocation,
      summary: "重写第一章正文",
      target_ref: "prose_writing",
      write_intent: :production_candidate,
      risk_hint: :high
    }
  ],
  state_changes_requested: [],
  required_capabilities: [],
  fallback_strategy: %{downgrade_message: disabled_reason}
}

available_actions = [
  %{
    action_id: "act_au04_disabled_confirm",
    action_type: "confirm_before_execute",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: false,
    disabled_reason: disabled_reason,
    idempotency_key: "idem_au04_disabled_confirm",
    expires_at: expires_at
  },
  %{
    action_id: "act_au04_disabled_reject",
    action_type: "reject_or_cancel_confirmation",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "prose_writing",
    enabled: true,
    idempotency_key: "idem_au04_disabled_reject",
    expires_at: expires_at
  }
]

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_au04_disabled_confirmation",
  phase: "awaiting_author",
  status: "needs_confirmation",
  assistant_message: %{
    text: "AU04禁用确认动作文本：这条确认卡用于验证禁用确认按钮不会发送 author_action，也不会执行工具。"
  },
  frame_summary: %{
    frame_type: "execution_request",
    dialogue_goal: "禁用确认动作真实 UI 验证"
  },
  plan: DialogueGateway.jsonable(plan),
  ui_cards: [
    %{
      card_type: "confirmation_card",
      title: "禁用确认动作",
      body: "系统保留确认卡，但确认执行暂不可用；作者必须重新生成计划后再确认。",
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
      opened_by_decision_ref: "decision_au04_disabled_confirmation",
      frame_ref: "frame_au04_disabled_confirmation",
      plan_ref: plan.plan_id,
      required_next_action: "confirm_before_execute",
      target_ref: "prose_writing",
      prompt_contract: %{question: "确认重写第一章正文"},
      available_actions: available_actions,
      closed_at_turn_ref: nil,
      trace_ref: "trace_au04_disabled_confirmation",
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
    reason_codes: ["require_confirmation", "disabled_confirmation_seed"]
  },
  trace_summary: %{
    trace_ref: "trace_au04_disabled_confirmation",
    decision_type: "require_confirmation",
    reason_codes: ["require_confirmation", "disabled_confirmation_seed"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "请重写第一章正文，但当前确认动作应保持禁用。"},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.7,
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
    freshness_score: 0.7,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au04-disabled-confirmation-action-ui-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id}"
)
