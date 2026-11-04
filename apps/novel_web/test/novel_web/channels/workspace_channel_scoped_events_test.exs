defmodule NovelWeb.WorkspaceChannelScopedEventsTest do
  @moduledoc """
  真实 Channel transport 的作用域事件回归：两个窗口各自 join 一次，同一持久
  event_id 每个 transport 只收一份；运行中 join 的窗口不回放历史；重复
  reconnect 不增加订阅。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentStep}
  alias NovelPersistence.{AgentRunLog, Repo, WorkRepo, WorkSessionRepo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)

    on_exit(fn ->
      NovelApplication.TestAgentRunCleanup.await_quiescent()
      Sandbox.stop_owner(owner)
    end)

    {:ok, work} = WorkRepo.create(%{title: "作用域事件回归"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})

    {:ok, work: work, session: session}
  end

  test "two real transports each receive one copy; live join does not replay history", ctx do
    parent = self()
    {:ok, sup} = Supervisor.start_link([], strategy: :one_for_one)

    on_exit(fn ->
      if Process.alive?(sup) do
        try do
          Supervisor.stop(sup)
        catch
          :exit, _reason -> :ok
        end
      end
    end)

    forwarder_a = start_forwarder(:window_a, parent)
    forwarder_b = start_forwarder(:window_b, parent)

    {:ok, _, socket_a} = join_window(forwarder_a, sup, ctx)
    run_id = "run_scoped_#{System.unique_integer([:positive, :monotonic])}"

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence, self()})

      receive do
        :release -> :ok
      after
        10_000 -> raise "scoped events step was not released"
      end

      {:ok,
       %{
         step: step_struct(run_id, sequence, "scoped_step_#{sequence}"),
         observations: [observation(run_id, sequence)]
       }}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(run_attrs(ctx, run_id),
               next_step_planner: sequential_steps([step])
             )

    assert_receive {:step_started, 1, step_pid}, 5_000

    {:ok, _, socket_b} = join_window(forwarder_b, sup, ctx)

    assert subscription_count(ctx) == 2

    assert Enum.sort(subscriptions(ctx)) ==
             Enum.sort([socket_a.channel_pid, socket_b.channel_pid])

    pre_release = flush_transport()
    pre_release_b = for {:window_b, message} <- pre_release, do: message
    pre_release_a = for {:window_a, message} <- pre_release, do: message
    assert agent_event_count(pre_release_b) == 0
    assert agent_event_count(pre_release_a) <= 1

    send(step_pid, :release)

    messages = collect_transport(System.monotonic_time(:millisecond) + 5_000)
    persisted = wait_for_terminal(run_id, 5_000)
    completed = Enum.find(persisted, &(&1.event_type == "run_completed"))

    assert completed,
           "run_completed was not persisted: #{inspect(Enum.map(persisted, & &1.event_type))}"

    assert transport_count(messages, :window_a, completed.id) == 1
    assert transport_count(messages, :window_b, completed.id) == 1

    # 重复 reconnect 请求是真实 join/恢复路径的常见重入；不得增加订阅。
    assert {:ok, _} = AgentRunService.reconnect_bounded(ctx.work.id, ctx.session.id)
    assert {:ok, _} = AgentRunService.reconnect_bounded(ctx.work.id, ctx.session.id)
    assert subscription_count(ctx) == 2
  end

  defp join_window(forwarder, sup, ctx) do
    socket = %Phoenix.Socket{
      handler: UserSocket,
      endpoint: NovelWeb.Endpoint,
      pubsub_server: NovelWeb.PubSub,
      topic: "workspace:#{ctx.work.id}",
      transport: {Phoenix.ChannelTest, sup},
      serializer: Phoenix.ChannelTest.NoopSerializer,
      transport_pid: forwarder,
      assigns: %{}
    }

    {:ok, reply, socket} =
      Phoenix.ChannelTest.join(socket, WorkspaceChannel, "workspace:#{ctx.work.id}", %{
        "session_id" => ctx.session.id
      })

    _ = :sys.get_state(socket.channel_pid)
    {:ok, reply, socket}
  end

  defp start_forwarder(label, parent) do
    pid =
      spawn_link(fn ->
        send(parent, {:forwarder_ready, label, self()})
        forward_loop(label, parent)
      end)

    assert_receive {:forwarder_ready, ^label, ^pid}, 2_000
    pid
  end

  defp forward_loop(label, parent) do
    receive do
      message ->
        send(parent, {:transport, label, message})
        forward_loop(label, parent)
    end
  end

  defp flush_transport do
    receive do
      {:transport, _label, message} -> [message | flush_transport()]
    after
      100 -> []
    end
  end

  defp collect_transport(deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:transport, label, message} -> [{label, message} | collect_transport(deadline)]
    after
      remaining -> []
    end
  end

  defp agent_event_count(messages) do
    Enum.count(messages, &match?(%Phoenix.Socket.Message{event: "agent_event"}, &1))
  end

  defp transport_count(messages, label, event_id) do
    Enum.count(messages, fn
      {^label, %Phoenix.Socket.Message{event: "agent_event", payload: payload}} ->
        payload_event_id(payload) == event_id

      _other ->
        false
    end)
  end

  defp payload_event_id(payload), do: Map.get(payload, :event_id) || Map.get(payload, "event_id")

  defp subscriptions(ctx) do
    NovelApplication.AgentEventRegistry
    |> Registry.lookup({ctx.work.id, ctx.session.id})
    |> Enum.map(fn {pid, _value} -> pid end)
  end

  defp subscription_count(ctx), do: length(subscriptions(ctx))

  defp wait_for_terminal(run_id, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    wait_for_terminal_until(run_id, deadline)
  end

  defp wait_for_terminal_until(run_id, deadline) do
    events = AgentRunLog.list_events(run_id)

    cond do
      Enum.any?(events, &(&1.event_type == "run_completed")) ->
        events

      System.monotonic_time(:millisecond) >= deadline ->
        events

      true ->
        Process.sleep(10)
        wait_for_terminal_until(run_id, deadline)
    end
  end

  defp run_attrs(ctx, run_id) do
    %{
      run_id: run_id,
      workspace_id: ctx.work.id,
      work_id: ctx.work.id,
      session_id: ctx.session.id,
      parent_turn_ref: "turn_#{run_id}",
      origin_frame_ref: "frame_#{run_id}",
      profile_ref: "conversation_turn_v1",
      goal: %{text: "作用域事件", version: 1},
      authority_scope: %{production_write: false, allowed_tools: ["read_chapter"]}
    }
  end

  defp step_struct(run_id, sequence, step_id) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: step_id,
        run_ref: run_id,
        sequence: sequence,
        status: :completed,
        goal: "执行第 #{sequence} 步",
        micro_plan_ref: "mp_#{sequence}",
        decision_ref: "decision_#{sequence}",
        tool_request_ref: "tq_#{sequence}",
        tool_result_ref: "tr_#{sequence}",
        idempotency_key: "#{run_id}:#{sequence}"
      })

    step
  end

  defp observation(run_id, sequence) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{sequence}",
        run_ref: run_id,
        step_ref: "scoped_step_#{sequence}",
        observation_type: :custom,
        source_ref: "scoped:step:#{sequence}",
        summary: "第 #{sequence} 步观察。",
        evidence_refs: ["tool_result:tr_#{sequence}"]
      })

    observation
  end

  defp sequential_steps(steps) when is_list(steps) do
    fn run, sequence, _snapshot ->
      case Enum.at(steps, sequence - 1) do
        nil ->
          {:complete, complete_decision(run, sequence), %{provider_call_count: 0}}

        step_fun when is_function(step_fun) ->
          {:execute, step_fun, execute_decision(run, sequence), %{provider_call_count: 0}}
      end
    end
  end

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "执行第 #{sequence} 步。",
        target_tool_ref: "read_chapter",
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["scoped_execute"]
      })

    decision
  end

  defp complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "完成。",
        reason_codes: ["goal_satisfied"]
      })

    decision
  end
end
