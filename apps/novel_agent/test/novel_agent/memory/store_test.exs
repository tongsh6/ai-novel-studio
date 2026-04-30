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

  describe "key collision prevention" do
    test "multiple records in same turn do not overwrite each other" do
      for i <- 1..5 do
        Store.record(%{
          workspace_id: "ws-no-overwrite",
          turn_id: "turn-same",
          role: "assistant",
          content: %{text: "msg-#{i}"}
        })
      end

      results = Store.by_turn("ws-no-overwrite", "turn-same")
      assert length(results) == 5
      texts = Enum.map(results, & &1.content.text)
      assert Enum.sort(texts) == ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"]
    end
  end

  describe "workspace isolation" do
    test "entries from one workspace do not leak into another" do
      Store.record(%{
        workspace_id: "ws-alpha",
        turn_id: "t1",
        role: "user",
        content: %{text: "alpha"}
      })

      Store.record(%{
        workspace_id: "ws-beta",
        turn_id: "t1",
        role: "user",
        content: %{text: "beta"}
      })

      alpha_results = Store.recent("ws-alpha", 10)
      beta_results = Store.recent("ws-beta", 10)

      assert length(alpha_results) == 1
      assert hd(alpha_results).content.text == "alpha"

      assert length(beta_results) == 1
      assert hd(beta_results).content.text == "beta"
    end

    test "by_turn respects workspace boundary" do
      Store.record(%{
        workspace_id: "ws-x",
        turn_id: "shared-turn-id",
        role: "user",
        content: %{text: "x-msg"}
      })

      Store.record(%{
        workspace_id: "ws-y",
        turn_id: "shared-turn-id",
        role: "user",
        content: %{text: "y-msg"}
      })

      assert length(Store.by_turn("ws-x", "shared-turn-id")) == 1
      assert length(Store.by_turn("ws-y", "shared-turn-id")) == 1
    end
  end

  describe "ordering" do
    test "recent returns entries in chronological order (oldest first)" do
      Store.record(%{workspace_id: "ws-ord", turn_id: "t1", role: "user", content: %{text: "first"}})
      Store.record(%{workspace_id: "ws-ord", turn_id: "t2", role: "user", content: %{text: "second"}})
      Store.record(%{workspace_id: "ws-ord", turn_id: "t3", role: "user", content: %{text: "third"}})

      results = Store.recent("ws-ord", 10)
      texts = Enum.map(results, & &1.content.text)
      assert texts == ["first", "second", "third"]
    end
  end
end
