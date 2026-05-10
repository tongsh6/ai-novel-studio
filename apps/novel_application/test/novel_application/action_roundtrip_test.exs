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

  describe "DialogueGateway handle_action" do
    alias NovelApplication.DialogueGateway

    test "valid action passes through gateway" do
      input = %AuthorActionInput{
        input_id: "in-gw",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:ok, result} = DialogueGateway.handle_action(input, @valid_source)
      assert result.action_id == "act-confirm"
      assert result.status == "accepted"
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
