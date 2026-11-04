defmodule NovelApplication.AgentEventSubscriptionTest do
  use ExUnit.Case, async: false

  alias NovelApplication.AgentEventPublisher
  alias NovelApplication.AgentRunService
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun

  test "session and work-wide subscribers each receive one copy; other scopes receive none" do
    run = run("run_scope_a", "work_a", "sess_a")
    event = event(run.run_id, 1)

    exact = subscriber("work_a", "sess_a")
    wide = subscriber("work_a", nil)
    other_work = subscriber("work_b", nil)
    other_session = subscriber("work_a", "sess_b")

    assert :ok = AgentEventPublisher.publish(event, run)

    assert_receive {:relayed, ^exact, ^event}
    assert_receive {:relayed, ^wide, ^event}
    refute_receive {:relayed, ^other_work, _event}, 50
    refute_receive {:relayed, ^other_session, _event}, 50
    refute_receive {:relayed, ^exact, _event}, 50
    refute_receive {:relayed, ^wide, _event}, 50
  end

  test "session-less run dispatches once to work-wide and never to exact sessions" do
    run = run("run_scope_nil", "work_a", nil)
    event = event(run.run_id, 1)

    exact = subscriber("work_a", "sess_a")
    wide = subscriber("work_a", nil)

    assert :ok = AgentEventPublisher.publish(event, run)

    assert_receive {:relayed, ^wide, ^event}
    refute_receive {:relayed, ^exact, _event}, 50
    refute_receive {:relayed, ^wide, _event}, 50
  end

  test "subscription lifecycle is owned by the subscriber process" do
    run = run("run_scope_cleanup", "work_a", "sess_a")
    event = event(run.run_id, 1)

    exact = subscriber("work_a", "sess_a")
    ref = Process.monitor(exact)
    send(exact, :stop)
    assert_receive {:DOWN, ^ref, :process, ^exact, :normal}

    assert wait_until(fn ->
             Registry.lookup(NovelApplication.AgentEventRegistry, {"work_a", "sess_a"}) == []
           end)

    assert :ok = AgentEventPublisher.publish(event, run)
    refute_receive {:relayed, ^exact, _event}, 50
  end

  test "service rejects a non-binary work scope" do
    assert_raise FunctionClauseError, fn ->
      AgentRunService.subscribe_events(nil, nil)
    end
  end

  defp subscriber(work_id, session_id) do
    parent = self()

    pid =
      spawn_link(fn ->
        :ok = AgentRunService.subscribe_events(work_id, session_id)
        send(parent, {:subscribed, self()})
        relay(parent)
      end)

    assert_receive {:subscribed, ^pid}
    pid
  end

  defp relay(parent) do
    receive do
      {:agent_event, event} ->
        send(parent, {:relayed, self(), event})
        relay(parent)

      :stop ->
        :ok
    end
  end

  defp run(run_id, work_id, session_id) do
    %AgentRun{
      run_id: run_id,
      workspace_id: "ws_scope",
      work_id: work_id,
      session_id: session_id,
      parent_turn_ref: "turn_scope"
    }
  end

  defp event(run_id, sequence) do
    %AgentEvent{
      event_id: "evt_#{run_id}_#{sequence}",
      run_ref: run_id,
      step_ref: nil,
      sequence: sequence,
      event_type: :run_started,
      visibility: :author,
      summary: "作用域事件",
      reason_codes: [],
      refs: [],
      payload: %{},
      emitted_at: DateTime.utc_now()
    }
  end

  defp wait_until(fun, deadline \\ nil) do
    deadline = deadline || System.monotonic_time(:millisecond) + 1_000

    if fun.() do
      true
    else
      if System.monotonic_time(:millisecond) >= deadline do
        false
      else
        Process.sleep(10)
        wait_until(fun, deadline)
      end
    end
  end
end
