defmodule NovelApplication.TestAgentRunCleanup do
  @moduledoc """
  测试收尾：同步 run server，并等待 step/后台任务自然退出后再让 Sandbox owner 退出。

  这些流程测试直接走公开 AgentRunService；若测试结束时 run server 仍在事务中，
  或 step task 仍持有 Sandbox 连接，owner 先退出会让连接失效并让下一条测试撞上
  SQLite busy。该 helper 只做测试进程生命周期收口，不改变生产运行语义。
  """

  @poll_ms 10
  @stable_polls 2

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
end
