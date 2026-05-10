defmodule NovelFoundation.EnumsTest do
  use ExUnit.Case, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.BehaviorStatus
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase
  alias NovelFoundation.Enums.TurnPhase

  describe "ADR-0002 canonical sets" do
    test "Status family has the 8 fixed values from §2" do
      assert Status.values() ==
               ~w(READY WAITING_USER WAITING_SYSTEM RUNNING PAUSED DONE ERROR CANCELLED)
    end

    test "TurnPhase has the 9 fixed values from §3" do
      assert length(TurnPhase.values()) == 9
      assert TurnPhase.received() == "RECEIVED"
      assert TurnPhase.cancelled() == "CANCELLED"
    end

    test "TaskPhase has the 11 fixed values from §4 (CHECKPOINT not merged into PAUSED)" do
      assert length(TaskPhase.values()) == 11
      assert TaskPhase.checkpoint() == "CHECKPOINT"
      assert TaskPhase.branched() == "BRANCHED"
    end

    test "AdoptionStatus has the 7 lifecycle values from 30 §3.2" do
      assert AdoptionStatus.values() ==
               ~w(TENTATIVE ACCEPTED EDITED_ACCEPTED DISCARDED SUPERSEDED INVALIDATED ARCHIVED)
    end

    test "NextAction has the 8 canonical values from §6 (no EXECUTE_DIRECTLY)" do
      assert length(NextAction.values()) == 8
      refute "EXECUTE_DIRECTLY" in NextAction.values()
    end

    test "BehaviorStatus has the 5 values from §8" do
      assert BehaviorStatus.values() == ~w(OPEN WAITING_USER RESOLVED CANCELLED EXPIRED)
    end
  end

  describe "valid?/1" do
    test "rejects unknown values" do
      refute TurnPhase.valid?("execution")
      refute NextAction.valid?("clarification")
      refute AdoptionStatus.valid?("tentative")
    end

    test "accepts canonical values" do
      assert TurnPhase.valid?("EXECUTING")
      assert NextAction.valid?("ASK_USER")
      assert AdoptionStatus.valid?("TENTATIVE")
    end

    test "rejects non-string input" do
      refute TurnPhase.valid?(:executing)
      refute TurnPhase.valid?(nil)
    end
  end
end
