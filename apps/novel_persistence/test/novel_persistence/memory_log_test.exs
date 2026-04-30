defmodule NovelPersistence.MemoryLogTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelFoundation.Enums.MemoryClass
  alias NovelFoundation.Enums.RetentionTier
  alias NovelFoundation.Enums.SourceType
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @valid_entry %{
    workspace_id: "ws-ml-test",
    turn_id: "turn-1",
    role: "user",
    content: %{text: "hello"},
    memory_class: MemoryClass.episodic(),
    retention_tier: RetentionTier.hot(),
    source_type: SourceType.turn(),
    source_ref: "turn-1",
    scope_ref: "ws-ml-test",
    freshness_score: 1.0,
    importance_score: 0.5,
    replayable: true,
    retrievable: true
  }

  describe "record/1" do
    test "persists the full entry to interactions table" do
      assert {:ok, interaction} = MemoryLog.record(@valid_entry)

      assert interaction.workspace_id == "ws-ml-test"
      assert interaction.turn_id == "turn-1"
      assert interaction.role == "user"
      assert interaction.memory_class == "episodic"
      assert interaction.retention_tier == "hot"
      assert interaction.source_type == "turn"
      assert interaction.source_ref == "turn-1"
      assert interaction.scope_ref == "ws-ml-test"
      assert interaction.freshness_score == 1.0
      assert interaction.importance_score == 0.5
      assert interaction.replayable == true
      assert interaction.retrievable == true
      assert interaction.content.text == "hello"
    end

    test "rejects missing workspace_id" do
      assert {:error, changeset} =
               MemoryLog.record(Map.delete(@valid_entry, :workspace_id))

      assert {:workspace_id, _} = List.keyfind(changeset.errors, :workspace_id, 0)
    end

    test "rejects invalid role" do
      assert {:error, changeset} =
               MemoryLog.record(%{@valid_entry | role: "bot"})

      assert {:role, _} = List.keyfind(changeset.errors, :role, 0)
    end

    test "rejects out-of-range freshness_score" do
      assert {:error, changeset} =
               MemoryLog.record(%{@valid_entry | freshness_score: 1.5})

      assert {:freshness_score, _} = List.keyfind(changeset.errors, :freshness_score, 0)
    end
  end

  describe "recent/2" do
    test "returns entries ordered by inserted_at desc" do
      MemoryLog.record(%{@valid_entry | turn_id: "t1"})
      MemoryLog.record(%{@valid_entry | turn_id: "t2"})

      results = MemoryLog.recent("ws-ml-test", 10)
      assert length(results) == 2

      # Most recent first
      assert Enum.at(results, 0).turn_id == "t2"
      assert Enum.at(results, 1).turn_id == "t1"
    end

    test "respects limit" do
      for i <- 1..5 do
        MemoryLog.record(%{@valid_entry | turn_id: "t#{i}"})
      end

      assert length(MemoryLog.recent("ws-ml-test", 3)) == 3
    end

    test "workspace isolation: only returns entries for matching workspace" do
      MemoryLog.record(%{@valid_entry | workspace_id: "ws-a"})
      MemoryLog.record(%{@valid_entry | workspace_id: "ws-b"})

      assert length(MemoryLog.recent("ws-a", 10)) == 1
      assert length(MemoryLog.recent("ws-b", 10)) == 1
      assert MemoryLog.recent("ws-nonexistent", 10) == []
    end
  end

  describe "downgrade/3" do
    test "updates retention_tier for all matching entries" do
      MemoryLog.record(@valid_entry)
      MemoryLog.record(@valid_entry)

      {2, nil} = MemoryLog.downgrade("ws-ml-test", "hot", "warm")

      results = MemoryLog.recent("ws-ml-test", 10)
      assert Enum.all?(results, &(&1.retention_tier == "warm"))
    end
  end

  describe "hot × warm field alignment" do
    test "entry map from TurnService.record_to_memory is accepted by MemoryLog" do
      # This replicates the exact structure produced by record_to_memory/4
      entry = %{
        workspace_id: "ws-align",
        turn_id: "turn-align",
        role: "assistant",
        content: %{text: "test"},
        memory_class: MemoryClass.episodic(),
        retention_tier: RetentionTier.hot(),
        source_type: SourceType.turn(),
        source_ref: "turn-align",
        scope_ref: "ws-align",
        freshness_score: 1.0,
        importance_score: 0.5,
        replayable: true,
        retrievable: true
      }

      assert {:ok, interaction} = MemoryLog.record(entry)
      assert interaction.workspace_id == "ws-align"
      assert interaction.turn_id == "turn-align"
    end
  end
end
