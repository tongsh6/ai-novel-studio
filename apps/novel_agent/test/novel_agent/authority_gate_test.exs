defmodule NovelAgent.AuthorityGateTest do
  use ExUnit.Case, async: false

  alias NovelAgent.AuthorityGate

  describe "authorize/2" do
    test "allows low-risk actions without confirmation flag" do
      assert :allowed = AuthorityGate.authorize(:simple_complete)
      assert :allowed = AuthorityGate.authorize(:create_work_seed)
    end

    test "requires confirmation when requires_confirmation is true" do
      assert {:confirm_required, reason} =
               AuthorityGate.authorize(:create_work_seed, %{requires_confirmation: true})

      assert reason =~ "确认"
    end

    test "requires confirmation when risk_class is high" do
      assert {:confirm_required, _reason} =
               AuthorityGate.authorize(:some_high_risk_action, %{risk_class: "high"})
    end

    test "allows when risk_class is low without requires_confirmation" do
      assert :allowed =
               AuthorityGate.authorize(:normal_action, %{risk_class: "low"})
    end
  end

  describe "request_confirmation/1 + take_pending/1" do
    test "stores and retrieves pending confirmation context" do
      context = %{
        intent_name: "intent.CREATE_WORK_SEED",
        extracted_slots: %{"genre" => "玄幻", "core_selling_point" => "重生逆袭"}
      }

      behavior_id = AuthorityGate.request_confirmation(context)
      assert is_binary(behavior_id)
      assert String.starts_with?(behavior_id, "confirm_")

      retrieved = AuthorityGate.take_pending(behavior_id)
      assert retrieved.intent_name == "intent.CREATE_WORK_SEED"
      assert retrieved.extracted_slots["genre"] == "玄幻"
      assert retrieved.behavior_id == behavior_id
    end

    test "take_pending returns nil for unknown behavior_id" do
      assert nil == AuthorityGate.take_pending("nonexistent")
    end

    test "take_pending removes the entry (idempotent consume)" do
      behavior_id = AuthorityGate.request_confirmation(%{intent_name: "test"})

      assert %{} = AuthorityGate.take_pending(behavior_id)
      assert nil == AuthorityGate.take_pending(behavior_id)
    end
  end
end
