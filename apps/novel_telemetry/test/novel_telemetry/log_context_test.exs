defmodule NovelTelemetry.LogContextTest do
  use ExUnit.Case, async: true

  alias NovelTelemetry.LogContext

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

  test "private request evidence never enters generic Logger metadata or snapshots" do
    refs = %{base_refs: ["work:private-evidence"], observation_refs: [], used_refs: []}

    LogContext.with_provider_call("pcall-private", "prun-private", refs, fn ->
      refute Keyword.has_key?(Logger.metadata(), :provider_request_refs)
      refute Keyword.has_key?(LogContext.snapshot(), :provider_request_refs)
      refute inspect(Logger.metadata()) =~ "work:private-evidence"
      refute inspect(LogContext.snapshot()) =~ "work:private-evidence"
    end)
  end

  test "a turn switch inside nested calls cannot restore invalidated request evidence" do
    LogContext.put_turn("workspace-old", "work-old", "turn-old", "session-old")

    LogContext.with_provider_call("call-outer", "run-outer", %{base_refs: ["work:old"]}, fn ->
      LogContext.with_provider_call("call-inner", "run-inner", %{base_refs: ["work:inner"]}, fn ->
        LogContext.put_turn("workspace-new", "work-new", "turn-new", "session-new")
      end)

      assert LogContext.provider_request_refs() == nil
      refute Keyword.has_key?(Logger.metadata(), :provider_call_ref)
      refute Keyword.has_key?(Logger.metadata(), :provider_run_ref)
      assert Logger.metadata()[:turn_id] == "turn-new"
    end)

    assert LogContext.provider_request_refs() == nil
    assert Logger.metadata()[:work_id] == "work-new"
    refute Keyword.has_key?(Logger.metadata(), :provider_call_ref)
  end

  test "explicit restoration survives exceptional unwinding of invalidated nested calls" do
    LogContext.with_provider_call("call-outer", "run-outer", %{base_refs: ["work:old"]}, fn ->
      assert_raise RuntimeError, "after restore", fn ->
        LogContext.with_provider_call(
          "call-inner",
          "run-inner",
          %{base_refs: ["work:inner"]},
          fn ->
            LogContext.restore(
              workspace_id: "workspace-restored",
              turn_id: "turn-restored",
              provider_call_ref: "call-restored",
              provider_run_ref: "run-restored"
            )

            raise "after restore"
          end
        )
      end

      assert LogContext.provider_request_refs() == nil
      assert Logger.metadata()[:provider_call_ref] == "call-restored"
      assert Logger.metadata()[:provider_run_ref] == "run-restored"
    end)

    assert LogContext.provider_request_refs() == nil
    assert Logger.metadata()[:provider_call_ref] == "call-restored"
    assert Logger.metadata()[:turn_id] == "turn-restored"
  end

  describe "with_provider_call/4" do
    test "binds both allocated refs and private request evidence only inside the scope" do
      refs = %{base_refs: ["work:1"], observation_refs: [], used_refs: []}

      assert :ok =
               LogContext.with_provider_call("pcall-1", "prun-1", refs, fn ->
                 meta = Logger.metadata()
                 assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-1"
                 assert Keyword.fetch!(meta, :provider_run_ref) == "prun-1"
                 assert LogContext.provider_request_refs() == refs
                 refute Keyword.has_key?(meta, :provider_request_refs)
                 :ok
               end)

      meta = Logger.metadata()
      refute Keyword.has_key?(meta, :provider_call_ref)
      refute Keyword.has_key?(meta, :provider_run_ref)
      refute Keyword.has_key?(meta, :provider_request_refs)
      assert LogContext.provider_request_refs() == nil
    end

    test "restores the previous binding after normal, raise, throw, and exit" do
      previous_refs = %{base_refs: ["work:previous"], observation_refs: [], used_refs: []}

      LogContext.with_provider_call("pcall-prev", "prun-prev", previous_refs, fn ->
        assert :done =
                 LogContext.with_provider_call("pcall-normal", "prun-normal", nil, fn ->
                   assert LogContext.provider_request_refs() == nil
                   :done
                 end)

        assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"
        assert LogContext.provider_request_refs() == previous_refs

        assert_raise RuntimeError, "boom", fn ->
          LogContext.with_provider_call("pcall-raise", "prun-raise", nil, fn -> raise "boom" end)
        end

        assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"
        assert Keyword.fetch!(Logger.metadata(), :provider_run_ref) == "prun-prev"
        assert LogContext.provider_request_refs() == previous_refs

        assert :thrown =
                 catch_throw(
                   LogContext.with_provider_call("pcall-throw", "prun-throw", nil, fn ->
                     throw(:thrown)
                   end)
                 )

        assert LogContext.provider_request_refs() == previous_refs

        assert :exited =
                 catch_exit(
                   LogContext.with_provider_call("pcall-exit", "prun-exit", nil, fn ->
                     exit(:exited)
                   end)
                 )

        assert Keyword.fetch!(Logger.metadata(), :provider_call_ref) == "pcall-prev"
        assert Keyword.fetch!(Logger.metadata(), :provider_run_ref) == "prun-prev"
        assert LogContext.provider_request_refs() == previous_refs
      end)

      assert LogContext.provider_request_refs() == nil
    end

    test "nested scopes restore the outer refs without touching unrelated metadata" do
      LogContext.with_provider_call(
        "pcall-outer",
        "prun-outer",
        %{base_refs: ["work:outer"], observation_refs: [], used_refs: []},
        fn ->
          LogContext.put_step("outer-step")

          LogContext.with_provider_call(
            "pcall-inner",
            "prun-inner",
            %{base_refs: ["work:inner"], observation_refs: [], used_refs: []},
            fn ->
              meta = Logger.metadata()
              assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-inner"
              assert Keyword.fetch!(meta, :provider_run_ref) == "prun-inner"
              assert LogContext.provider_request_refs().base_refs == ["work:inner"]
              assert Keyword.fetch!(meta, :current_step) == "outer-step"
            end
          )

          meta = Logger.metadata()
          assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-outer"
          assert Keyword.fetch!(meta, :provider_run_ref) == "prun-outer"
          assert LogContext.provider_request_refs().base_refs == ["work:outer"]
          assert Keyword.fetch!(meta, :current_step) == "outer-step"
        end
      )
    end

    test "parallel scopes keep their own refs" do
      parent = self()

      tasks =
        for index <- 1..2 do
          Task.async(fn ->
            result =
              LogContext.with_provider_call(
                "pcall-#{index}",
                "prun-#{index}",
                %{base_refs: ["work:#{index}"], observation_refs: [], used_refs: []},
                fn ->
                  send(
                    parent,
                    {:in_scope, index, self(), Logger.metadata(),
                     LogContext.provider_request_refs()}
                  )

                  receive do
                    {:release, ^index} -> :ok
                  end

                  {index, Keyword.fetch!(Logger.metadata(), :provider_call_ref)}
                end
              )

            assert LogContext.provider_request_refs() == nil
            result
          end)
        end

      bindings =
        for _ <- 1..2 do
          assert_receive {:in_scope, index, pid, meta, evidence}
          assert Keyword.fetch!(meta, :provider_call_ref) == "pcall-#{index}"
          assert Keyword.fetch!(meta, :provider_run_ref) == "prun-#{index}"
          refute Keyword.has_key?(meta, :provider_request_refs)
          assert evidence.base_refs == ["work:#{index}"]
          {index, pid}
        end

      Enum.each(bindings, fn {index, pid} -> send(pid, {:release, index}) end)
      assert tasks |> Enum.map(&Task.await/1) |> Enum.sort() == [{1, "pcall-1"}, {2, "pcall-2"}]
    end

    test "unknown and explicitly empty request evidence remain different" do
      for refs <- [nil, %{}] do
        LogContext.with_provider_call("pcall-empty", "prun-empty", refs, fn ->
          assert LogContext.provider_request_refs() == refs
        end)
      end
    end

    test "mismatched correlation identifiers do not borrow the active private evidence" do
      LogContext.with_provider_call(
        "pcall-bound",
        "prun-bound",
        %{base_refs: ["work:bound"]},
        fn ->
          Logger.metadata(provider_call_ref: "pcall-other")
          assert LogContext.provider_request_refs() == nil
          Logger.metadata(provider_call_ref: "pcall-bound", provider_run_ref: "prun-other")
          assert LogContext.provider_request_refs() == nil
        end
      )
    end
  end

  test "a new turn clears stale private provider request evidence" do
    LogContext.with_provider_call("pcall-old", "prun-old", %{base_refs: ["work:old"]}, fn ->
      LogContext.put_turn("new-workspace", "new-work", "new-turn", "new-session")
      assert LogContext.provider_request_refs() == nil
      refute Keyword.has_key?(Logger.metadata(), :provider_request_refs)
    end)
  end

  test "cross-process snapshots transfer correlation only, not a previous request's material" do
    LogContext.with_provider_call(
      "pcall-parent",
      "prun-parent",
      %{base_refs: ["work:parent"]},
      fn ->
        snap = LogContext.snapshot()
        refute Keyword.has_key?(snap, :provider_request_refs)

        task =
          Task.async(fn ->
            :ok = LogContext.restore(snap)
            assert Logger.metadata()[:provider_call_ref] == "pcall-parent"
            assert LogContext.provider_request_refs() == nil

            LogContext.with_provider_call(
              "pcall-child",
              "prun-child",
              %{base_refs: ["work:child"]},
              fn ->
                assert LogContext.provider_request_refs() == %{base_refs: ["work:child"]}
              end
            )

            assert LogContext.provider_request_refs() == nil
          end)

        Task.await(task)
        assert LogContext.provider_request_refs() == %{base_refs: ["work:parent"]}
      end
    )
  end

  test "explicit metadata restoration clears any active private request binding" do
    LogContext.with_provider_call(
      "pcall-before",
      "prun-before",
      %{base_refs: ["work:before"]},
      fn ->
        LogContext.restore(
          work_id: "work-after",
          provider_call_ref: "pcall-before",
          provider_run_ref: "prun-before"
        )

        assert LogContext.provider_request_refs() == nil
      end
    )
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
