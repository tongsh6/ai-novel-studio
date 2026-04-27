defmodule NovelAgent.Memory.StoreTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Memory.Store

  describe "record/1 + recent/2" do
    test "stores and retrieves recent interactions" do
      Store.record(%{
        workspace_id: "ws-test",
        turn_id: "t1",
        role: "user",
        content: %{text: "hello"}
      })

      Store.record(%{
        workspace_id: "ws-test",
        turn_id: "t1",
        role: "assistant",
        content: %{text: "hi"}
      })

      recent = Store.recent("ws-test", 10)
      assert length(recent) == 2
      assert Enum.any?(recent, &(&1.role == "user"))
      assert Enum.any?(recent, &(&1.role == "assistant"))
    end
  end

  describe "by_turn/2" do
    test "retrieves all interactions for a turn" do
      Store.record(%{
        workspace_id: "ws-t2",
        turn_id: "turn-a",
        role: "user",
        content: %{text: "a"}
      })

      Store.record(%{
        workspace_id: "ws-t2",
        turn_id: "turn-a",
        role: "assistant",
        content: %{text: "A"}
      })

      Store.record(%{
        workspace_id: "ws-t2",
        turn_id: "turn-b",
        role: "user",
        content: %{text: "b"}
      })

      results = Store.by_turn("ws-t2", "turn-a")
      assert length(results) == 2
    end
  end
end
