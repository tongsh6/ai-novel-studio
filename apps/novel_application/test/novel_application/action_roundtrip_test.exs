defmodule NovelApplication.ActionRoundtripTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ActionValidator
  alias NovelDomain.AuthorActionInput

  @valid_source %{
    turn_id: "turn-1",
    available_actions: [
      %{
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        enabled: true,
        idempotency_key: "ik1"
      },
      %{
        action_id: "act-disabled",
        action_type: "cancel_pending_behavior",
        enabled: false,
        disabled_reason: "stale"
      }
    ]
  }

  describe "action validation" do
    test "valid action passes" do
      input = %AuthorActionInput{
        input_id: "in-1",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert :ok = ActionValidator.validate(input, @valid_source)
    end

    test "stale source_turn_ref rejected" do
      input = %AuthorActionInput{
        input_id: "in-stale",
        source_turn_ref: "turn-old",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "stale")
    end

    test "invented action rejected" do
      input = %AuthorActionInput{
        input_id: "in-invented",
        source_turn_ref: "turn-1",
        action_id: "act-fake",
        action_type: "nonexistent_action"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "invented")
    end

    test "disabled action rejected" do
      input = %AuthorActionInput{
        input_id: "in-disabled",
        source_turn_ref: "turn-1",
        action_id: "act-disabled",
        action_type: "cancel_pending_behavior"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "disabled")
    end

    test "missing source_turn_result rejected" do
      input = %AuthorActionInput{
        input_id: "in-1",
        source_turn_ref: "turn-1",
        action_id: "act-1",
        action_type: "test"
      }

      assert {:error, _} = ActionValidator.validate(input, nil)
    end
  end

  describe "action idempotency ledger" do
    alias NovelApplication.ActionIdempotencyLedger

    test "records successful actions by work/session/source/action/idempotency key" do
      input = %AuthorActionInput{
        input_id: "in-ledger-1",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-confirm"
      }

      result = %{status: "accepted", action_id: "act-confirm"}
      scope = %{work_id: "work-1", session_id: "session-1"}

      ledger = ActionIdempotencyLedger.record(%{}, input, scope, result)

      assert {:duplicate, entry} = ActionIdempotencyLedger.lookup(ledger, input, scope)
      assert entry.result == result
      assert entry.idempotency_key == "ik-confirm"
    end

    test "does not deduplicate actions without an idempotency key" do
      input = %AuthorActionInput{
        input_id: "in-ledger-2",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      ledger = ActionIdempotencyLedger.record(%{}, input, %{}, %{status: "accepted"})

      assert :miss = ActionIdempotencyLedger.lookup(ledger, input, %{})
    end

    test "keeps duplicate detection scoped to work and session" do
      input = %AuthorActionInput{
        input_id: "in-ledger-3",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-confirm"
      }

      ledger =
        ActionIdempotencyLedger.record(
          %{},
          input,
          %{work_id: "work-1", session_id: "session-1"},
          %{status: "accepted"}
        )

      assert :miss =
               ActionIdempotencyLedger.lookup(
                 ledger,
                 input,
                 %{work_id: "work-2", session_id: "session-1"}
               )
    end
  end

  describe "DialogueGateway handle_action" do
    alias NovelApplication.DialogueGateway

    @source_with_plan Map.put(@valid_source, :plan, %NovelDomain.MicroPlan{
                        plan_id: "plan-1",
                        turn_id: "turn-1",
                        frame_ref: "frame-1",
                        plan_goal: %{summary: "test"},
                        risk_hint: :low,
                        requires_confirmation_hint: false,
                        proposed_actions: [
                          %{action_type: :capability_invocation, target_ref: "text_analysis"}
                        ],
                        state_changes_requested: [],
                        required_capabilities: [],
                        fallback_strategy: %{downgrade_message: "fallback"}
                      })

    test "confirm_before_execute requires stored plan in source" do
      input = %AuthorActionInput{
        input_id: "in-gw",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "without stored plan")
    end

    test "confirm_before_execute with plan re-gates" do
      input = %AuthorActionInput{
        input_id: "in-gw-plan",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:ok, _ack} = DialogueGateway.handle_action(input, @source_with_plan)
    end

    test "invented action rejected by gateway" do
      input = %AuthorActionInput{
        input_id: "in-gw-fake",
        source_turn_ref: "turn-1",
        action_id: "act-fake",
        action_type: "nonexistent"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "invented")
    end

    test "stale action rejected by gateway" do
      input = %AuthorActionInput{
        input_id: "in-gw-stale",
        source_turn_ref: "turn-old",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "stale")
    end
  end
end
