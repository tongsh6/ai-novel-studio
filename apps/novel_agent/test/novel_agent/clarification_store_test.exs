defmodule NovelAgent.ClarificationStoreTest do
  use ExUnit.Case, async: false

  alias NovelAgent.ClarificationStore

  describe "put_pending/1 + peek_pending/1" do
    test "stores and retrieves pending clarification state" do
      state = %{
        behavior_id: "behavior_test_001",
        workspace_id: "lobby",
        intent_name: "intent.CREATE_WORK_SEED",
        schema_id: "slot_schema.CREATE_WORK_SEED.v1",
        accumulated_slots: %{"genre" => "玄幻"},
        missing_slots: ["core_selling_point", "target_reader"],
        source_turn_ref: "turn_001"
      }

      bid = ClarificationStore.put_pending(state)
      assert bid == "behavior_test_001"

      retrieved = ClarificationStore.peek_pending(bid)
      assert retrieved.intent_name == "intent.CREATE_WORK_SEED"
      assert retrieved.accumulated_slots["genre"] == "玄幻"
      assert retrieved.missing_slots == ["core_selling_point", "target_reader"]
    end

    test "overwrites existing state for same behavior_id" do
      ClarificationStore.put_pending(%{
        behavior_id: "bid_002",
        workspace_id: "lobby",
        accumulated_slots: %{"genre" => "玄幻"}
      })

      ClarificationStore.put_pending(%{
        behavior_id: "bid_002",
        workspace_id: "lobby",
        accumulated_slots: %{"genre" => "玄幻", "core_selling_point" => "商战"}
      })

      retrieved = ClarificationStore.peek_pending("bid_002")
      assert retrieved.accumulated_slots["core_selling_point"] == "商战"
    end
  end

  describe "take_pending/1" do
    test "returns and removes pending state" do
      ClarificationStore.put_pending(%{
        behavior_id: "bid_003",
        workspace_id: "lobby",
        intent_name: "intent.CREATE_WORK_SEED"
      })

      entry = ClarificationStore.take_pending("bid_003")
      assert entry.intent_name == "intent.CREATE_WORK_SEED"

      assert ClarificationStore.peek_pending("bid_003") == nil
    end

    test "returns nil for unknown behavior_id" do
      assert ClarificationStore.take_pending("nonexistent") == nil
    end

    test "cleans up workspace index" do
      ClarificationStore.put_pending(%{
        behavior_id: "bid_004",
        workspace_id: "ws_test"
      })

      assert ClarificationStore.find_by_workspace("ws_test") == "bid_004"
      ClarificationStore.take_pending("bid_004")
      assert ClarificationStore.find_by_workspace("ws_test") == nil
    end
  end

  describe "find_by_workspace/1" do
    test "returns behavior_id for workspace with pending clarification" do
      ClarificationStore.put_pending(%{
        behavior_id: "bid_005",
        workspace_id: "ws_alpha"
      })

      assert ClarificationStore.find_by_workspace("ws_alpha") == "bid_005"
    end

    test "returns nil for workspace with no pending clarification" do
      assert ClarificationStore.find_by_workspace("ws_nonexistent") == nil
    end

    test "new put_pending replaces old in index" do
      ClarificationStore.put_pending(%{
        behavior_id: "bid_old",
        workspace_id: "ws_beta"
      })

      ClarificationStore.put_pending(%{
        behavior_id: "bid_new",
        workspace_id: "ws_beta"
      })

      assert ClarificationStore.find_by_workspace("ws_beta") == "bid_new"
    end
  end
end
