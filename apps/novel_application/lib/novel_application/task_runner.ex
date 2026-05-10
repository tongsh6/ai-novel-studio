defmodule NovelApplication.TaskRunner do
  @moduledoc """
  v3 Long-run Task Runner. 负责长跑任务的生命周期调度与持久化同步。

  依托 Persistence.LongRunTaskLog 实现 SQLite 状态保存与恢复。
  """

  require Logger

  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase
  alias NovelPersistence.LongRunTaskLog

  @doc "启动一个新任务。"
  def start(attrs) do
    with {:ok, task} <- LongRunTaskLog.create(attrs) do
      Logger.info("[TaskRunner] Started task #{task.id} (#{task.task_type})")
      # 模拟异步执行
      Task.start(fn -> perform_execution(task.id) end)
      {:ok, task}
    end
  end

  @doc "从持久化层恢复任务。"
  def resume(task_id) do
    with %{} = task <- LongRunTaskLog.get(task_id),
         {:ok, resumed} <- LongRunTaskLog.resume(task) do
      Logger.info("[TaskRunner] Resumed task #{task_id}")
      Task.start(fn -> perform_execution(task_id) end)
      {:ok, resumed}
    else
      nil -> {:error, :not_found}
      error -> error
    end
  end

  # ── Execution Core ────────────────────────────

  defp perform_execution(id) do
    case LongRunTaskLog.get(id) do
      nil ->
        :ok

      task ->
        # 1. 进入运行态
        {:ok, task} =
          LongRunTaskLog.update(task, %{status: Status.running(), phase: TaskPhase.running()})

        # 2. 模拟工作周期 (Checkpoint 1)
        Process.sleep(100)

        {:ok, task} =
          LongRunTaskLog.checkpoint(task, %{"progress" => 50, "step" => "world_gen"})

        # 3. 模拟继续工作 (模拟外部恢复或自动恢复)
        Process.sleep(100)

        {:ok, task} =
          LongRunTaskLog.update(task, %{status: Status.running(), phase: TaskPhase.running()})

        # 4. 完成
        Process.sleep(100)
        {:ok, _task} = LongRunTaskLog.complete(task)
        Logger.info("[TaskRunner] Completed task #{id}")
    end
  end
end
