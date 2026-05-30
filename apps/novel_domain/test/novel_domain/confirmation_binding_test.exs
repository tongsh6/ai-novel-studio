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
                 "idempotency_key" => "idem-1"
               })

      assert binding.behavior_ref == "bh-1"
      assert binding.target_ref == "as-1"
      assert binding.answer_type == :confirm
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
                 "answer_type" => "approve"
               })
    end

    test "reject answer is not a confirm" do
      assert {:ok, binding} =
               ConfirmationBinding.build(%{
                 "behavior_ref" => "bh-1",
                 "target_ref" => "as-1",
                 "author_input_ref" => "in-1",
                 "answer_type" => "reject"
               })

      refute ConfirmationBinding.confirm?(binding)
    end
  end
end
