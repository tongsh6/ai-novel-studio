defmodule NovelDomain.BehaviorStateTest do
  use ExUnit.Case, async: true

  alias NovelDomain.BehaviorState
  alias NovelFoundation.TurnResultValidator

  defp open_behavior(lifecycle \\ :awaiting_author) do
    %BehaviorState{
      behavior_id: "bh_1",
      behavior_type: :confirmation,
      lifecycle_status: lifecycle,
      blocking_actor: :author,
      opened_at_turn_ref: "turn_1",
      opened_by_decision_ref: "dec_1",
      frame_ref: "frame_1",
      target_ref: "as-1",
      required_next_action: "confirm_before_execute",
      available_actions: [%{action_type: "confirm_before_execute", behavior_ref: "bh_1"}],
      prompt_contract: %{summary: "确认覆盖"}
    }
  end

  describe "snapshot/1 形状（唯一 behavior_state 序列化入口）" do
    test "nil → %{active: nil, history: []}" do
      assert BehaviorState.snapshot(nil) == %{active: nil, history: []}
    end

    test "open behavior → 进 active，history 空，status 为 WAITING_USER 枚举" do
      snapshot = BehaviorState.snapshot(open_behavior(:awaiting_author))

      assert snapshot.history == []
      assert snapshot.active.behavior_id == "bh_1"
      assert snapshot.active.behavior_type == "confirmation"
      assert snapshot.active.status == "WAITING_USER"
    end

    test ":open lifecycle → status OPEN" do
      assert BehaviorState.snapshot(open_behavior(:open)).active.status == "OPEN"
    end

    test "closed behavior → 进 history，active 为 nil（终态不许留在 active）" do
      snapshot =
        BehaviorState.snapshot(%{
          open_behavior()
          | lifecycle_status: :resolved,
            resolution: %{ref: "resolution_1"},
            closed_at_turn_ref: "turn_2",
            trace_ref: "trace_1"
        })

      assert snapshot.active == nil

      assert [
               %{
                 status: "RESOLVED",
                 resolution_ref: "resolution_1",
                 closed_at_turn_ref: "turn_2",
                 trace_ref: "trace_1"
               }
             ] = snapshot.history
    end
  end

  describe "与 TurnResultValidator 契约对齐（防形状漂移）" do
    test "open / closed / nil 三种快照都通过 validate_behavior_state/1" do
      for behavior <- [
            open_behavior(:open),
            open_behavior(:awaiting_author),
            %{open_behavior() | lifecycle_status: :resolved},
            %{open_behavior() | lifecycle_status: :cancelled},
            nil
          ] do
        assert :ok = TurnResultValidator.validate_behavior_state(BehaviorState.snapshot(behavior))
      end
    end

    test "扁平形状（无 active/history）被 validator 拒绝——回归守卫" do
      flat = %{
        behavior_id: "bh_1",
        behavior_type: "confirmation",
        lifecycle_status: "awaiting_author"
      }

      assert {:error, violations} = TurnResultValidator.validate_behavior_state(flat)
      assert Enum.any?(violations, &(&1 =~ "behavior_state.active missing"))
    end
  end
end
