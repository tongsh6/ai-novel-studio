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

    test "clears provider execution refs left by the previous turn" do
      Logger.metadata(provider_call_ref: "pcall-old", provider_run_ref: "prun-old")

      :ok = LogContext.put_turn("ws-new", "work-new", "turn-new")

      meta = Logger.metadata()
      refute Keyword.has_key?(meta, :provider_call_ref)
      refute Keyword.has_key?(meta, :provider_run_ref)
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

  describe "with_provider_call/3" do
    test "binds both allocated refs only inside the scope" do
      assert :ok =
               LogContext.with_provider_call("pcall-1", "prun-1", fn ->
                 meta = Logger.metadata()
                 assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-1"
                 assert Keyword.fetch!(meta, :provider_run_ref) == "prun-1"
                 :ok
               end)

      meta = Logger.metadata()
      refute Keyword.has_key?(meta, :provider_call_ref)
      refute Keyword.has_key?(meta, :provider_run_ref)
    end

    test "restores the previous binding after normal, raise, throw, and exit" do
      Logger.metadata(provider_call_ref: "pcall-prev", provider_run_ref: "prun-prev")

      assert :done = LogContext.with_provider_call("pcall-normal", "prun-normal", fn -> :done end)
      assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"

      assert_raise RuntimeError, "boom", fn ->
        LogContext.with_provider_call("pcall-raise", "prun-raise", fn -> raise "boom" end)
      end

      assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"
      assert Keyword.fetch!(Logger.metadata(), :provider_run_ref) == "prun-prev"

      assert :thrown =
               catch_throw(
                 LogContext.with_provider_call("pcall-throw", "prun-throw", fn ->
                   throw(:thrown)
                 end)
               )

      assert :exited =
               catch_exit(
                 LogContext.with_provider_call("pcall-exit", "prun-exit", fn -> exit(:exited) end)
               )

      assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"
      assert Keyword.fetch!(Logger.metadata(), :provider_run_ref) == "prun-prev"
    end

    test "nested scopes restore the outer refs without touching unrelated metadata" do
      LogContext.with_provider_call("pcall-outer", "prun-outer", fn ->
        LogContext.put_step("outer-step")

        LogContext.with_provider_call("pcall-inner", "prun-inner", fn ->
          meta = Logger.metadata()
          assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-inner"
          assert Keyword.fetch!(meta, :provider_run_ref) == "prun-inner"
          assert Keyword.fetch!(meta, :current_step) == "outer-step"
        end)

        meta = Logger.metadata()
        assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-outer"
        assert Keyword.fetch!(meta, :provider_run_ref) == "prun-outer"
        assert Keyword.fetch!(meta, :current_step) == "outer-step"
      end)
    end

    test "parallel scopes keep their own refs" do
      parent = self()

      tasks =
        for index <- 1..2 do
          Task.async(fn ->
            LogContext.with_provider_call("pcall-#{index}", "prun-#{index}", fn ->
              send(parent, {:in_scope, index, self(), Logger.metadata()})

              receive do
                {:release, ^index} -> :ok
              end

              {index, Keyword.fetch!(Logger.metadata(), :provider_call_ref)}
            end)
          end)
        end

      bindings =
        for _ <- 1..2 do
          assert_receive {:in_scope, index, pid, meta}
          assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-#{index}"
          assert Keyword.fetch!(meta, :provider_run_ref) == "prun-#{index}"
          {index, pid}
        end

      Enum.each(bindings, fn {index, pid} -> send(pid, {:release, index}) end)

      assert tasks |> Enum.map(&Task.await/1) |> Enum.sort() == [
               {1, "pcall-1"},
               {2, "pcall-2"}
             ]
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
