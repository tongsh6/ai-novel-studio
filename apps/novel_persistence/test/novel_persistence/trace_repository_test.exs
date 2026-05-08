defmodule NovelPersistence.TraceRepositoryTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.Repo
  alias NovelPersistence.TraceRepository

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  describe "insert/1" do
    test "persists a DecisionTrace record" do
      attrs = %{
        workspace_id: "ws-test",
        trace_id: "trace-test-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: "turn-test",
        frame_ref: "frame-test",
        decision_type: "reply_only",
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply_only",
        no_write_reason: "no write",
        turn_result_ref: "turn-test",
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        redaction_level: "author_safe",
        event_order: ["author_input_received", "turn_result_emitted"]
      }

      assert {:ok, record} = TraceRepository.insert(attrs)
      assert record.trace_id == attrs.trace_id
      assert record.decision_type == "reply_only"
    end

    test "rejects duplicate trace_id" do
      attrs = %{
        workspace_id: "ws-dup",
        trace_id: "trace-dup-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: "turn-1",
        frame_ref: "frame-1",
        decision_type: "reply_only",
        event_order: ["author_input_received"]
      }

      assert {:ok, _} = TraceRepository.insert(attrs)
      assert {:error, _changeset} = TraceRepository.insert(attrs)
    end
  end

  describe "list_by_workspace/2" do
    test "returns traces for workspace ordered by newest first" do
      ws_id = "ws-list-#{System.unique_integer([:positive, :monotonic])}"

      for i <- 1..3 do
        TraceRepository.insert(%{
          workspace_id: ws_id,
          trace_id: "trace-list-#{i}-#{System.unique_integer([:positive, :monotonic])}",
          turn_id: "turn-#{i}",
          frame_ref: "frame-#{i}",
          decision_type: "reply_only",
          event_order: ["author_input_received"]
        })
      end

      traces = TraceRepository.list_by_workspace(ws_id)
      assert length(traces) == 3
    end
  end

  describe "get_by_trace_id/1" do
    test "returns nil for unknown trace_id" do
      assert TraceRepository.get_by_trace_id("nonexistent") == nil
    end
  end

  describe "list_by_turn/1" do
    test "returns traces for a given turn" do
      turn_id = "turn-query-#{System.unique_integer([:positive, :monotonic])}"

      TraceRepository.insert(%{
        workspace_id: "ws-query",
        trace_id: "trace-query-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-query",
        decision_type: "tool_dispatched",
        event_order: ["tool_dispatched"]
      })

      traces = TraceRepository.list_by_turn(turn_id)
      assert length(traces) == 1
    end
  end

  describe "persister_callback/0" do
    test "returns a function that persists and returns :ok" do
      callback = TraceRepository.persister_callback()
      assert is_function(callback, 1)

      attrs = %{
        workspace_id: "ws-callback",
        trace_id: "trace-callback-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: "turn-callback",
        frame_ref: "frame-callback",
        decision_type: "reply_only",
        event_order: ["author_input_received"]
      }

      assert :ok = callback.(attrs)
    end
  end
end
