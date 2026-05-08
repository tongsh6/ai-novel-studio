defmodule NovelApplication.BehaviorLifecycleTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ExecutionOrchestrator
  alias NovelDomain.BehaviorState
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  defp build_frame, do: struct!(DialogueFrame,
    schema_version: "3.0-draft", frame_id: "f-test", turn_id: "t-test",
    workspace_id: "ws-test", primary: true, frame_type: :casual_reply,
    source_refs: %{author_input_ref: "a-test", dialogue_context_ref: nil},
    dialogue_goal: %{summary: "test"}, tool_need: %{needs_tool: true, reason_code: :no_tool_needed},
    execution_readiness: :not_ready, author_visible_draft: %{message: "test"}, uncertainty: [])

  defp build_confirmation_plan do
    struct!(MicroPlan,
      plan_id: "p-confirm", turn_id: "t-test", frame_ref: "f-test",
      plan_goal: %{summary: "test confirm"}, risk_hint: :high,
      proposed_actions: [
        %{action_id: "a1", action_type: :tentative_artifact, summary: "危险操作",
          target_ref: "target-1", write_intent: :tentative, risk_hint: :high}
      ],
      stop_after_next_action: true, fallback_strategy: %{downgrade_message: "先聊聊"})
  end

  # ── BehaviorState lifecycle ────────────────────

  describe "BehaviorState" do
    test "open? returns true for :open status" do
      b = %BehaviorState{behavior_id: "b1", behavior_type: :confirmation,
        lifecycle_status: :open, opened_at_turn_ref: "t1",
        opened_by_decision_ref: "d1", frame_ref: "f1", required_next_action: "confirm"}
      assert BehaviorState.open?(b)
    end

    test "open? returns true for :awaiting_author" do
      b = %BehaviorState{behavior_id: "b1", behavior_type: :confirmation,
        lifecycle_status: :awaiting_author, opened_at_turn_ref: "t1",
        opened_by_decision_ref: "d1", frame_ref: "f1", required_next_action: "confirm"}
      assert BehaviorState.open?(b)
    end

    test "open? returns false for :resolved" do
      b = %BehaviorState{behavior_id: "b1", behavior_type: :confirmation,
        lifecycle_status: :resolved, opened_at_turn_ref: "t1",
        opened_by_decision_ref: "d1", frame_ref: "f1", required_next_action: "confirm"}
      refute BehaviorState.open?(b)
    end

    test "closed? returns true for resolved/cancelled/failed" do
      for status <- [:resolved, :cancelled, :failed] do
        b = %BehaviorState{behavior_id: "b1", behavior_type: :confirmation,
          lifecycle_status: status, opened_at_turn_ref: "t1",
          opened_by_decision_ref: "d1", frame_ref: "f1", required_next_action: "confirm"}
        assert BehaviorState.closed?(b), "expected #{status} to be closed"
      end
    end
  end

  # ── Orchestrator opens behavior ────────────────

  describe "orchestrator behavior creation" do
    test "high-risk confirmation plan opens behavior" do
      frame = build_frame()
      plan = build_confirmation_plan()

      {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :require_confirmation
      assert behavior != nil
      assert behavior.behavior_type == :confirmation
      assert BehaviorState.open?(behavior)
    end

    test "behavior has available actions" do
      frame = build_frame()
      plan = build_confirmation_plan()

      {_decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert behavior.available_actions != []
      assert Enum.any?(behavior.available_actions, &(&1.action_type == "confirm_before_execute"))
      assert Enum.any?(behavior.available_actions, &(&1.action_type == "reject_or_cancel_confirmation"))
    end

    test "downgrade does not open behavior" do
      frame = build_frame()

      plan = struct!(MicroPlan,
        plan_id: "p-dg", turn_id: "t-test", frame_ref: "f-test",
        plan_goal: %{summary: "multi"}, risk_hint: :low,
        proposed_actions: [
          %{action_id: "a1", action_type: :tentative_artifact, summary: "X",
            target_ref: nil, write_intent: :tentative, risk_hint: :low},
          %{action_id: "a2", action_type: :state_change_request, summary: "Y",
            target_ref: nil, write_intent: :none, risk_hint: :low}
        ],
        stop_after_next_action: true, fallback_strategy: %{downgrade_message: "先聚焦"})

      {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :downgrade_to_dialogue
      assert behavior == nil
    end

    test "behavior has required_next_action" do
      frame = build_frame()
      plan = build_confirmation_plan()

      {_decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert behavior.required_next_action != nil
      assert behavior.required_next_action == "confirm_before_execute"
    end
  end
end
