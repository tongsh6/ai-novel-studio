defmodule NovelCommon.LogContextTest do
  use ExUnit.Case, async: true

  alias NovelCommon.LogContext

  setup do
    # Reset metadata between tests to avoid cross-contamination
    Logger.reset_metadata([])
    :ok
  end

  describe "put_turn/2" do
    test "sets workspace_id and work_id in Logger metadata" do
      :ok = LogContext.put_turn("ws-1", "work-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "ws-1"
      assert Keyword.fetch!(meta, :work_id) == "work-1"
    end

    test "sets turn_id when the gateway has already allocated one" do
      :ok = LogContext.put_turn("ws-1", "work-1", "turn-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "ws-1"
      assert Keyword.fetch!(meta, :work_id) == "work-1"
      assert Keyword.fetch!(meta, :turn_id) == "turn-1"
    end

    test "sets and clears session_id at turn boundaries" do
      :ok = LogContext.put_turn("ws-1", "work-1", "turn-1", "session-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :session_id) == "session-1"

      :ok = LogContext.put_turn("ws-1", "work-1", "turn-2")

      meta = Logger.metadata()
      refute Keyword.has_key?(meta, :session_id)
      assert Keyword.fetch!(meta, :turn_id) == "turn-2"
    end

    test "does not set work_id when nil" do
      :ok = LogContext.put_turn("ws-2")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "ws-2"
      refute Keyword.has_key?(meta, :work_id)
    end

    test "clears previous turn local keys" do
      # Simulate a previous turn that set frame_id, decision_id
      Logger.metadata(frame_id: "old-frame", decision_id: "old-dec", turn_id: "old-turn")
      LogContext.put_turn("ws-3")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "ws-3"
      # Logger drops keys with nil values — they simply don't appear
      refute Keyword.has_key?(meta, :turn_id)
      refute Keyword.has_key?(meta, :frame_id)
      refute Keyword.has_key?(meta, :decision_id)
      refute Keyword.has_key?(meta, :behavior_id)
      refute Keyword.has_key?(meta, :tool_request_id)
    end
  end

  describe "put_frame/1" do
    test "sets frame_id" do
      :ok = LogContext.put_frame("frame-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :frame_id) == "frame-1"
    end
  end

  describe "put_behavior/1" do
    test "sets behavior_id when non-nil" do
      :ok = LogContext.put_behavior("beh-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :behavior_id) == "beh-1"
    end

    test "no-ops on nil" do
      :ok = LogContext.put_behavior(nil)

      meta = Logger.metadata()
      refute Keyword.has_key?(meta, :behavior_id)
    end
  end

  describe "put_decision/1" do
    test "sets decision_id" do
      :ok = LogContext.put_decision("dec-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :decision_id) == "dec-1"
    end
  end

  describe "put_tool_request/1" do
    test "sets tool_request_id" do
      :ok = LogContext.put_tool_request("tq-1")

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :tool_request_id) == "tq-1"
    end
  end

  describe "snapshot/restore roundtrip" do
    test "roundtrip preserves all set keys" do
      LogContext.put_turn("ws", "w")
      LogContext.put_frame("f")

      snap = LogContext.snapshot()
      assert Keyword.fetch!(snap, :workspace_id) == "ws"
      assert Keyword.fetch!(snap, :work_id) == "w"
      assert Keyword.fetch!(snap, :frame_id) == "f"

      Logger.reset_metadata([])
      :ok = LogContext.restore(snap)

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "ws"
      assert Keyword.fetch!(meta, :frame_id) == "f"
    end

    test "restore clears previous metadata" do
      LogContext.put_turn("old-ws")
      snap = LogContext.snapshot()

      LogContext.put_turn("new-ws")
      LogContext.restore(snap)

      meta = Logger.metadata()
      assert Keyword.fetch!(meta, :workspace_id) == "old-ws"
    end
  end

  describe "cross-process" do
    # `Task.async` inherits parent metadata automatically (OTP 25+).
    # This test verifies the snapshot/restore path for `Kernel.spawn`.
    test "snapshot/restore in spawned process" do
      LogContext.put_turn("parent-ws", "parent-work")

      snap = LogContext.snapshot()

      parent = self()

      ref =
        spawn(fn ->
          LogContext.restore(snap)
          send(parent, {:meta, Logger.metadata()})
        end)

      assert_receive {:meta, meta}, 1000
      Process.exit(ref, :kill)

      assert Keyword.fetch!(meta, :workspace_id) == "parent-ws"
      assert Keyword.fetch!(meta, :work_id) == "parent-work"
    end
  end
end
