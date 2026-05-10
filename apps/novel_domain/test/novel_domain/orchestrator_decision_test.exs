defmodule NovelDomain.OrchestratorDecisionTest do
  use ExUnit.Case, async: true
  alias NovelDomain.OrchestratorDecision

  @base_decision %OrchestratorDecision{
    decision_id: "d1",
    turn_id: "t1",
    frame_ref: "f1",
    decision_type: :allow_tool,
    decision_status: :decided,
    reason_codes: []
  }

  describe "blocks_execution?/1" do
    test "returns true for blocking types" do
      assert OrchestratorDecision.blocks_execution?(%{
               @base_decision
               | decision_type: :downgrade_to_dialogue
             })

      assert OrchestratorDecision.blocks_execution?(%{
               @base_decision
               | decision_type: :require_confirmation
             })

      assert OrchestratorDecision.blocks_execution?(%{
               @base_decision
               | decision_type: :require_clarification
             })

      assert OrchestratorDecision.blocks_execution?(%{@base_decision | decision_type: :reject})

      assert OrchestratorDecision.blocks_execution?(%{
               @base_decision
               | decision_type: :fail_with_recovery
             })
    end

    test "returns false for non-blocking types" do
      refute OrchestratorDecision.blocks_execution?(%{
               @base_decision
               | decision_type: :allow_tool
             })
    end
  end

  describe "truthfulness_constraints/1" do
    test "returns correct constraints for each type" do
      assert "no_action_executed" in OrchestratorDecision.truthfulness_constraints(%{
               @base_decision
               | decision_type: :downgrade_to_dialogue
             })

      assert "no_action_executed" in OrchestratorDecision.truthfulness_constraints(%{
               @base_decision
               | decision_type: :require_confirmation
             })

      assert "blocked_by_policy" in OrchestratorDecision.truthfulness_constraints(%{
               @base_decision
               | decision_type: :reject
             })

      assert "tool_dispatched" in OrchestratorDecision.truthfulness_constraints(%{
               @base_decision
               | decision_type: :allow_tool
             })
    end
  end
end
