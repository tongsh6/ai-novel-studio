defmodule NovelApplication.TestAgentRunCleanup do
  @moduledoc """
  测试收尾：先让本 case 登记的 run 在取消后到达安全点，再按实际 PID 释放其派生任务。

  `register_run/1` 在 `AgentRunService.start_bounded/2` 成功返回后捕获 Registry 中的实际
  PID，并把释放登记到 ExUnit `on_exit`。`release_run/2` 对仍存活的 run 先发既有
  `:cancel` command，只对该 PID 轮询 state，等待 `current_task?` 为 false 且本 run 的
  step 任务自然完成；随后经实际 `AgentRunSupervisor` 结束 run，再按 `$callers` 链收口
  step/background 派生任务（含嵌套）。释放只覆盖该 PID 的派生任务，不遍历其他 run 的
  state，不以 Registry 消失或进程列表为空作为提交完成的证明。

  deadline 覆盖取消、安全点、run 停止和任务收口。到期或 state/stop 失败时保留原始
  失败，继续强制终止本 run 及已识别的本作用域任务并确认死亡，最后 raise；不会带着
  活任务进入 Sandbox 释放，也不会在阻塞停止超过期限后因列表已空而返回 `:ok`。

  `await_quiescent/1` 是尚未迁移的 Channel 调用者使用的旧入口，保留原语义，不扩用。
  """

  @run_supervisor NovelApplication.AgentRunSupervisor
  @run_registry NovelApplication.AgentRunRegistry

  @step_supervisor NovelApplication.AgentStepTaskSupervisor

  @task_supervisors [
    NovelApplication.AgentStepTaskSupervisor,
    NovelApplication.BackgroundTaskSupervisor
  ]

  require Logger

  @poll_ms 10
  @stable_polls 2

  @doc """
  捕获 run 的实际 PID，并在 `on_exit` 登记一次基于该 PID 的释放。

  Registry 缺失时直接报错，不把“查不到”当作已经收口；重复登记同一 PID 复用同一
  `on_exit` key，后续重复释放幂等。
  """
  @spec register_run(String.t()) :: pid()
  def register_run(run_id) when is_binary(run_id) do
    pid = lookup_run_pid!(run_id)
    ExUnit.Callbacks.on_exit({__MODULE__, pid}, fn -> release_registered_run(pid) end)
    pid
  end

  @doc """
  取消并等待登记的 run 到达安全点，再停止该 run 与其派生任务。

  返回 `:ok` 表示本 PID 域内已收口；超时、state 或 stop 失败抛出异常。抛出前仍会
  强制结束并确认本 run 及已识别的 owned tasks 已死亡。
  """
  @spec release_run(pid(), non_neg_integer()) :: :ok
  def release_run(pid, timeout_ms \\ 5_000)
      when is_pid(pid) and is_integer(timeout_ms) and timeout_ms >= 0 do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    failures = await_safe_point(pid, deadline)
    failures = stop_run(pid, deadline, failures)
    failures = drain_owned_tasks(pid, deadline, failures)

    case failures do
      [] ->
        :ok

      failures ->
        raise "release_run(#{inspect(pid)}) failed within #{timeout_ms}ms: #{inspect(failures)}"
    end
  end

  # ExUnit 1.19 的 on_exit 在 test 已失败时只保留首个异常；在登记边界记录退出错误
  # 后原样重抛，只补足证据，不改 release_run 的正常/超时/所有权语义。
  defp release_registered_run(pid) do
    release_run(pid)
  catch
    kind, reason ->
      stacktrace = __STACKTRACE__
      Logger.error("测试run退出失败: " <> Exception.format(kind, reason, stacktrace))
      :erlang.raise(kind, reason, stacktrace)
  end

  # 旧入口：仅为当前 Channel 调用者保留；等全部 run/task 安静，到期返回 :ok。
  def await_quiescent(timeout \\ 5_000) do
    deadline = System.monotonic_time(:millisecond) + timeout
    settle(deadline, 0)
  end

  defp settle(deadline, stable) do
    sync_run_servers()

    cond do
      busy?() and System.monotonic_time(:millisecond) < deadline ->
        Process.sleep(@poll_ms)
        settle(deadline, 0)

      stable >= @stable_polls ->
        :ok

      System.monotonic_time(:millisecond) >= deadline ->
        :ok

      true ->
        Process.sleep(@poll_ms)
        settle(deadline, stable + 1)
    end
  end

  # GenServer.call 排队在当前回调之后；返回即证明该 run server 已处理完当前
  # 结果提交，不会在 owner 退出时还停在事务里。
  defp sync_run_servers do
    NovelApplication.AgentRunSupervisor
    |> DynamicSupervisor.which_children()
    |> Enum.each(fn {_, pid, _, _} when is_pid(pid) ->
      try do
        NovelApplication.AgentRunServer.state(pid, 1_000)
      catch
        :exit, _reason -> :ok
      end
    end)
  end

  defp busy? do
    step_tasks?() or background_tasks?()
  end

  defp step_tasks? do
    NovelApplication.AgentStepTaskSupervisor
    |> DynamicSupervisor.which_children()
    |> Enum.any?()
  end

  defp background_tasks? do
    case Process.whereis(NovelApplication.BackgroundTaskSupervisor) do
      nil ->
        false

      _pid ->
        NovelApplication.BackgroundTaskSupervisor |> Task.Supervisor.children() |> Enum.any?()
    end
  end

  defp lookup_run_pid!(run_id) do
    case Registry.lookup(@run_registry, run_id) do
      [{pid, _}] when is_pid(pid) ->
        pid

      [] ->
        raise "register_run/1 could not find run #{inspect(run_id)} in #{inspect(@run_registry)}; " <>
                "refusing to assume the run has already stopped"
    end
  end

  # 取消只对登记的 PID 发既有 command；state call 与它同源，按同一 server 的消息
  # 顺序排在 cancel 之后。wait 条件同时核对 server 的 current_task? 与本 run 的
  # step 任务是否自然完成，不能只看 task 消失。
  defp await_safe_point(pid, deadline) do
    if Process.alive?(pid) do
      NovelApplication.AgentRunServer.command(pid, :cancel)
      poll_safe_point(pid, deadline)
    else
      []
    end
  end

  defp poll_safe_point(pid, deadline) do
    cond do
      remaining_ms(deadline) <= 0 ->
        [{:timeout, :safe_point}]

      not Process.alive?(pid) ->
        []

      true ->
        case safe_point_state(pid, deadline) do
          :safe ->
            []

          :wait ->
            Process.sleep(min(@poll_ms, max(remaining_ms(deadline), 0)))
            poll_safe_point(pid, deadline)

          {:error, failure} ->
            [failure]
        end
    end
  end

  defp safe_point_state(pid, deadline) do
    timeout = max(remaining_ms(deadline), 1)

    try do
      state = NovelApplication.AgentRunServer.state(pid, timeout)

      if state.current_task? or owned_tasks(pid, [@step_supervisor]) != [] do
        :wait
      else
        :safe
      end
    catch
      :exit, {:timeout, _} ->
        :wait

      :exit, {:noproc, _} ->
        :safe

      :exit, reason ->
        if Process.alive?(pid) do
          {:error, {:state, pid, reason}}
        else
          :safe
        end
    end
  end

  defp stop_run(pid, deadline, failures) do
    case terminate_supervised(@run_supervisor, pid, deadline) do
      :ok -> failures
      failure -> failures ++ [failure]
    end
  end

  defp drain_owned_tasks(pid, deadline, failures) do
    case owned_tasks(pid) do
      [] ->
        failures

      tasks ->
        failures =
          Enum.reduce(tasks, failures, fn task, acc -> stop_task(task, deadline, acc) end)

        drain_owned_tasks(pid, deadline, failures)
    end
  end

  defp stop_task({supervisor, pid}, deadline, failures) do
    case terminate_supervised(supervisor, pid, deadline) do
      :ok -> failures
      failure -> failures ++ [failure]
    end
  end

  # 用受监控的短操作进程执行同步 terminate_child，期限到就强杀 child 并结束该进程；
  # 所有私有操作进程都在返回前确认退出。正常路径仍走实际 Supervisor。
  defp terminate_supervised(supervisor, pid, deadline) do
    cond do
      not Process.alive?(pid) ->
        :ok

      remaining_ms(deadline) <= 0 ->
        force_kill(pid)
        {:timeout, {:stop, supervisor, pid}}

      true ->
        parent = self()
        ref = make_ref()

        {worker, monitor} =
          spawn_monitor(fn ->
            send(parent, {ref, DynamicSupervisor.terminate_child(supervisor, pid)})
          end)

        receive do
          {^ref, :ok} ->
            finish_worker(ref, worker, monitor)
            :ok

          {^ref, {:error, :not_found}} ->
            finish_worker(ref, worker, monitor)
            :ok

          {^ref, other} ->
            finish_worker(ref, worker, monitor)
            force_kill(pid)
            {:error, {:stop, supervisor, pid, other}}

          {:DOWN, ^monitor, :process, ^worker, reason} ->
            force_kill(pid)
            {:error, {:stop, supervisor, pid, {:worker_down, reason}}}
        after
          remaining_ms(deadline) ->
            force_kill(pid)
            finish_worker(ref, worker, monitor)
            {:timeout, {:stop, supervisor, pid}}
        end
    end
  end

  defp finish_worker(ref, worker, monitor) do
    if Process.alive?(worker), do: Process.exit(worker, :kill)
    await_worker_down(worker, monitor)
    flush_stop_reply(ref)
  end

  defp await_worker_down(worker, monitor) do
    receive do
      {:DOWN, ^monitor, :process, ^worker, _reason} -> :ok
    end
  end

  defp flush_stop_reply(ref) do
    receive do
      {^ref, _result} -> flush_stop_reply(ref)
    after
      0 -> :ok
    end
  end

  defp force_kill(pid) do
    if Process.alive?(pid) do
      monitor = Process.monitor(pid)
      Process.exit(pid, :kill)

      receive do
        {:DOWN, ^monitor, :process, ^pid, _reason} -> :ok
      end
    else
      :ok
    end
  end

  defp owned_tasks(run_pid, supervisors \\ @task_supervisors) do
    for supervisor <- supervisors,
        {_, pid, _, _} <- DynamicSupervisor.which_children(supervisor),
        is_pid(pid),
        owned_by?(pid, run_pid) do
      {supervisor, pid}
    end
  end

  defp owned_by?(pid, run_pid) do
    case Process.info(pid, :dictionary) do
      {:dictionary, dictionary} -> run_pid in Keyword.get(dictionary, :"$callers", [])
      nil -> false
    end
  end

  defp remaining_ms(deadline) do
    max(deadline - System.monotonic_time(:millisecond), 0)
  end
end
