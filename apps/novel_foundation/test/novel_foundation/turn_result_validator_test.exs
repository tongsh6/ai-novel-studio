defmodule NovelFoundation.TurnResultValidatorTest do
  use ExUnit.Case, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.BehaviorStatus
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TurnPhase
  alias NovelFoundation.TurnResultValidator
  alias NovelFoundation.TurnResultValidator.ValidationError

  defp valid_turn_result(overrides \\ %{}) do
    %{
      schema_version: "2.0.0",
      turn_id: "turn_1",
      phase: TurnPhase.completed(),
      status: Status.done(),
      next_action: NextAction.no_further_action(),
      assistant_message: %{text: "ok"},
      ui_cards: [],
      behavior_state: %{active: nil, history: []},
      adoption_state: %{pending: [], resolved: []},
      projection_refs: [],
      validation: %{},
      usage: %{},
      trace_ref: %{},
      produced_at: "2026-04-28T00:00:00Z"
    }
    |> Map.merge(overrides)
  end

  describe "happy path" do
    test "minimal valid TurnResult passes" do
      assert :ok = TurnResultValidator.validate(valid_turn_result())
    end

    test "valid TurnResult with active clarification behavior" do
      tr =
        valid_turn_result(%{
          phase: TurnPhase.needs_clarification(),
          status: Status.waiting_user(),
          next_action: NextAction.ask_user(),
          behavior_state: %{
            active: %{
              behavior_type: "clarification",
              behavior_id: "b_1",
              status: BehaviorStatus.waiting_user(),
              resolution_ref: nil
            },
            history: []
          }
        })

      assert :ok = TurnResultValidator.validate(tr)
    end

    test "valid TurnResult with pending adoption artifact" do
      tr =
        valid_turn_result(%{
          adoption_state: %{
            pending: [
              %{
                artifact_id: "a_1",
                artifact_type: "work",
                adoption_status: AdoptionStatus.tentative(),
                requires_adoption: true
              }
            ],
            resolved: []
          }
        })

      assert :ok = TurnResultValidator.validate(tr)
    end
  end

  describe "violations" do
    test "rejects missing required field" do
      tr = valid_turn_result() |> Map.delete(:projection_refs)
      assert {:error, [msg]} = TurnResultValidator.validate(tr)
      assert msg =~ "projection_refs"
    end

    test "rejects non-canonical phase" do
      tr = valid_turn_result(%{phase: "execution"})
      assert {:error, [msg]} = TurnResultValidator.validate(tr)
      assert msg =~ "phase=\"execution\""
    end

    test "rejects non-canonical next_action" do
      tr = valid_turn_result(%{next_action: "clarification"})
      assert {:error, msgs} = TurnResultValidator.validate(tr)
      assert Enum.any?(msgs, &String.contains?(&1, ~s(next_action=\"clarification\")))
    end

    test "rejects valid next_action that violates ADR-0002 §7 (e.g. ASK_USER in COMPLETED)" do
      tr =
        valid_turn_result(%{
          phase: "COMPLETED",
          next_action: "ASK_USER"
        })

      assert {:error, msgs} = TurnResultValidator.validate(tr)
      assert Enum.any?(msgs, &String.contains?(&1, "ADR-0002 §7"))
    end

    test "rejects non-user-waiting next_action when behavior is active (ADR-0002 §7 rule 3)" do
      tr =
        valid_turn_result(%{
          phase: "COMPLETED",
          next_action: "SHOW_RESULT",
          behavior_state: %{
            active: %{
              behavior_type: "clarification",
              behavior_id: "b_1",
              status: "WAITING_USER"
            },
            history: []
          }
        })

      assert {:error, msgs} = TurnResultValidator.validate(tr)
      assert Enum.any?(msgs, &String.contains?(&1, "rule 3"))
    end

    test "rejects bad schema_version format" do
      tr = valid_turn_result(%{schema_version: "0.1"})
      assert {:error, [msg]} = TurnResultValidator.validate(tr)
      assert msg =~ "not semver"
    end

    test "rejects lowercase adoption_status (catches the original drift)" do
      tr =
        valid_turn_result(%{
          adoption_state: %{
            pending: [
              %{
                artifact_id: "a_1",
                artifact_type: "work",
                adoption_status: "tentative",
                requires_adoption: true
              }
            ],
            resolved: []
          }
        })

      assert {:error, [msg]} = TurnResultValidator.validate(tr)
      assert msg =~ "adoption_status=\"tentative\""
    end

    test "rejects terminal behavior_status in active slot" do
      tr =
        valid_turn_result(%{
          behavior_state: %{
            active: %{
              behavior_type: "clarification",
              behavior_id: "b_1",
              status: "RESOLVED"
            },
            history: []
          }
        })

      assert {:error, msgs} = TurnResultValidator.validate(tr)
      assert Enum.any?(msgs, &String.contains?(&1, "terminal"))
    end

    test "validate!/1 raises on violation" do
      assert_raise ValidationError, fn ->
        TurnResultValidator.validate!(valid_turn_result(%{phase: "bad"}))
      end
    end

    test "validate!/1 returns input on success" do
      tr = valid_turn_result()
      assert ^tr = TurnResultValidator.validate!(tr)
    end
  end
end
