defmodule NovelApplication.AgentRunSubscriptionLifecycleTest do
  @moduledoc """
  AgentRun 订阅者/执行 Task 生命周期回归：多窗口各收一份、Task kill 归因到 run
  失败而不是被当成订阅者 DOWN、订阅进程退出不影响仍在执行的 Task。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelDomain.{AgentNextStepDecision, AgentStep}
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "multi-window subscribers each receive one copy of run events" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(80)
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    for index <- 1..2 do
      NovelApplication.TestAgentEventRelay.subscribe(
        "work_1",
        "sess_1",
        run_id,
        fn event -> send(parent, {:mirror, index, event.event_type}) end
      )
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([slow_step])
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:step_started, 1}

    assert :ok = AgentRunService.pause(run_id)

    assert_receive {:mirror, 1, :run_paused}, 2_000
    assert_receive {:mirror, 2, :run_paused}, 2_000
    refute_receive {:mirror, 1, :run_paused}, 100
    refute_receive {:mirror, 2, :run_paused}, 100
  end

  test "a killed step task fails the run instead of being swallowed as a subscriber DOWN" do
    parent = self()
    run_id = unique_run_id()

    blocking_step = fn _run, sequence ->
      send(parent, {:step_task_started, sequence, self()})

      receive do
        :never_release -> :ok
      end
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(
                 base_run(run_id),
                 event_forward_full(parent)
               ),
               next_step_planner: sequential_steps([blocking_step])
             )

    assert_receive {:step_task_started, 1, task_pid}, 1_000
    assert {:ok, %{current_task?: true}} = AgentRunService.state(run_id)

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    on_exit(fn -> if Process.alive?(task_pid), do: Process.exit(task_pid, :kill) end)

    Process.exit(task_pid, :kill)

    assert_receive {:agent_event_full, :run_failed, failed}, 1_000
    assert "step_task_down" in failed.reason_codes

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :failed
    refute state.current_task?
    refute_receive {:step_task_started, 2, _pid}, 20
  end

  test "a subscriber exit cleans its subscription and leaves the running step task alive" do
    parent = self()
    run_id = unique_run_id()

    blocking_step = fn _run, sequence ->
      send(parent, {:step_task_started, sequence, self()})

      receive do
        :release_step ->
          {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
      end
    end

    NovelApplication.TestAgentEventRelay.subscribe("work_1", "sess_1", run_id, fn event ->
      if event.event_type == :run_completed, do: send(parent, {:run_completed, event})
    end)

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([blocking_step])
             )

    assert_receive {:step_task_started, 1, task_pid}, 1_000

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    subscriber =
      spawn(fn ->
        :ok = AgentRunService.subscribe_events("work_1", "sess_1")
        send(parent, {:subscriber_attached, self()})

        receive do
          :stop -> :ok
        end
      end)

    assert_receive {:subscriber_attached, ^subscriber}, 1_000
    assert subscriber in subscriptions("work_1", "sess_1")

    on_exit(fn -> if Process.alive?(task_pid), do: send(task_pid, :release_step) end)

    monitor_ref = Process.monitor(subscriber)
    send(subscriber, :stop)
    assert_receive {:DOWN, ^monitor_ref, :process, ^subscriber, :normal}, 1_000
    assert wait_for(fn -> subscriber not in subscriptions("work_1", "sess_1") end)

    assert Process.alive?(task_pid)

    assert {:ok, %{run: %{status: :running}, current_task?: true}} =
             AgentRunService.state(run_id)

    send(task_pid, :release_step)
    assert_receive {:run_completed, _event}, 1_000

    assert {:ok, %{run: %{status: :completed}, current_task?: false}} =
             AgentRunService.state(run_id)
  end

  defp unique_run_id,
    do: "run_subscription_lifecycle_#{System.unique_integer([:positive, :monotonic])}"

  defp base_run(run_id) do
    %{
      run_id: run_id,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1",
      origin_frame_ref: "frame_1",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
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

  defp sequential_steps(steps) do
    fn run, sequence, _snapshot ->
      case Enum.at(steps, sequence - 1) do
        nil ->
          {:complete, complete_decision(run, sequence), %{provider_call_count: 0}}

        step_fun ->
          {:execute, wrap_step(step_fun), execute_decision(run, sequence),
           %{provider_call_count: 0}}
      end
    end
  end

  defp wrap_step(fun) when is_function(fun, 3), do: fun

  defp wrap_step(fun) when is_function(fun, 2),
    do: fn run, sequence, _snapshot -> fun.(run, sequence) end

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "执行第 #{sequence} 步。",
        target_tool_ref: "character_roster",
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["subscription_lifecycle_execute"]
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

  defp event_forward_full(parent) do
    fn event -> send(parent, {:agent_event_full, event.event_type, event}) end
  end

  defp subscriptions(work_id, session_id) do
    NovelApplication.AgentEventRegistry
    |> Registry.lookup({work_id, session_id})
    |> Enum.map(fn {pid, _value} -> pid end)
  end

  defp wait_for(fun, attempts \\ 100)
  defp wait_for(_fun, 0), do: false

  defp wait_for(fun, attempts) do
    if fun.() do
      true
    else
      Process.sleep(10)
      wait_for(fun, attempts - 1)
    end
  end
end
