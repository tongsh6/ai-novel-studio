defmodule NovelPersistence.AuthorActionReceiptRepoTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.ID
  alias NovelPersistence.AuthorActionReceiptRepo

  describe "record/2 and get/1" do
    test "persists and fetches an author action receipt by idempotency key" do
      key_attrs = %{
        work_id: ID.uuid(),
        session_id: ID.uuid(),
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-confirm"
      }

      result = %{
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        status: "accepted",
        idempotency_key: "ik-confirm"
      }

      assert {:ok, receipt} = AuthorActionReceiptRepo.record(key_attrs, result)
      assert receipt.status == "accepted"

      assert fetched = AuthorActionReceiptRepo.get(key_attrs)
      assert fetched.id == receipt.id
      assert AuthorActionReceiptRepo.entry_from_record(fetched).result.status == "accepted"
    end

    test "keeps receipt identity unique for the same action key" do
      key_attrs = %{
        work_id: ID.uuid(),
        session_id: nil,
        source_turn_ref: "turn-dup",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-dup"
      }

      assert {:ok, first} = AuthorActionReceiptRepo.record(key_attrs, %{status: "accepted"})
      assert {:ok, second} = AuthorActionReceiptRepo.record(key_attrs, %{status: "accepted"})

      assert first.id == second.id
      assert AuthorActionReceiptRepo.get(key_attrs).id == first.id
    end
  end
end
