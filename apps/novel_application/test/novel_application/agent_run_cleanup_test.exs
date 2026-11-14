defmodule NovelApplication.AgentRunCleanupTest.FakeRunServer do
  @moduledoc false
  use GenServer

  @registry NovelApplication.AgentRunRegistry
  @step_supervisor NovelApplication.AgentStepTaskSupervisor
  @background_supervisor NovelApplication.BackgroundTaskSupervisor

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)

  def child_spec(opts) do
    %{
      id: {__MODULE__, Keyword.fetch!(opts, :run_id)},
      start: {__MODULE__, :start_link, [opts]},
      restart: :temporary,
      shutdown: Keyword.get(opts, :shutdown, 5_000)
    }
  end

  @impl true
  def init(opts) do
    run_id = Keyword.fetch!(opts, :run_id)
    parent = Keyword.fetch!(opts, :parent)
    {:ok, _} = Registry.register(@registry, run_id, nil)

    state = %{
      run_pid: self(),
      parent: parent,
      current_task?: false,
      step_pid: nil
    }

    state = maybe_start_step(state, Keyword.get(opts, :step, :none), opts)
    maybe_start_background(state, opts)
    send(parent, {:fake_run_started, run_id, state.run_pid})
    {:ok, state}
  end

  @impl true
  def handle_call(:state, _from, state) do
    {:reply, %{current_task?: state.current_task?}, state}
  end

  @impl true
  def handle_cast({:command, :cancel}, state) do
    send(state.parent, {:fake_cancel_received, state.run_pid})
    {:noreply, state}
  end

  def handle_cast({:step_done, pid}, %{step_pid: pid} = state) do
    {:noreply, %{state | current_task?: false, step_pid: nil}}
  end

  defp maybe_start_step(state, :none, _opts), do: state

  defp maybe_start_step(state, :slow, opts) do
    delay = Keyword.get(opts, :step_delay, 0)

    {:ok, step_pid} =
      Task.Supervisor.start_child(
        @step_supervisor,
        fn -> step_body(state, delay) end,
        shutdown: 5_000
      )

    %{state | current_task?: true, step_pid: step_pid}
  end

  defp step_body(state, delay) do
    send(state.parent, {:fake_step_started, state.run_pid, self()})
    Process.sleep(delay)
    send(state.parent, {:fake_step_committed, state.run_pid, self()})
    GenServer.cast(state.run_pid, {:step_done, self()})
  end

  defp maybe_start_background(state, opts) do
    if Keyword.get(opts, :background, false) do
      delay = Keyword.get(opts, :background_delay, 0)
      trap? = Keyword.get(opts, :background_trap, false)
      shutdown = if trap?, do: 50, else: 5_000

      {:ok, _pid} =
        Task.Supervisor.start_child(
          @background_supervisor,
          fn -> background_body(state, delay, trap?) end,
          shutdown: shutdown
        )
    end

    :ok
  end

  defp background_body(state, delay, trap?) do
    if trap?, do: Process.flag(:trap_exit, true)

    {:ok, nested} =
      Task.Supervisor.start_child(@background_supervisor, fn ->
        Process.sleep(delay)
        send(state.parent, {:fake_background_nested_committed, state.run_pid, self()})
        :ok
      end)

    send(state.parent, {:fake_background_started, state.run_pid, self(), nested})
    Process.sleep(delay)
    send(state.parent, {:fake_background_committed, state.run_pid, self()})

    if trap? do
      receive do
        :never -> :ok
      end
    end
  end
end

defmodule NovelApplication.AgentRunCleanupTest do
  @moduledoc """
  B84 A3：`TestAgentRunCleanup` 的 run PID 生命周期边界。

  用真实 AgentRunSupervisor/Registry/Task.Supervisor 与 `$callers` 验证：取消后等待
  本 run 的在途 step 提交到达安全点，再停止 run 并只收口其派生任务；run 先退出仍可
  回收孤儿；其他 owner 哨兵不被等待或停止；超时/登记缺失不假成功且 forced 收口后
  不再留下活任务；释放先于 DataCase 停 Sandbox owner。
  """

  use NovelPersistence.DataCase, async: false

  alias NovelApplication.AgentRunCleanupTest.FakeRunServer
  alias NovelApplication.TestAgentRunCleanup

  @run_supervisor NovelApplication.AgentRunSupervisor

  test "release_run waits for an in-flight step commit before stopping the registered run" do
    {run_id, run_pid} = start_fake_run(self(), step: :slow, step_delay: 40)

    assert_receive {:fake_step_started, ^run_pid, step_pid}, 1_000
    assert TestAgentRunCleanup.register_run(run_id) == run_pid

    assert :ok = TestAgentRunCleanup.release_run(run_pid)

    assert_receive {:fake_cancel_received, ^run_pid}, 1_000
    assert_receive {:fake_step_committed, ^run_pid, ^step_pid}, 1_000
    refute Process.alive?(run_pid)
    refute Process.alive?(step_pid)
  end

  test "release_run stops only the registered run and its own step/background nested tasks" do
    {owned_run_id, owned_run_pid} =
      start_fake_run(self(),
        step: :slow,
        step_delay: 40,
        background: true,
        background_delay: 5_000
      )

    {other_run_id, other_run_pid} =
      start_fake_run(self(), background: true, background_delay: 5_000)

    assert_receive {:fake_step_started, ^owned_run_pid, owned_step_pid}, 1_000

    assert_receive {:fake_background_started, ^owned_run_pid, owned_bg_pid, owned_bg_nested_pid},
                   1_000

    assert_receive {:fake_background_started, ^other_run_pid, other_bg_pid, other_bg_nested_pid},
                   1_000

    assert TestAgentRunCleanup.register_run(owned_run_id) == owned_run_pid
    assert TestAgentRunCleanup.register_run(owned_run_id) == owned_run_pid
    assert TestAgentRunCleanup.register_run(other_run_id) == other_run_pid

    assert :ok = TestAgentRunCleanup.release_run(owned_run_pid)

    refute Process.alive?(owned_run_pid)
    refute Process.alive?(owned_step_pid)
    refute Process.alive?(owned_bg_pid)
    refute Process.alive?(owned_bg_nested_pid)

    assert Process.alive?(other_run_pid)
    assert Process.alive?(other_bg_pid)
    assert Process.alive?(other_bg_nested_pid)

    assert :ok = TestAgentRunCleanup.release_run(other_run_pid)
    refute Process.alive?(other_run_pid)
    refute Process.alive?(other_bg_pid)
    refute Process.alive?(other_bg_nested_pid)
  end

  test "release_run raises on deadline and still terminates all owned tasks" do
    {run_id, run_pid} =
      start_fake_run(self(), background: true, background_trap: true, background_delay: 5_000)

    assert_receive {:fake_background_started, ^run_pid, bg_pid, bg_nested_pid}, 1_000
    assert TestAgentRunCleanup.register_run(run_id) == run_pid

    assert_raise RuntimeError, ~r/failed within 1ms/, fn ->
      TestAgentRunCleanup.release_run(run_pid, 1)
    end

    refute Process.alive?(run_pid)
    refute Process.alive?(bg_pid)
    refute Process.alive?(bg_nested_pid)
  end

  test "release_run raises instead of :ok when a supervised task ignores shutdown" do
    {run_id, run_pid} =
      start_fake_run(self(), background: true, background_trap: true, background_delay: 5_000)

    assert_receive {:fake_background_started, ^run_pid, bg_pid, bg_nested_pid}, 1_000
    assert TestAgentRunCleanup.register_run(run_id) == run_pid

    assert_raise RuntimeError, ~r/failed within 20ms/, fn ->
      TestAgentRunCleanup.release_run(run_pid, 20)
    end

    refute Process.alive?(run_pid)
    refute Process.alive?(bg_pid)
    refute Process.alive?(bg_nested_pid)
  end

  test "release_run still collects orphan tasks after the run process is gone" do
    {run_id, run_pid} =
      start_fake_run(self(),
        step: :slow,
        step_delay: 5_000,
        background: true,
        background_delay: 5_000
      )

    assert_receive {:fake_step_started, ^run_pid, step_pid}, 1_000
    assert_receive {:fake_background_started, ^run_pid, bg_pid, bg_nested_pid}, 1_000
    assert TestAgentRunCleanup.register_run(run_id) == run_pid

    assert :ok = DynamicSupervisor.terminate_child(@run_supervisor, run_pid)
    refute Process.alive?(run_pid)
    assert Process.alive?(step_pid)
    assert Process.alive?(bg_pid)

    assert :ok = TestAgentRunCleanup.release_run(run_pid)
    refute Process.alive?(step_pid)
    refute Process.alive?(bg_pid)
    refute Process.alive?(bg_nested_pid)

    # 已死亡 PID 上的重复释放幂等。
    assert :ok = TestAgentRunCleanup.release_run(run_pid)
  end

  test "registered run cleanup runs before DataCase stops the sandbox owner" do
    {run_id, run_pid} = start_fake_run(self())

    # start_fake_run 已先登记兜底 release，本 observer 晚于它、早于 register_run；
    # register_run 的 release callback 最后登记，因此先于本 observer 执行。
    on_exit(fn ->
      refute Process.alive?(run_pid)
      assert %{rows: [[1]]} = Repo.query!("SELECT 1")
    end)

    assert TestAgentRunCleanup.register_run(run_id) == run_pid
  end

  test "register_run refuses a run id that is not in the registry" do
    missing = "cleanup-missing-#{System.unique_integer([:positive, :monotonic])}"

    assert_raise RuntimeError, ~r/could not find run/, fn ->
      TestAgentRunCleanup.register_run(missing)
    end
  end

  defp start_fake_run(parent, opts \\ []) do
    run_id = "cleanup-run-#{System.unique_integer([:positive, :monotonic])}"
    opts = Keyword.merge([run_id: run_id, parent: parent], opts)

    {:ok, pid} = DynamicSupervisor.start_child(@run_supervisor, {FakeRunServer, opts})
    register_cleanup_fallback(pid)
    assert_receive {:fake_run_started, ^run_id, ^pid}, 1_000
    {run_id, pid}
  end

  # 兜底入口：start_fake_run 一旦拿到 Supervisor PID 就登记，早于任何 assert_receive；
  # 正式 register_run 使用独立 key 且登记更晚，因此正常路径先执行正式 release。
  defp register_cleanup_fallback(pid) do
    ExUnit.Callbacks.on_exit({:agent_run_cleanup_fallback, pid}, fn ->
      TestAgentRunCleanup.release_run(pid)
    end)
  end
end
