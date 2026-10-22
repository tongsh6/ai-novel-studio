defmodule NovelDomain.ConfirmationBindingTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ConfirmationBinding

  describe "build/1" do
    test "builds a confirm binding bound to behavior + target" do
      assert {:ok, binding} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm",
                 "idempotency_key" => "idem-1",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"],
                 "trace_ref" => "decision_trace:turn-1"
               })

      assert binding.behavior_ref == "bh-1"
      assert binding.target_ref == "as-1"
      assert binding.answer_type == :confirm
      assert binding.rebased_state_snapshot_ref == "state_snapshot:work-1:turn-1"
      assert binding.gate_result_refs == ["gate_result:turn-1:confirm"]
      assert ConfirmationBinding.confirm?(binding)
      assert is_binary(binding.binding_id)
    end

    test "rejects a binding without a target" do
      assert {:error, "confirmation binding requires target_ref"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm"
               })
    end

    test "rejects an unknown answer_type" do
      assert {:error, "confirmation binding requires a valid answer_type"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "approve",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"]
               })
    end

    test "rejects a binding without a rebased state snapshot" do
      assert {:error, "confirmation binding requires rebased_state_snapshot_ref"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"]
               })
    end

    test "rejects a binding without gate result refs" do
      assert {:error, "confirmation binding requires gate_result_refs"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1"
               })
    end

    test "rejects a binding without idempotency_key（ADR-0009 #1 必填）" do
      assert {:error, "confirmation binding requires idempotency_key"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"],
                 "trace_ref" => "decision_trace:turn-1"
               })
    end

    test "rejects a binding without trace_ref（ADR-0009 #1 必填）" do
      assert {:error, "confirmation binding requires trace_ref"} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "confirm",
                 "idempotency_key" => "idem-1",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"]
               })
    end

    test "reject answer is not a confirm" do
      assert {:ok, binding} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "reject",
                 "idempotency_key" => "idem-2",
                 "rebased_state_snapshot_ref" => "state_snapshot:work-1:turn-1",
                 "gate_result_refs" => ["gate_result:turn-1:confirm"],
                 "trace_ref" => "decision_trace:turn-1"
               })

      refute ConfirmationBinding.confirm?(binding)
    end
  end
end
