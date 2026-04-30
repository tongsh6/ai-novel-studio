defmodule NovelAgent.OrchestratorTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Orchestrator

  describe "start_turn/2" do
    test "allocates a turn id and produces a valid route_result" do
      turn = Orchestrator.start_turn("建一本玄幻小说")

      assert String.starts_with?(turn.turn_id, "turn_")
      assert turn.input == "建一本玄幻小说"
      # Route result is always a valid struct — intent depends on LLM availability
      assert %NovelAgent.Router.Result{} = turn.route_result
    end

    test "returns unknown for unrecognized text" do
      turn = Orchestrator.start_turn("今天天气真好")

      assert turn.route_result.intent_name == :unknown
    end

    test "accepts caller-provided turn id for idempotent entry points" do
      turn = Orchestrator.start_turn("今天天气真好", turn_id: "turn-fixed")

      assert turn.turn_id == "turn-fixed"
      assert turn.route_result.intent_name == :unknown
    end

    test "allocates canonical turn ids independently from routing" do
      assert String.starts_with?(Orchestrator.allocate_turn_id(), "turn_")
    end
  end
end
