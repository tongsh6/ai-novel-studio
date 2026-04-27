defmodule NovelAgent.AuthorityGateTest do
  use ExUnit.Case, async: false

  alias NovelAgent.AuthorityGate

  describe "authorize/2" do
    test "allows all actions in Phase 0" do
      assert :allowed = AuthorityGate.authorize(:simple_complete)
      assert :allowed = AuthorityGate.authorize(:create_work)
      assert :allowed = AuthorityGate.authorize(:unknown_action)
    end

    test "accepts optional context" do
      assert :allowed = AuthorityGate.authorize(:simple_complete, %{workspace_id: "ws-1"})
    end
  end
end
