alias NovelApplication.{DialogueGateway, WorkService, WorkSessionService}
alias NovelPersistence.MemoryLog

{:ok, work} =
  WorkService.create(%{
    "title" => "AU04 最新上下文确认源作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "确认前修改作品名后，确认执行必须重新读取最新作品快照",
    "target_reader" => "关注执行安全边界的作者",
    "tone_preference" => "清晰、稳健"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

turn_id = "turn_au04_latest_context_rebase_seed"
behavior_id = "bh_au04_latest_context_rebase"
expires_at = "2999-01-01T00:00:00Z"

plan = %NovelDomain.MicroPlan{
  plan_id: "plan_au04_latest_context_rebase",
  turn_id: turn_id,
  frame_ref: "frame_au04_latest_context_rebase",
  plan_goal: %{summary: "生成角色设定并确认执行"},
  risk_hint: :high,
  requires_confirmation_hint: true,
  proposed_actions: [
    %{
      action_id: "act_au04_latest_context_character",
      action_type: :capability_invocation,
      summary: "生成角色设定",
      target_ref: "character_design",
      write_intent: :tentative,
      risk_hint: :high
    }
  ],
  state_changes_requested: [],
  required_capabilities: [],
  fallback_strategy: %{downgrade_message: "确认时会基于当前作品上下文重新评估。"}
}

available_actions = [
  %{
    action_id: "act_au04_latest_context_confirm",
    action_type: "confirm_before_execute",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "character_design",
    enabled: true,
    idempotency_key: "idem_au04_latest_context_confirm",
    expires_at: expires_at
  },
  %{
    action_id: "act_au04_latest_context_reject",
    action_type: "reject_or_cancel_confirmation",
    source_turn_ref: turn_id,
    behavior_ref: behavior_id,
    target_ref: "character_design",
    enabled: true,
    idempotency_key: "idem_au04_latest_context_reject",
    expires_at: expires_at
  }
]

turn_result = %{
  schema_version: "3.0-draft",
  turn_id: turn_id,
  work_id: work.id,
  session_id: session_id,
  frame_ref: "frame_au04_latest_context_rebase",
  phase: "awaiting_author",
  status: "needs_confirmation",
  assistant_message: %{
    text: "AU04最新上下文旧确认文本：这条确认会在作品名修改后再执行，用来验证确认时重新读取最新作品快照。"
  },
  frame_summary: %{
    frame_type: "execution_request",
    dialogue_goal: "确认执行前最新上下文重组验证"
  },
  plan: DialogueGateway.jsonable(plan),
  ui_cards: [
    %{
      card_type: "confirmation_card",
      title: "最新上下文确认执行",
      body: "请先修改作品名，再确认执行；确认结果必须绑定修改后的作品 revision。",
      target_ref: "character_design",
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
      opened_by_decision_ref: "decision_au04_latest_context_rebase",
      frame_ref: "frame_au04_latest_context_rebase",
      plan_ref: plan.plan_id,
      required_next_action: "confirm_before_execute",
      target_ref: "character_design",
      prompt_contract: %{question: "确认生成角色设定"},
      available_actions: available_actions,
      closed_at_turn_ref: nil,
      trace_ref: "trace_au04_latest_context_rebase",
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
    reason_codes: ["require_confirmation", "latest_context_rebase_seed"]
  },
  trace_summary: %{
    trace_ref: "trace_au04_latest_context_rebase",
    decision_type: "require_confirmation",
    reason_codes: ["require_confirmation", "latest_context_rebase_seed"]
  },
  produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
}

entries = [
  %{
    workspace_id: work.id,
    session_id: session_id,
    turn_id: turn_id,
    role: "user",
    content: %{text: "请生成角色设定，确认前我会先修改作品名。"},
    source_ref: turn_id,
    scope_ref: work.id,
    freshness_score: 0.9,
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
    freshness_score: 0.9,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }
]

Enum.each(entries, fn entry ->
  {:ok, _interaction} = MemoryLog.record(entry)
end)

IO.puts(
  "[au04-latest-context-rebase-confirmation-seed] work_id=#{work.id} session_id=#{session_id} turn_id=#{turn_id} revision=#{work.revision}"
)
