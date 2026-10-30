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

  describe "list_by_source_turn/3（B58 CP3 why/replay 来源）" do
    test "按 work/session/source_turn 过滤并保持插入顺序" do
      work_id = ID.uuid()
      session_id = ID.uuid()
      other_session = ID.uuid()
      other_work = ID.uuid()

      base = %{
        work_id: work_id,
        session_id: session_id,
        source_turn_ref: "turn-why-1",
        action_id: "act-accept",
        action_type: "accept",
        idempotency_key: "ik-why-1"
      }

      assert {:ok, first} =
               AuthorActionReceiptRepo.record(
                 base,
                 %{
                   status: "accepted",
                   approval_policy_ref: "approval_policy.high_risk_canon_change"
                 }
               )

      assert {:ok, _other_session} =
               AuthorActionReceiptRepo.record(
                 %{base | session_id: other_session, idempotency_key: "ik-why-2"},
                 %{status: "accepted"}
               )

      assert {:ok, _other_work} =
               AuthorActionReceiptRepo.record(
                 %{base | work_id: other_work, idempotency_key: "ik-why-3"},
                 %{status: "accepted"}
               )

      receipts = AuthorActionReceiptRepo.list_by_source_turn(work_id, session_id, "turn-why-1")
      assert Enum.map(receipts, & &1.id) == [first.id]
    end
  end
end
